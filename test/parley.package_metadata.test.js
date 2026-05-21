import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
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
  assert.deepEqual(pkg.exports, {
    ".": "./index.js",
    "./plugin": "./plugin.js",
    "./openclaw": "./src/adapters/openclaw/index.js",
    "./client": "./src/client/index.js",
    "./service": "./src/service/index.js",
    "./schemas": "./src/schemas/index.js",
    "./adapters/proxmox": "./src/adapters/proxmox/index.js",
    "./daemon": "./src/cli/parleyd.js"
  });
  assert.equal(Object.keys(pkg.exports).some((exportPath) => exportPath.includes("*")), false);
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
  for (const toolName of [
    "parley_get_plan_overview",
    "parley_get_plan_phases",
    "parley_get_plan_review_status",
    "parley_get_plan_relationships",
    "parley_replace_plan_review_routing",
    "parley_cancel_plan_review",
    "parley_record_human_review_attestation"
  ]) {
    assert.ok(manifest.contracts.tools.includes(toolName), `${toolName} should be advertised in contracts.tools`);
  }

  await assertFile("plugin.js");
  await assertFile("openclaw.plugin.json");
  await assertFile("src/adapters/openclaw/index.js");
});

test("package bin symlinks execute real entrypoints", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "parley-package-bin-test-"));
  try {
    const binCases = [
      ["parley", "src/cli/parley.js", "Usage: parley"],
      ["parleyd", "src/cli/parleyd.js", "Usage: parleyd"],
      ["parley-codex", "src/cli/parley-codex.js", "Usage: parley-codex"]
    ];
    for (const [name, target, expected] of binCases) {
      const binPath = path.join(tempRoot, name);
      await fs.symlink(path.join(repoRoot, target), binPath);
      const result = spawnSync(process.execPath, [binPath, "--help"], {
        cwd: tempRoot,
        encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: tempRoot }
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, new RegExp(expected));
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
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
