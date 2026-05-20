import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createParleyRemoteClient } from "../src/client/index.js";
import { closeAllParleySqliteLedgers, migrateParleySqliteLedger } from "../src/core/storage/sqlite_ledger.js";
import { createParleyHttpServer, SERVICE_ERROR_CODES } from "../src/service/index.js";

const AUTH_TOKEN = "test-token";

async function withTempRoot(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "parley-http-service-test-"));
  try {
    await callback(tempRoot);
  } finally {
    closeAllParleySqliteLedgers();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function createProjectBoardConfig(pluginConfig = {}) {
  const boardRoot = path.join(pluginConfig.parleyRoot, "boards", "project");
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
        resolved_root: path.join(pluginConfig.__tempRoot, "repo", "plans"),
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
        runtime_refs: [
          { scheme: "openclaw", type: "agent", id: "parley-agent" },
          { scheme: "sdk", type: "agent", id: "parley-agent" },
          { scheme: "cli", type: "agent", id: "parley-agent" }
        ],
        roles: ["implementation"],
        permissions: { preset: "board_admin" }
      }
    ],
    permission_model: { mode: "board_wide_all_tools", future_agent_scoping: true }
  };
}

function makePluginConfig(tempRoot) {
  const baseConfig = {
    parleyMode: "service",
    repoRoot: path.join(tempRoot, "repo"),
    parleyDbPath: path.join(tempRoot, "db", "parley.sqlite"),
    parleyRoot: path.join(tempRoot, "board-runtime"),
    parleyProjectDefaultPlanLandingRoot: path.join(tempRoot, "repo", "plans"),
    parleyProjectAllowedReferenceRoots: [path.join(tempRoot, "repo", "plans")],
    parleyProjectAllowedLandingRoots: [path.join(tempRoot, "repo", "plans")],
    __tempRoot: tempRoot
  };
  return {
    ...baseConfig,
    parleyDefaultBoards: {
      project: createProjectBoardConfig(baseConfig)
    }
  };
}

