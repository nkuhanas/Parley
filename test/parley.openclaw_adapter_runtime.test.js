import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { registerParleyTools } from "../src/adapters/openclaw/index.js";

const OPENCLAW_TOOL_NAMES = [
  "parley_describe",
  "parley_open_thread",
  "parley_claim_turn",
  "parley_reply_thread",
  "parley_probe_thread",
  "parley_settle_turn",
  "parley_conclude_thread",
  "parley_record_transport_result",
  "parley_dispatch_transport_request",
  "parley_record_human_summary_anchor",
  "parley_register_artifact",
  "parley_create_object",
  "parley_record_effect",
  "parley_create_obligation",
  "parley_create_trigger",
  "parley_resolve_obligation",
  "parley_where_am_i",
  "parley_my_boards",
  "parley_board_projection",
  "parley_record_relationship",
  "parley_remove_relationship",
  "parley_checkpoint_projection",
  "parley_validate_plan",
  "parley_validate_state",
  "parley_create_plan",
  "parley_write_plan_overview",
  "parley_add_plan_phase",
  "parley_add_plan_checkpoint",
  "parley_get_plan_setup_status",
  "parley_request_plan_review",
  "parley_mark_plan_ready",
  "parley_record_review_decision",
  "parley_activate_plan",
  "parley_pause_plan",
  "parley_resume_plan",
  "parley_record_plan_disposition",
  "parley_record_phase_outcome",
  "parley_query_runtime_obligations",
  "parley_query_board_obligations",
  "parley_query_search",
  "parley_query",
  "parley_mutate"
];

const TOOL_CONTEXT = {
  agentId: "kairos-operator",
  sessionKey: "session-123",
  parentAgentId: "kairos-parent"
};

function jsonResponse(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? "OK",
    headers: { get: (name) => name.toLowerCase() === "content-type" ? "application/json" : undefined },
    json: async () => body
  };
}

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
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "parley-openclaw-adapter-test-"));
  try {
    await callback(tempRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function openclawEnv(tempRoot, overrides = {}) {
  return {
    HOME: tempRoot,
    USER: "kairos-operator",
    ...overrides
  };
}

function projectConfig(tempRoot, overrides = {}) {
  const boardRoot = path.join(tempRoot, "boards", "project");
  return {
    parleyMode: "standalone",
    parleyStateRoot: path.join(tempRoot, "state"),
    parleyRuntimeRoot: path.join(tempRoot, "runtime"),
    parleyAgentId: "kairos-operator",
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
            agent_id: "kairos-operator",
            board_agent_id: "kairos-operator",
            display_name: "Kairos Operator",
            kind: "agent",
            runtime_refs: [{ scheme: "openclaw", type: "agent", id: "kairos-operator" }],
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

function registeredTools(api, toolContext = TOOL_CONTEXT) {
  const tools = new Map();
  registerParleyTools({
    ...api,
    registerTool(toolOrFactory) {
      const tool = typeof toolOrFactory === "function" ? toolOrFactory(toolContext) : toolOrFactory;
      tools.set(tool.name, tool);
    }
  });
  return tools;
}

test("OpenClaw adapter registers the stable tool names in explicit client mode", async () => {
  await withTempRoot(async (tempRoot) => {
    const tools = registeredTools({
      env: openclawEnv(tempRoot),
      pluginConfig: {
        parleyMode: "client",
        parleyApiUrl: "http://parley.test",
        parleyAgentId: "kairos-operator",
        parleyDefaultBoard: "project"
      },
      fetchImpl: async () => jsonResponse({ status: "ok" })
    });

    assert.deepEqual([...tools.keys()], OPENCLAW_TOOL_NAMES);
  });
});

test("OpenClaw adapter client mode forwards caller context to the remote SDK", async () => {
  await withTempRoot(async (tempRoot) => {
    const calls = [];
    const tools = registeredTools({
      env: openclawEnv(tempRoot),
      pluginConfig: {
        parleyMode: "client",
        parleyApiUrl: "http://parley.test/base",
        parleyAgentId: "kairos-operator",
        parleyDefaultBoard: "project"
      },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse({
          status: "ok",
          data: {
            global_agent_id: "kairos-operator",
            default_board: "project",
            boards: [{ board_id: "project" }]
          }
        });
      }
    });

    const result = await tools.get("parley_my_boards").execute(null, {});

    assert.equal(result.details.result.global_agent_id, "kairos-operator");
    assert.equal(calls[0].url, "http://parley.test/base/v1/queries/myBoards");
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body.caller.runtime_ref, { scheme: "openclaw", type: "agent", id: "kairos-operator" });
    assert.equal(body.caller.actor_id, "kairos-operator");
    assert.equal(body.caller.runtime, "openclaw");
    assert.deepEqual(body.caller.runtime_aliases, [
      { runtime_ref: { scheme: "openclaw", type: "session", id: "session-123" }, source: "adapter_discovered" },
      { runtime_ref: { scheme: "openclaw", type: "agent", id: "kairos-parent" }, source: "adapter_discovered" }
    ]);
  });
});

test("OpenClaw adapter client mode routes writes through remote mutate command", async () => {
  await withTempRoot(async (tempRoot) => {
    const calls = [];
    const tools = registeredTools({
      env: openclawEnv(tempRoot),
      pluginConfig: {
        parleyMode: "client",
        parleyApiUrl: "http://parley.test",
        parleyAgentId: "kairos-operator",
        parleyDefaultBoard: "project"
      },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse({
          status: "ok",
          data: {
            ok: true,
            summary: "Created a board obligation.",
            tool: "parley_create_obligation",
            obligation: { obligation_id: "obligation_remote" }
          }
        });
      }
    });

    const result = await tools.get("parley_create_obligation").execute(null, {
      boardId: "project",
      obligationId: "obligation_remote",
      agent: "kairos-operator",
      type: "review",
      target: { object_id: "object_remote" }
    });

    assert.equal(result.details.tool, "parley_create_obligation");
    assert.equal(result.details.obligation.obligation_id, "obligation_remote");
    assert.equal(calls[0].url, "http://parley.test/v1/commands/mutate");
    assert.deepEqual(JSON.parse(calls[0].init.body).input, {
      action: "create_obligation",
      boardId: "project",
      input: {
        obligationId: "obligation_remote",
        agent: "kairos-operator",
        type: "review",
        target: { object_id: "object_remote" }
      }
    });
  });
});

test("OpenClaw adapter explicit standalone mode uses embedded local service boundary", async () => {
  await withTempRoot(async (tempRoot) => {
    const tools = registeredTools({
      env: openclawEnv(tempRoot),
      pluginConfig: projectConfig(tempRoot),
      fetchImpl: async () => {
        throw new Error("standalone adapter must not call remote fetch");
      }
    });

    const result = await tools.get("parley_my_boards").execute(null, {});

    assert.equal(result.details.result.global_agent_id, "kairos-operator");
    assert.equal(result.details.result.boards[0].board_id, "project");
  });
});

test("OpenClaw adapter honors plugin config over PARLEY_CONFIG", async () => {
  await withTempRoot(async (tempRoot) => {
    const configPath = path.join(tempRoot, "parley.config.json");
    await fs.writeFile(configPath, JSON.stringify({
      parleyMode: "client",
      parleyApiUrl: "http://file-config.test",
      parleyAgentId: "kairos-operator",
      parleyDefaultBoard: "project"
    }), "utf8");
    const calls = [];
    const tools = registeredTools({
      env: openclawEnv(tempRoot, { PARLEY_CONFIG: configPath }),
      pluginConfig: {
        parleyMode: "client",
        parleyApiUrl: "http://plugin-config.test",
        parleyAgentId: "kairos-operator",
        parleyDefaultBoard: "project"
      },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse({ status: "ok", data: { topic: "overview" } });
      }
    });

    await tools.get("parley_describe").execute(null, {});
    assert.equal(calls[0].url, "http://plugin-config.test/v1/queries/describe");
  });
});

