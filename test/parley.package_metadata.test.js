import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  const raw = await fs.readFile(path.join(repoRoot, relativePath), "utf8");
  return JSON.parse(raw);
}

async function assertFile(relativePath) {
  const stat = await fs.stat(path.join(repoRoot, relativePath));
  assert.equal(stat.isFile(), true, `${relativePath} should be a file`);
}

test("package metadata advertises installable OpenClaw runtime entrypoints", async () => {
  const pkg = await readJson("package.json");
  const manifest = await readJson("openclaw.plugin.json");

  assert.equal(pkg.name, "@nkuhanas/parley");
  assert.equal(pkg.type, "module");
  assert.equal(pkg.main, "./index.js");
  assert.deepEqual(pkg.openclaw?.extensions, ["./plugin.js"]);
  assert.deepEqual(pkg.openclaw?.runtimeExtensions, ["./plugin.js"]);
  assert.equal(pkg.openclaw?.compat?.pluginApi, ">=2026.5.4");
  assert.equal(pkg.openclaw?.compat?.minGatewayVersion, "2026.5.4");
  assert.equal(pkg.openclaw?.build?.openclawVersion, "2026.5.4");
  assert.equal(pkg.openclaw?.build?.pluginSdkVersion, "2026.5.4");

  assert.equal(manifest.id, "parley");
  assert.equal(manifest.version, pkg.version);
  assert.ok(Array.isArray(manifest.contracts?.tools));
  assert.ok(manifest.contracts.tools.includes("parley_my_boards"));
  assert.ok(manifest.contracts.tools.includes("parley_where_am_i"));

  await assertFile("plugin.js");
  await assertFile("openclaw.plugin.json");
  await assertFile("src/adapters/openclaw/index.js");
});

test("npm pack dry-run includes plugin, CLI, docs, and executable bins", () => {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["pack", "--dry-run", "--json"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const [pack] = JSON.parse(result.stdout);
  const files = new Map(pack.files.map((entry) => [entry.path, entry]));
  for (const requiredPath of [
    "package.json",
    "README.md",
    "LICENSE",
    "index.js",
    "plugin.js",
    "openclaw.plugin.json",
    "src/adapters/openclaw/index.js",
    "src/cli/parley.js",
    "src/cli/parleyd.js",
    "src/cli/parley-codex.js",
    "tools/deploy/deploy-parley",
    "tools/deploy/rollback-parley"
  ]) {
    assert.ok(files.has(requiredPath), `${requiredPath} should be included in npm pack output`);
  }

  for (const binPath of ["src/cli/parley.js", "src/cli/parleyd.js", "src/cli/parley-codex.js"]) {
    assert.ok((files.get(binPath).mode & 0o111) !== 0, `${binPath} should be executable in package output`);
  }
});
