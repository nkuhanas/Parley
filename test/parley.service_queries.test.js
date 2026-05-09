import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  describe,
  getBoardProjection,
  getPlanSetupStatus,
  listBoardObligations,
  listRuntimeObligations,
  myBoards,
  SERVICE_ERROR_CODES,
  whereAmI
} from "../src/service/index.js";
import { resolveParleyBoardRegistry } from "../src/core/config.js";
import { createObligationRecord, saveObligationRecord, savePlanSetupRecord } from "../src/core/storage/board_store.js";
import { createThreadRecord, saveThreadRecord } from "../src/core/storage/store.js";

const AGENT_RUNTIME_REF = { scheme: "openclaw", type: "agent", id: "parley-agent" };
const CALLER = { actor_id: "parley-agent", actor_type: "agent", runtime: "openclaw", board_id: "project" };

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
        runtime_refs: [AGENT_RUNTIME_REF],
        roles: ["implementation"],
        permissions: { preset: "board_admin" }
      }
    ],
    permission_model: { mode: "board_wide_all_tools", future_agent_scoping: true }
  };
}

async function makePluginConfig() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "parley-service-query-test-"));
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

async function withPluginConfig(run) {
  const pluginConfig = await makePluginConfig();
  try {
    await fs.mkdir(path.join(pluginConfig.__tempRoot, "repo", "plans"), { recursive: true });
    await run(pluginConfig);
  } finally {
    await fs.rm(pluginConfig.__tempRoot, { recursive: true, force: true });
  }
}

function testPlanRecord(board) {
  return {
    board_id: board.board_id,
    plan_id: "plan_service_query",
    artifact_id: "artifact_service_query",
    title: "Service Query Plan",
    authority: "implementation-plan",
    status: "draft",
    version: 1,
    owner: "parley-agent",
    participants: ["parley-agent"],
    landing: {
      namespace: "project_plans",
      subpath: "service",
      filename: "query-plan.md",
      uri: "repo://plans/service/query-plan.md",
      resolved_path: path.join(board.board_root, "query-plan.md")
    },
    overview: {
      purpose: "Test service query setup state.",
      background: "Service queries should use core records directly.",
      scope_summary: "Exercise plan setup status.",
      in_scope: ["Query plan setup"],
      out_of_scope: ["Mutate plan setup"],
      current_state: "Plan exists.",
      target_state: "Status is queryable.",
      approach: "Load plan record and derive state.",
      assumptions: [],
      non_goals: [],
      open_questions: [],
      acceptance_criteria: ["Setup state returns complete"],
      risks_and_constraints: []
    },
    phases: [
      {
        phase_id: "phase_1",
        title: "Initial implementation",
        kind: "implementation",
        owner: "parley-agent",
        status: "draft",
        entry_criteria: ["Plan exists."],
        work: ["Query it."],
        exit_criteria: ["Query succeeds."],
        supporting_agents: []
      }
    ],
    review: { required_reviewers: [], approvals: [], objections: [] }
  };
}

test("service myBoards resolves memberships without OpenClaw tool wrappers", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const result = await myBoards({ caller: CALLER }, { pluginConfig });

    assert.equal(result.status, "ok");
    assert.equal(result.data.global_agent_id, "parley-agent");
    assert.deepEqual(result.data.boards.map((board) => board.board_id), ["project"]);
  });
});

test("service getBoardProjection uses caller board default for read-only projection", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const result = await getBoardProjection({ caller: CALLER, input: {} }, { pluginConfig });

    assert.equal(result.status, "ok");
    assert.equal(result.data.identity.board_id, "project");
    assert.equal(result.data.projection.board_id, "project");
    assert.equal(result.data.projection.counts.agents, 1);
  });
});

test("service getPlanSetupStatus reads setup state through core storage", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const board = resolveParleyBoardRegistry(pluginConfig).boards.project;
    await savePlanSetupRecord(pluginConfig, board, testPlanRecord(board));

    const result = await getPlanSetupStatus({
      caller: CALLER,
      input: { plan_id: "plan_service_query" }
    }, { pluginConfig });

    assert.equal(result.status, "ok");
    assert.equal(result.data.plan.plan_id, "plan_service_query");
    assert.equal(result.data.plan.phase_count, 1);
    assert.equal(result.data.setupState.setupComplete, true);
  });
});

