import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createParleyEmbeddedClient } from "../src/client/index.js";
import { runParleyCli } from "../src/cli/parley.js";
import { closeAllParleySqliteLedgers } from "../src/core/storage/sqlite_ledger.js";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function withTempRoot(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "parley-embedded-cli-test-"));
  try {
    await callback(tempRoot);
  } finally {
    closeAllParleySqliteLedgers();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function projectConfig(tempRoot, overrides = {}) {
  const boardRoot = path.join(tempRoot, "boards", "project");
  return {
    parleyMode: "standalone",
    parleyStateRoot: path.join(tempRoot, "state"),
    parleyRuntimeRoot: path.join(tempRoot, "runtime"),
    parleyAgentId: "parley-agent",
    parleyDefaultBoard: "project",
    parleyDefaultBoards: {
      project: {
        board_id: "project",
        display_name: "Project",
        status: "active",
        board_root: boardRoot,
        state_root: path.join(boardRoot, "state"),
        managed_artifact_root: path.join(boardRoot, "artifacts"),
        plan_extension: ".md",
        artifact_namespaces: [
          {
            id: "project_plans",
            roles: ["plan_landing", "explicit_landing", "reference"],
            default_for: ["plan_landing"],
            uri_prefix: "repo://plans/",
            resolved_root: path.join(tempRoot, "repo", "plans"),
            allowed_subpaths: []
          }
        ],
        allowed_reference_namespaces: ["project_plans"],
        members: [
          {
            agent_id: "parley-agent",
            board_agent_id: "parley-agent",
            display_name: "Parley Agent",
            kind: "agent",
            runtime_refs: [{ scheme: "cli", type: "agent", id: "parley-agent" }],
            roles: ["implementation"],
            permissions: { preset: "board_admin" }
          }
        ],
        permission_model: { mode: "board_wide_all_tools", future_agent_scoping: true }
      }
    },
    ...overrides
  };
}

async function writeConfig(tempRoot, config = projectConfig(tempRoot)) {
  const configPath = path.join(tempRoot, "parley.config.json");
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configPath;
}

function cliEnv(tempRoot, overrides = {}) {
  return {
    PATH: process.env.PATH,
    HOME: tempRoot,
    USER: "parley-agent",
    ...overrides
  };
}

function memoryStream() {
  const chunks = [];
  return {
    write(chunk) { chunks.push(String(chunk)); },
    text() { return chunks.join(""); }
  };
}

async function runCli(args, options = {}) {
  return execFileAsync(process.execPath, ["src/cli/parley.js", ...args], {
    cwd: REPO_ROOT,
    env: options.env,
    maxBuffer: 1024 * 1024
  });
}

function parseJsonEnvelope(text) {
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  assert.notEqual(jsonStart, -1, `expected JSON object in ${JSON.stringify(text)}`);
  assert.ok(jsonEnd > jsonStart, `expected complete JSON object in ${JSON.stringify(text)}`);
  return JSON.parse(text.slice(jsonStart, jsonEnd + 1));
}

test("embedded standalone client calls service queries in-process", async () => {
  await withTempRoot(async (tempRoot) => {
    const client = createParleyEmbeddedClient({
      surface: "cli",
      pluginConfig: projectConfig(tempRoot),
      env: {}
    });

    const boards = await client.myBoards();
    assert.equal(boards.status, "ok");
    assert.equal(boards.data.global_agent_id, "parley-agent");
    assert.equal(boards.data.boards[0].board_id, "project");

    const recovery = await client.whereAmI({ boardId: "project", verbosity: "compact" });
    assert.equal(recovery.status, "ok");
    assert.equal(recovery.data.projection.board_id, "project");
  });
});

test("embedded client preserves client-mode fail-closed behavior", async () => {
  assert.throws(
    () => createParleyEmbeddedClient({ surface: "cli", pluginConfig: { parleyMode: "client" }, env: {} }),
    (error) => error?.code === "PARLEY_API_URL_REQUIRED"
  );

  assert.throws(
    () => createParleyEmbeddedClient({
      surface: "cli",
      pluginConfig: { parleyMode: "client", parleyApiUrl: "http://127.0.0.1:7331" },
      env: {}
    }),
    (error) => error?.code === "PARLEY_EMBEDDED_MODE_UNSUPPORTED"
  );
});

test("CLI mode defaults direct human usage to standalone and reports state root", async () => {
  await withTempRoot(async (tempRoot) => {
    const runtimeRoot = path.join(tempRoot, ".local", "share", "parley", "runtime");
    const { stdout, stderr } = await runCli(["mode"], { env: cliEnv(tempRoot) });
    const parsed = JSON.parse(stdout);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.runtime.mode, "standalone");
    assert.equal(parsed.runtime.modeSource, "cli_default_standalone");
    assert.equal(parsed.runtime.runtimeRoot, runtimeRoot);
    assert.match(stderr, /implicit PARLEY_STATE_ROOT/);
    assert.equal(await exists(runtimeRoot), false);
  });
});

