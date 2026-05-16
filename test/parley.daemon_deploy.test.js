import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { startParleyDaemon } from "../src/cli/parleyd.js";

const execFileAsync = promisify(execFile);

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("parleyd starts the HTTP service with service-mode SQLite config", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "parley-daemon-"));
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  let stdout = "";
  let stderr = "";
  const result = await startParleyDaemon([
    "--mode", "service",
    "--db-path", path.join(tempRoot, "parley.sqlite"),
    "--auth-token", "test-token",
    "--port", "0"
  ], {
    wait: false,
    stdout: { write(chunk) { stdout += chunk; } },
    stderr: { write(chunk) { stderr += chunk; } },
    env: { ...process.env, PARLEY_CONFIG: "" }
  });
  t.after(async () => {
    await closeServer(result.server);
  });

  assert.equal(result.runtimeConfig.mode, "service");
  assert.equal(result.runtimeConfig.storageMode, "service-db");
  assert.equal(typeof result.bind.port, "number");
  assert.ok(result.bind.port > 0);
  assert.equal(stderr, "");

  const ready = JSON.parse(stdout);
  assert.equal(ready.ok, true);
  assert.equal(ready.event, "ready");
  assert.equal(ready.runtime.mode, "service");
  assert.equal(JSON.stringify(ready).includes("test-token"), false);

  const baseUrl = `http://127.0.0.1:${result.bind.port}`;
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).data.storageMode, "service-db");

  const unauthenticatedMeta = await fetch(`${baseUrl}/v1/meta`);
  assert.equal(unauthenticatedMeta.status, 401);

  const authenticatedMeta = await fetch(`${baseUrl}/v1/meta`, {
    headers: { authorization: "Bearer test-token" }
  });
  assert.equal(authenticatedMeta.status, 200);
  assert.deepEqual((await authenticatedMeta.json()).data.service, "parley");
});

test("deployment helper scripts are shell-parseable and use the service migration command", async () => {
  const deployScript = path.resolve("tools/deploy/deploy-parley");
  const rollbackScript = path.resolve("tools/deploy/rollback-parley");
  await execFileAsync("bash", ["-n", deployScript]);
  await execFileAsync("bash", ["-n", rollbackScript]);

  const deploySource = await fs.readFile(deployScript, "utf8");
  assert.match(deploySource, /git checkout "\$REF"/);
  assert.match(deploySource, /PARLEY_MODE=service PARLEY_DB_PATH="\$DB" npm run cli -- migrate/);
  assert.match(deploySource, /git rev-parse HEAD > "\$MARKER_DIR\/deployed-commit"/);

  const rollbackSource = await fs.readFile(rollbackScript, "utf8");
  assert.match(rollbackSource, /git checkout "\$REF"/);
  assert.match(rollbackSource, /cp "\$DB_BACKUP" "\$DB"/);
});