test("service board-scoped queries report missing board ids with protocol codes", async () => {
  await withPluginConfig(async (pluginConfig) => {
    await assert.rejects(
      () => getBoardProjection({ caller: { actor_id: "parley-agent", actor_type: "agent", runtime: "openclaw" }, input: {} }, { pluginConfig }),
      (error) => {
        assert.equal(error.code, SERVICE_ERROR_CODES.MISSING_BOARD_ID);
        return true;
      }
    );
  });
});

test("service whereAmI bridges existing recovery shape through query envelope", async () => {
  await withPluginConfig(async (pluginConfig) => {
    await saveThreadRecord(pluginConfig, createThreadRecord({
      thread_id: "thread_service_runtime",
      kind: "coordination",
      control_mode: "peer",
      initiator: "project-reviewer",
      recipient: "parley-agent",
      next_action_owner: "parley-agent",
      thread_state: "active"
    }));

    const result = await whereAmI({ caller: CALLER, input: { verbosity: "compact" } }, { pluginConfig });

    assert.equal(result.status, "ok");
    assert.equal(result.data.tool, "parley_where_am_i");
    assert.equal(result.data.scope, "runtime_and_board");
    assert.equal(result.data.runtime.obligations.length, 1);
    assert.equal(result.data.projection.board_agent_id, "parley-agent");
  });
});

test("service listRuntimeObligations remains non-board-affined", async () => {
  await withPluginConfig(async (pluginConfig) => {
    await saveThreadRecord(pluginConfig, createThreadRecord({
      thread_id: "thread_runtime_only",
      kind: "coordination",
      control_mode: "peer",
      initiator: "project-reviewer",
      recipient: "parley-agent",
      next_action_owner: "parley-agent",
      thread_state: "active"
    }));

    const result = await listRuntimeObligations({ caller: CALLER, input: {} }, { pluginConfig });
    assert.equal(result.status, "ok");
    assert.equal(result.data.tool, "parley_query_runtime_obligations");
    assert.equal(result.data.counts.matched, 1);
    assert.equal(result.data.obligations[0].target.thread_id, "thread_runtime_only");

    await assert.rejects(
      () => listRuntimeObligations({ caller: CALLER, input: { board_id: "project" } }, { pluginConfig }),
      (error) => {
        assert.equal(error.code, SERVICE_ERROR_CODES.VALIDATION_FAILED);
        assert.match(error.message, /not board-affined/);
        return true;
      }
    );
  });
});

test("service listBoardObligations uses caller board default without changing obligation filtering", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const board = resolveParleyBoardRegistry(pluginConfig).boards.project;
    await saveObligationRecord(pluginConfig, board, createObligationRecord({
      board_id: "project",
      obligation_id: "obligation_service_query",
      agent: "parley-agent",
      type: "implement_phase",
      status: "active",
      target: { artifact_id: "artifact_service_query", artifact_version: 1, plan_id: "plan_service_query", phase_id: "phase_1" },
      reason: "service query test obligation"
    }));

    const result = await listBoardObligations({ caller: CALLER, input: { target_kinds: ["plans"] } }, { pluginConfig });

    assert.equal(result.status, "ok");
    assert.equal(result.data.tool, "parley_query_board_obligations");
    assert.equal(result.data.counts.matched, 1);
    assert.deepEqual(result.data.obligations[0].target_kinds, ["plans", "artifacts", "phases"]);
  });
});

test("service describe bridges descriptors through query envelope", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const result = await describe({ caller: CALLER, input: { topic: "query" } }, { pluginConfig });

    assert.equal(result.status, "ok");
    assert.equal(result.data.tool, "parley_describe");
    assert.equal(result.data.topic, "query");
    assert.ok(result.data.descriptor.actions.includes("board_obligations"));
  });
});