async function withHttpService(options, callback) {
  if (options.pluginConfig?.parleyMode === "service") {
    await migrateParleySqliteLedger(options.pluginConfig, { surface: "service" });
  }
  const server = createParleyHttpServer(options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  return { response, body: await response.json() };
}

function authHeaders(extra = {}) {
  return { authorization: `Bearer ${AUTH_TOKEN}`, ...extra };
}

test("HTTP service exposes unauthenticated health and protected metadata", async () => {
  await withTempRoot(async (tempRoot) => {
    await withHttpService({ pluginConfig: makePluginConfig(tempRoot), authToken: AUTH_TOKEN }, async (baseUrl) => {
      const health = await fetchJson(`${baseUrl}/health`);
      assert.equal(health.response.status, 200);
      assert.equal(health.body.status, "ok");
      assert.equal(health.body.data.service, "parley");

      const unauthMeta = await fetchJson(`${baseUrl}/v1/meta`);
      assert.equal(unauthMeta.response.status, 401);
      assert.equal(unauthMeta.body.code, SERVICE_ERROR_CODES.AUTH_REQUIRED);

      const meta = await fetchJson(`${baseUrl}/v1/meta`, { headers: authHeaders() });
      assert.equal(meta.response.status, 200);
      assert.equal(meta.body.status, "ok");
      assert.ok(meta.body.data.queries.includes("describe"));
      assert.ok(meta.body.data.queries.includes("readPlanProjection"));
      assert.deepEqual(meta.body.data.commands, ["mutate", "runtime"]);
      assert.equal(meta.body.data.boards, undefined);
    });
  });
});

test("remote client calls real HTTP service for health and discovery queries", async () => {
  await withTempRoot(async (tempRoot) => {
    await fs.mkdir(path.join(tempRoot, "repo", "plans"), { recursive: true });
    await withHttpService({ pluginConfig: makePluginConfig(tempRoot), authToken: AUTH_TOKEN }, async (baseUrl) => {
      const client = createParleyRemoteClient({
        apiUrl: baseUrl,
        authToken: AUTH_TOKEN,
        agentId: "parley-agent",
        defaultBoard: "project",
        runtime: "sdk"
      });

      const health = await client.health();
      assert.equal(health.status, "ok");

      const described = await client.describe({ topic: "targets" });
      assert.equal(described.status, "ok");
      assert.equal(described.data.tool, "parley_describe");

      const boards = await client.myBoards();
      assert.equal(boards.status, "ok");
      assert.deepEqual(boards.data.boards.map((board) => board.board_id), ["project"]);

      const recovery = await client.whereAmI({ boardId: "project", verbosity: "compact" });
      assert.equal(recovery.status, "ok");
      assert.equal(recovery.data.projection.board_id, "project");

      const meta = await client.meta();
      assert.equal(meta.status, "ok");
      assert.ok(meta.data.queries.includes("whereAmI"));
      assert.ok(meta.data.queries.includes("readPlanProjection"));
    });
  });
});

test("remote client calls real HTTP service runtime command with caller-managed transport", async () => {
  await withTempRoot(async (tempRoot) => {
    await fs.mkdir(path.join(tempRoot, "repo", "plans"), { recursive: true });
    await withHttpService({ pluginConfig: makePluginConfig(tempRoot), authToken: AUTH_TOKEN }, async (baseUrl) => {
      const client = createParleyRemoteClient({
        apiUrl: baseUrl,
        authToken: AUTH_TOKEN,
        agentId: "parley-agent",
        defaultBoard: "project",
        runtime: "sdk"
      });

      const opened = await client.runtime({
        action: "open_thread",
        input: {
          initiator: "parley-agent",
          recipient: "parley-peer",
          bodyText: "Please take a look.",
          targetSessionKey: "agent:parley-peer:session:test",
          initiatorSessionKey: "agent:parley-agent:session:test"
        }
      });
      assert.equal(opened.status, "ok");
      assert.equal(opened.data.tool, "parley_open_thread");
      assert.equal(opened.data.transport_required, true);
      assert.equal(opened.data.transport_request.target_session_key, "agent:parley-peer:session:test");
      assert.equal(typeof opened.data.transport_request.outbound_text, "string");

      const dispatchHandoff = await client.runtime({
        action: "dispatch_transport_request",
        input: {
          threadId: opened.data.thread.thread_id,
          messageId: opened.data.message.message_id
        }
      });
      assert.equal(dispatchHandoff.status, "ok");
      assert.equal(dispatchHandoff.data.tool, "parley_dispatch_transport_request");
      assert.equal(dispatchHandoff.data.transport_required, true);
      assert.equal(dispatchHandoff.data.transport_request.target_session_key, "agent:parley-peer:session:test");

      const replied = await client.runtime({
        action: "reply_thread",
        input: {
          threadId: opened.data.thread.thread_id,
          sender: "parley-peer",
          bodyText: "Here is the answer."
        }
      });
      assert.equal(replied.status, "ok");
      assert.equal(replied.data.tool, "parley_reply_thread");
      assert.equal(replied.data.transport_required, true);
      assert.equal(replied.data.dispatch_status, undefined);
      assert.equal(replied.data.message.transport_state, "pending_dispatch");
      assert.equal(replied.data.transport_request.target_session_key, "agent:parley-agent:session:test");
    });
  });
});

test("HTTP service protects commands and fails closed for unknown names", async () => {
  await withTempRoot(async (tempRoot) => {
    await withHttpService({ pluginConfig: makePluginConfig(tempRoot), authToken: AUTH_TOKEN }, async (baseUrl) => {
      const unauthCommand = await fetchJson(`${baseUrl}/v1/commands/mutate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caller: { actor_id: "parley-agent" }, input: {} })
      });
      assert.equal(unauthCommand.response.status, 401);
      assert.equal(unauthCommand.body.code, SERVICE_ERROR_CODES.AUTH_REQUIRED);

      const unknownCommand = await fetchJson(`${baseUrl}/v1/commands/notACommand`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ caller: { actor_id: "parley-agent" }, input: {} })
      });
      assert.equal(unknownCommand.response.status, 404);
      assert.equal(unknownCommand.body.status, "error");
      assert.equal(unknownCommand.body.code, SERVICE_ERROR_CODES.UNSUPPORTED_ACTION);

      const unknownQuery = await fetchJson(`${baseUrl}/v1/queries/notAQuery`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ caller: { actor_id: "parley-agent" }, input: {} })
      });
      assert.equal(unknownQuery.response.status, 404);
      assert.equal(unknownQuery.body.status, "error");
      assert.equal(unknownQuery.body.code, SERVICE_ERROR_CODES.UNSUPPORTED_ACTION);
    });
  });
});

test("HTTP query auth is protected by default and configurable for tests", async () => {
  await withTempRoot(async (tempRoot) => {
    await withHttpService({ pluginConfig: makePluginConfig(tempRoot), authToken: AUTH_TOKEN }, async (baseUrl) => {
      const protectedQuery = await fetchJson(`${baseUrl}/v1/queries/describe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caller: { actor_id: "parley-agent" }, input: {} })
      });
      assert.equal(protectedQuery.response.status, 401);
      assert.equal(protectedQuery.body.code, SERVICE_ERROR_CODES.AUTH_REQUIRED);
    });

    await withHttpService({ pluginConfig: makePluginConfig(tempRoot), requireQueryAuth: false }, async (baseUrl) => {
      const publicQuery = await fetchJson(`${baseUrl}/v1/queries/describe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caller: { actor_id: "parley-agent", runtime: "sdk" }, input: {} })
      });
      assert.equal(publicQuery.response.status, 200);
      assert.equal(publicQuery.body.status, "ok");
    });
  });
});