test("OpenClaw adapter can resolve client mode from PARLEY_CONFIG", async () => {
  await withTempRoot(async (tempRoot) => {
    const configPath = path.join(tempRoot, "parley.config.json");
    await fs.writeFile(configPath, JSON.stringify({
      parleyMode: "client",
      parleyApiUrl: "http://file-config.test",
      parleyAgentId: "kairos-operator",
      parleyDefaultBoard: "project"
    }), "utf8");
    const calls = [];
    const tools = registeredTools({
      env: openclawEnv(tempRoot, { PARLEY_CONFIG: configPath }),
      pluginConfig: {},
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse({ status: "ok", data: { topic: "overview" } });
      }
    });

    await tools.get("parley_describe").execute(null, {});
    assert.equal(calls[0].url, "http://file-config.test/v1/queries/describe");
  });
});

test("OpenClaw adapter client mode refuses state or DB env before local state", async () => {
  await withTempRoot(async (tempRoot) => {
    const stateRoot = path.join(tempRoot, "client-state-should-not-exist");
    assert.throws(
      () => registeredTools({
        env: openclawEnv(tempRoot, {
          PARLEY_MODE: "client",
          PARLEY_API_URL: "http://parley.test",
          PARLEY_STATE_ROOT: stateRoot,
          PARLEY_DB_PATH: path.join(tempRoot, "client.sqlite")
        }),
        pluginConfig: {},
        fetchImpl: async () => jsonResponse({ status: "ok" })
      }),
      (error) => error?.code === "PARLEY_CLIENT_LOCAL_STATE_FORBIDDEN"
    );
    assert.equal(await exists(stateRoot), false);
  });
});

test("OpenClaw adapter client mode fails runtime transport tools clearly", async () => {
  await withTempRoot(async (tempRoot) => {
    const tools = registeredTools({
      env: openclawEnv(tempRoot),
      pluginConfig: {
        parleyMode: "client",
        parleyApiUrl: "http://parley.test",
        parleyAgentId: "kairos-operator",
        parleyDefaultBoard: "project"
      },
      fetchImpl: async () => jsonResponse({ status: "ok" })
    });

    await assert.rejects(
      () => tools.get("parley_open_thread").execute(null, { initiator: "a", recipient: "b", bodyText: "hi", targetSessionKey: "session:b" }),
      (error) => error?.code === "PARLEY_OPENCLAW_CLIENT_TOOL_UNSUPPORTED"
    );
  });
});
