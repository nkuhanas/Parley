import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createParleyRemoteClient } from "../src/client/index.js";
import { createParleyHttpServer, SERVICE_ERROR_CODES } from "../src/service/index.js";

const AUTH_TOKEN = "test-token";

async function withTempRoot(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "parley-http-service-test-"));
  try {
    await callback(tempRoot);
  } finally {
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
    repoRoot: path.join(tempRoot, "repo"),
    parleyRuntimeRoot: path.join(tempRoot, "thread-runtime"),
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
      assert.deepEqual(meta.body.data.commands, ["mutate"]);
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