test("CLI standalone my-boards and where-am-i use JSON config", async () => {
  await withTempRoot(async (tempRoot) => {
    const configPath = await writeConfig(tempRoot);

    const boardsRun = await runCli(["--config", configPath, "my-boards"], { env: cliEnv(tempRoot) });
    const boards = JSON.parse(boardsRun.stdout);
    assert.equal(boards.ok, true);
    assert.equal(boards.runtime.mode, "standalone");
    assert.equal(boards.runtime.stateRoot, path.join(tempRoot, "state"));
    assert.equal(boards.response.data.boards[0].board_id, "project");

    const recoveryRun = await runCli(["--config", configPath, "where-am-i", "--board", "project"], { env: cliEnv(tempRoot) });
    const recovery = JSON.parse(recoveryRun.stdout);
    assert.equal(recovery.ok, true);
    assert.equal(recovery.command, "where-am-i");
    assert.equal(recovery.response.data.projection.board_id, "project");
  });
});


test("CLI npm-bin symlink invokes the real entrypoint", async () => {
  await withTempRoot(async (tempRoot) => {
    const configPath = await writeConfig(tempRoot);
    const binDir = path.join(tempRoot, "bin");
    await fs.mkdir(binDir, { recursive: true });
    const binPath = path.join(binDir, "parley");
    await fs.symlink(path.join(REPO_ROOT, "src", "cli", "parley.js"), binPath);

    const { stdout } = await execFileAsync(process.execPath, [binPath, "--config", configPath, "mode"], {
      cwd: tempRoot,
      env: cliEnv(tempRoot),
      maxBuffer: 1024 * 1024
    });
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.command, "mode");
    assert.equal(parsed.runtime.mode, "standalone");
  });
});


test("CLI migrate runs idempotent service SQLite migrations", async () => {
  await withTempRoot(async (tempRoot) => {
    const configPath = await writeConfig(tempRoot, projectConfig(tempRoot, {
      parleyMode: "service",
      parleyStateRoot: undefined,
      parleyRuntimeRoot: undefined,
      parleyDbPath: path.join(tempRoot, "db", "cli.sqlite")
    }));

    const firstOut = memoryStream();
    const firstErr = memoryStream();
    const firstExit = await runParleyCli(["--config", configPath, "migrate"], { env: cliEnv(tempRoot), stdout: firstOut, stderr: firstErr });
    const first = JSON.parse(firstOut.text());
    assert.equal(firstExit, 0);
    assert.equal(firstErr.text(), "");
    assert.equal(first.runtime.mode, "service");
    assert.equal(first.runtime.storageMode, "service-db");
    assert.deepEqual(first.migration.applied, [1]);

    const secondOut = memoryStream();
    const secondErr = memoryStream();
    const secondExit = await runParleyCli(["--config", configPath, "migrate"], { env: cliEnv(tempRoot), stdout: secondOut, stderr: secondErr });
    const second = JSON.parse(secondOut.text());
    assert.equal(secondExit, 0);
    assert.equal(secondErr.text(), "");
    assert.deepEqual(second.migration.applied, []);
    assert.deepEqual(second.migration.skipped, [1]);
  });
});

test("CLI client mode still refuses missing API URL", async () => {
  await withTempRoot(async (tempRoot) => {
    await assert.rejects(
      () => runCli(["mode"], { env: cliEnv(tempRoot, { PARLEY_MODE: "client" }) }),
      (error) => {
        const parsed = parseJsonEnvelope(error.stderr);
        assert.equal(parsed.ok, false);
        assert.equal(parsed.error.code, "PARLEY_API_URL_REQUIRED");
        return true;
      }
    );
  });
});


