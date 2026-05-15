import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveParleyRuntimeConfig } from "../src/core/config.js";
import {
  createObligationRecord,
  listObligationRecords,
  saveObligationRecord
} from "../src/core/storage/board_store.js";
import { createThreadRecord, listThreadRecords, saveThreadRecord } from "../src/core/storage/store.js";
import {
  closeAllParleySqliteLedgers,
  getParleySqliteLedger,
  migrateParleySqliteLedger
} from "../src/core/storage/sqlite_ledger.js";
import { listBoardObligations, listRuntimeObligations, mutate } from "../src/service/index.js";

const AGENT_RUNTIME_REF = { scheme: "openclaw", type: "agent", id: "parley-agent" };
const CALLER = {
  actor_id: "parley-agent",
  actor_type: "agent",
  runtime: "openclaw",
  board_id: "project"
};

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
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "parley-sqlite-ledger-test-"));
  try {
    await callback(tempRoot);
  } finally {
    closeAllParleySqliteLedgers();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function createProjectBoardConfig(baseConfig) {
  const boardRoot = path.join(baseConfig.parleyRoot, "boards", "project");
  return {
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
        resolved_root: path.join(baseConfig.__tempRoot, "repo", "plans"),
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
        runtime_refs: [AGENT_RUNTIME_REF],
        roles: ["implementation"],
        permissions: { preset: "board_admin" }
      }
    ],
    permission_model: { mode: "board_wide_all_tools", future_agent_scoping: true }
  };
}

function servicePluginConfig(tempRoot) {
  const baseConfig = {
    parleyMode: "service",
    repoRoot: path.join(tempRoot, "repo"),
    parleyDbPath: path.join(tempRoot, "db", "parley.sqlite"),
    parleyRoot: path.join(tempRoot, "board-runtime"),
    parleyAgentId: "parley-agent",
    parleyDefaultBoard: "project",
    __tempRoot: tempRoot
  };
  return {
    ...baseConfig,
    parleyDefaultBoards: {
      project: createProjectBoardConfig(baseConfig)
    }
  };
}

function standalonePluginConfig(tempRoot) {
  const baseConfig = {
    parleyMode: "standalone",
    repoRoot: path.join(tempRoot, "repo"),
    parleyStateRoot: path.join(tempRoot, "state"),
    parleyRoot: path.join(tempRoot, "board-runtime"),
    __tempRoot: tempRoot
  };
  return {
    ...baseConfig,
    parleyDefaultBoards: {
      project: createProjectBoardConfig(baseConfig)
    }
  };
}

test("service SQLite ledger migrations are explicit and idempotent", async () => {
  await withTempRoot(async (tempRoot) => {
    const pluginConfig = servicePluginConfig(tempRoot);

    const first = await migrateParleySqliteLedger(pluginConfig, { surface: "service" });
    assert.equal(first.status, "ok");
    assert.deepEqual(first.applied, [1]);
    assert.deepEqual(first.skipped, []);
    assert.equal(await exists(pluginConfig.parleyDbPath), true);

    const second = await migrateParleySqliteLedger(pluginConfig, { surface: "service" });
    assert.equal(second.status, "ok");
    assert.deepEqual(second.applied, []);
    assert.deepEqual(second.skipped, [1]);
  });
});

test("service mode stores runtime and board records in SQLite", async () => {
  await withTempRoot(async (tempRoot) => {
    const pluginConfig = servicePluginConfig(tempRoot);
    await migrateParleySqliteLedger(pluginConfig, { surface: "service" });
    const board = pluginConfig.parleyDefaultBoards.project;

    await saveThreadRecord(pluginConfig, createThreadRecord({
      thread_id: "thread_sqlite_runtime",
      kind: "coordination",
      control_mode: "peer",
      initiator: "reviewer",
      recipient: "parley-agent",
      next_action_owner: "parley-agent",
      thread_state: "active"
    }));
    const threads = await listThreadRecords(pluginConfig);
    assert.deepEqual(threads.map((thread) => thread.thread_id), ["thread_sqlite_runtime"]);

    await saveObligationRecord(pluginConfig, board, createObligationRecord({
      board_id: "project",
      obligation_id: "obligation_sqlite_direct",
      agent: "parley-agent",
      type: "review",
      target: { object_id: "object_sqlite" }
    }));
    const obligations = await listObligationRecords(pluginConfig, board);
    assert.deepEqual(obligations.map((obligation) => obligation.obligation_id), ["obligation_sqlite_direct"]);

    assert.equal(await exists(path.join(board.state_root, "obligations", "obligation_sqlite_direct.json")), false);
  });
});