test("CLI client mode uses injected remote client transport without local state", async () => {
  await withTempRoot(async (tempRoot) => {
    const stateRoot = path.join(tempRoot, ".local", "share", "parley");
    const env = cliEnv(tempRoot, {
      PARLEY_MODE: "client",
      PARLEY_API_URL: "http://parley.test",
      PARLEY_AGENT_ID: "parley-agent",
      PARLEY_DEFAULT_BOARD: "project"
    });
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "application/json" },
        json: async () => ({ status: "ok", data: { url } })
      };
    };

    const healthOut = memoryStream();
    const healthErr = memoryStream();
    const healthExit = await runParleyCli(["health"], { env, stdout: healthOut, stderr: healthErr, fetchImpl });
    const health = JSON.parse(healthOut.text());
    assert.equal(healthExit, 0);
    assert.equal(healthErr.text(), "");
    assert.equal(health.command, "health");
    assert.equal(calls[0].url, "http://parley.test/health");

    const stdout = memoryStream();
    const stderr = memoryStream();
    const exitCode = await runParleyCli(["describe", "--topic", "targets"], { env, stdout, stderr, fetchImpl });
    const parsed = JSON.parse(stdout.text());
    assert.equal(exitCode, 0);
    assert.equal(stderr.text(), "");
    assert.equal(parsed.ok, true);
    assert.equal(parsed.runtime.mode, "client");
    assert.equal(parsed.response.status, "ok");
    assert.equal(calls[1].url, "http://parley.test/v1/queries/describe");
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      caller: {
        actor_id: "parley-agent",
        actor_type: "agent",
        runtime: "cli",
        board_id: "project"
      },
      input: { topic: "targets" }
    });

    const recoveryOut = memoryStream();
    const recoveryErr = memoryStream();
    const recoveryExit = await runParleyCli(["where-am-i", "--board", "project"], { env, stdout: recoveryOut, stderr: recoveryErr, fetchImpl });
    const recovery = JSON.parse(recoveryOut.text());
    assert.equal(recoveryExit, 0);
    assert.equal(recoveryErr.text(), "");
    assert.equal(recovery.command, "where-am-i");
    assert.equal(calls[2].url, "http://parley.test/v1/queries/whereAmI");
    assert.equal(JSON.parse(calls[2].init.body).input.boardId, "project");
    assert.equal(await exists(stateRoot), false);
  });
});

test("CLI client mode can use canonical OpenClaw caller identity plus CLI aliases", async () => {
  await withTempRoot(async (tempRoot) => {
    const env = cliEnv(tempRoot, {
      PARLEY_MODE: "client",
      PARLEY_API_URL: "http://parley.test",
      PARLEY_AGENT_ID: "parley-agent",
      PARLEY_DEFAULT_BOARD: "project",
      PARLEY_CALLER_RUNTIME: "openclaw",
      PARLEY_CALLER_RUNTIME_ALIASES: "cli:agent:parley-agent"
    });
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "application/json" },
        json: async () => ({ status: "ok", data: { url } })
      };
    };

    const stdout = memoryStream();
    const stderr = memoryStream();
    const exitCode = await runParleyCli(["my-boards"], { env, stdout, stderr, fetchImpl });
    assert.equal(exitCode, 0);
    assert.equal(stderr.text(), "");
    const parsed = JSON.parse(stdout.text());
    assert.equal(parsed.ok, true);
    assert.equal(calls[0].url, "http://parley.test/v1/queries/myBoards");
    assert.deepEqual(JSON.parse(calls[0].init.body).caller, {
      actor_id: "parley-agent",
      actor_type: "agent",
      runtime: "openclaw",
      runtime_aliases: [
        { runtime_ref: { scheme: "cli", type: "agent", id: "parley-agent" }, source: "cli_config" }
      ],
      board_id: "project"
    });
  });
});

test("CLI doctor repairs protected human board member in explicit config", async () => {
  await withTempRoot(async (tempRoot) => {
    const configPath = await writeConfig(tempRoot);

    const inspectOut = memoryStream();
    const inspectErr = memoryStream();
    const inspectExit = await runParleyCli(["--config", configPath, "doctor", "--board", "project"], { env: cliEnv(tempRoot), stdout: inspectOut, stderr: inspectErr });
    const inspect = JSON.parse(inspectOut.text());
    assert.equal(inspectExit, 1);
    assert.equal(inspectErr.text(), "");
    assert.equal(inspect.ok, false);
    assert.equal(inspect.doctor.summary.missing, 1);
    assert.equal(inspect.doctor.boards[0].human_member_id, "human");

    const repairOut = memoryStream();
    const repairErr = memoryStream();
    const repairExit = await runParleyCli(["--config", configPath, "doctor", "--board", "project", "--repair"], { env: cliEnv(tempRoot), stdout: repairOut, stderr: repairErr });
    const repair = JSON.parse(repairOut.text());
    assert.equal(repairExit, 0);
    assert.equal(repairErr.text(), "");
    assert.equal(repair.ok, true);
    assert.equal(repair.doctor.summary.repaired, 1);

    const repairedConfig = JSON.parse(await fs.readFile(configPath, "utf8"));
    const human = repairedConfig.parleyDefaultBoards.project.members.find((member) => member.board_agent_id === "human");
    assert.ok(human);
    assert.equal(human.agent_id, "human");
    assert.equal(human.kind, "human");
    assert.deepEqual(human.roles, ["human"]);
    assert.equal(human.permissions.protected, true);

    const secondOut = memoryStream();
    const secondErr = memoryStream();
    const secondExit = await runParleyCli(["--config", configPath, "doctor", "--board", "project"], { env: cliEnv(tempRoot), stdout: secondOut, stderr: secondErr });
    const second = JSON.parse(secondOut.text());
    assert.equal(secondExit, 0);
    assert.equal(secondErr.text(), "");
    assert.equal(second.ok, true);
    assert.equal(second.doctor.summary.ok, 1);
  });
});