test("representative service command writes and query reads through SQLite ledger", async () => {
  await withTempRoot(async (tempRoot) => {
    const pluginConfig = servicePluginConfig(tempRoot);
    await migrateParleySqliteLedger(pluginConfig, { surface: "service" });

    const created = await mutate({
      caller: CALLER,
      input: {
        action: "create_obligation",
        board_id: "project",
        input: {
          obligationId: "obligation_sqlite_command",
          agent: "parley-agent",
          type: "review",
          target: { object_id: "object_sqlite_command" },
          reason: "Verify SQLite service ledger writes."
        }
      }
    }, { pluginConfig });

    assert.equal(created.status, "ok");
    assert.equal(created.data.obligation.obligation_id, "obligation_sqlite_command");

    const queried = await listBoardObligations({
      caller: CALLER,
      input: { board_id: "project", filter: "all" }
    }, { pluginConfig });

    assert.equal(queried.status, "ok");
    assert.deepEqual(queried.data.obligations.map((item) => item.obligation.obligation_id), ["obligation_sqlite_command"]);
  });
});

test("service runtime obligation query reads SQLite thread records", async () => {
  await withTempRoot(async (tempRoot) => {
    const pluginConfig = servicePluginConfig(tempRoot);
    await migrateParleySqliteLedger(pluginConfig, { surface: "service" });

    await saveThreadRecord(pluginConfig, createThreadRecord({
      thread_id: "thread_sqlite_query",
      kind: "coordination",
      control_mode: "peer",
      initiator: "reviewer",
      recipient: "parley-agent",
      next_action_owner: "parley-agent",
      thread_state: "active"
    }));

    const queried = await listRuntimeObligations({
      caller: CALLER,
      input: { filter: "all" }
    }, { pluginConfig });

    assert.equal(queried.status, "ok");
    assert.deepEqual(queried.data.obligations.map((obligation) => obligation.target.thread_id), ["thread_sqlite_query"]);
  });
});

test("client mode cannot instantiate local SQLite ledger even with DB path config", async () => {
  await withTempRoot(async (tempRoot) => {
    const dbPath = path.join(tempRoot, "db", "client.sqlite");
    assert.throws(
      () => getParleySqliteLedger({
        parleyMode: "client",
        parleyApiUrl: "http://127.0.0.1:7331",
        parleyDbPath: dbPath
      }, { surface: "sdk" }),
      (error) => error?.code === "PARLEY_CLIENT_LOCAL_STATE_FORBIDDEN"
    );
    assert.equal(await exists(dbPath), false);
  });
});

test("standalone remains intentionally file-backed", async () => {
  await withTempRoot(async (tempRoot) => {
    const pluginConfig = standalonePluginConfig(tempRoot);
    const board = pluginConfig.parleyDefaultBoards.project;
    await saveObligationRecord(pluginConfig, board, createObligationRecord({
      board_id: "project",
      obligation_id: "obligation_standalone_file",
      agent: "parley-agent",
      type: "review",
      target: { object_id: "object_file" }
    }));

    assert.equal(await exists(path.join(board.state_root, "obligations", "obligation_standalone_file.json")), true);
    assert.equal(getParleySqliteLedger(pluginConfig), null);
  });
});

test("service DB path rejects the default OpenClaw workspaces root", () => {
  const workspaceDbPath = path.join(os.homedir(), ".openclaw", "workspaces", "parley", "parley.sqlite");
  assert.throws(
    () => resolveParleyRuntimeConfig({
      surface: "service",
      env: {},
      pluginConfig: {
        parleyMode: "service",
        repoRoot: "/srv/workspaces/Parley",
        parleyDbPath: workspaceDbPath
      }
    }),
    (error) => error?.code === "PARLEY_SERVICE_DB_PATH_FORBIDDEN"
  );
});
