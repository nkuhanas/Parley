import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  checkpointProjection,
  describe,
  getBoardProjection,
  getPlanSetupStatus,
  getPlanStatus,
  listBoardObligations,
  listRuntimeObligations,
  mutate,
  myBoards,
  readPlanProjection,
  SERVICE_ERROR_CODES,
  searchReferences,
  validatePlan,
  validateState,
  whereAmI
} from "../src/service/index.js";
import { resolveParleyBoardRegistry } from "../src/core/config.js";
import { createParleyPlanV1Document } from "../src/core/schema/index.js";
import {
  createArtifactRecord,
  createObligationRecord,
  loadProjectionCheckpointRecord,
  saveArtifactRecord,
  saveObligationRecord,
  savePlanSetupRecord
} from "../src/core/storage/board_store.js";
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

test("service getPlanStatus reads compact lifecycle position", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const board = resolveParleyBoardRegistry(pluginConfig).boards.project;
    const plan = {
      ...testPlanRecord(board),
      status: "active",
      managed: { current_phase_id: "phase_1", lifecycle_revision: 1, activeLifecycleObligationIds: [], generatedObligationIds: [] },
      phases: [{ ...testPlanRecord(board).phases[0], status: "active" }]
    };
    await savePlanSetupRecord(pluginConfig, board, plan);

    const result = await getPlanStatus({
      caller: CALLER,
      input: { plan_id: plan.plan_id }
    }, { pluginConfig });

    assert.equal(result.status, "ok");
    assert.equal(result.data.plan.plan_id, "plan_service_query");
    assert.equal(result.data.plan.current_phase_id, "phase_1");
    assert.equal(result.data.current_phase.phase_id, "phase_1");
    assert.equal(result.data.next_action.kind, "record_phase_outcome");
  });
});


test("service readPlanProjection renders tracked plan markdown through query envelope", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const board = resolveParleyBoardRegistry(pluginConfig).boards.project;
    const plan = testPlanRecord(board);
    await savePlanSetupRecord(pluginConfig, board, plan);

    const result = await readPlanProjection({
      caller: CALLER,
      input: { plan_id: plan.plan_id }
    }, { pluginConfig });

    assert.equal(result.status, "ok");
    assert.equal(result.data.tool, "parley_read_plan_projection");
    assert.equal(result.data.identity.board_id, "project");
    assert.equal(result.data.projection.kind, "plan_markdown");
    assert.equal(result.data.projection.uri, "repo://plans/service/query-plan.md");
    assert.equal(result.data.projection.namespace, "project_plans");
    assert.equal(result.data.projection.serviceLocalPath, plan.landing.resolved_path);
    assert.match(result.data.projection.body, /Service Query Plan/);
    assert.match(result.data.projection.contentDigest, /^sha256:/);
    assert.equal(result.data.plan.projection_validation.ok, true);
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

test("service validatePlan validates tracked plan documents through core state", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const board = resolveParleyBoardRegistry(pluginConfig).boards.project;
    const plan = testPlanRecord(board);
    await savePlanSetupRecord(pluginConfig, board, plan);
    await fs.mkdir(path.dirname(plan.landing.resolved_path), { recursive: true });
    await fs.writeFile(plan.landing.resolved_path, createParleyPlanV1Document({
      authority: "implementation-plan",
      plan_id: plan.plan_id,
      board_id: "project",
      title: plan.title,
      status: "draft",
      version: 1,
      owner: "parley-agent",
      participants: ["parley-agent"],
      scope: { summary: "Test service validation.", in: ["Validate"], out: ["Mutate"] },
      landing: { namespace: "project_plans", subpath: "service", filename: "query-plan.md" },
      review: { required_reviewers: [], approvals: [], objections: [] },
      sections: {
        purpose: "Test service validation.",
        background: "Service validates tracked plan markdown.",
        scope: "Validate only.",
        current_state: "Plan exists.",
        target_state: "Plan validates.",
        plan: "Read and validate.",
        phases: "None recorded.",
        acceptance_criteria: "- Validation succeeds.",
        risks_and_constraints: "- Must stay read-only.",
        open_questions: "None recorded.",
        review_and_approval: "No review recorded yet.",
        change_log: "- v1: Test projection."
      }
    }), "utf8");

    const result = await validatePlan({ caller: CALLER, input: { plan_id: plan.plan_id } }, { pluginConfig });

    assert.equal(result.status, "ok");
    assert.equal(result.data.identity.board_id, "project");
    assert.equal(result.data.validation.ok, true);
    assert.equal(result.data.validation.setup_complete, true);
    assert.equal(result.data.resolved_path, plan.landing.resolved_path);
  });
});

test("service validateState validates board records through query envelope", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const result = await validateState({ caller: CALLER, input: { board_id: "project" } }, { pluginConfig });

    assert.equal(result.status, "ok");
    assert.equal(result.data.identity.board_id, "project");
    assert.equal(result.data.validation.ok, true);
    assert.equal(result.data.validation.board_id, "project");
  });
});


test("service searchReferences searches board reference namespaces through query envelope", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const docsRoot = path.join(pluginConfig.__tempRoot, "repo", "plans");
    await fs.mkdir(path.join(docsRoot, "nested"), { recursive: true });
    await fs.writeFile(
      path.join(docsRoot, "checkpoint-guide.md"),
      "Checkpoint recovery notes mention runtime search behavior.",
      "utf8"
    );
    await fs.writeFile(
      path.join(docsRoot, "nested", "reference.md"),
      "This reference mentions checkpoint once but does not match the path.",
      "utf8"
    );
    await fs.writeFile(
      path.join(docsRoot, "ignored.bin"),
      "checkpoint binary-looking file should not be searched by extension.",
      "utf8"
    );

    const result = await searchReferences({
      caller: CALLER,
      input: { query: "checkpoint", limit: 1 }
    }, { pluginConfig });

    assert.equal(result.status, "ok");
    assert.equal(result.cursor, undefined);
    assert.equal(result.data.tool, "parley_query_search");
    assert.equal(result.data.identity.board_id, "project");
    assert.deepEqual(result.data.query, { query: "checkpoint", namespaces: ["project_plans"], limit: 1 });
    assert.equal(result.data.counts.matched, 2);
    assert.equal(result.data.counts.returned, 1);
    assert.equal(result.data.counts.truncated, true);
    assert.equal(result.data.results.length, 1);
    assert.equal(result.data.results[0].namespace, "project_plans");
    assert.equal(result.data.results[0].relative_path, "checkpoint-guide.md");
    assert.equal(result.data.results[0].uri, "repo://plans/checkpoint-guide.md");
    assert.match(result.data.results[0].excerpt, /Checkpoint recovery/);
  });
});

test("service searchReferences rejects missing search queries", async () => {
  await withPluginConfig(async (pluginConfig) => {
    await assert.rejects(
      () => searchReferences({ caller: CALLER, input: { board_id: "project" } }, { pluginConfig }),
      (error) => {
        assert.equal(error.code, SERVICE_ERROR_CODES.VALIDATION_FAILED);
        assert.match(error.message, /query is required/);
        return true;
      }
    );
  });
});


test("service checkpointProjection compares and advances board-agent cursors", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const board = resolveParleyBoardRegistry(pluginConfig).boards.project;

    const firstInspect = await checkpointProjection({
      caller: CALLER,
      input: { projection_type: "minimal_board" }
    }, { pluginConfig });
    assert.equal(firstInspect.status, "ok");
    assert.equal(firstInspect.data.tool, "parley_checkpoint_projection");
    assert.equal(firstInspect.data.identity.board_id, "project");
    assert.equal(firstInspect.data.projection_type, "minimal_board");
    assert.equal(firstInspect.data.advanced, false);
    assert.equal(firstInspect.data.previous_checkpoint, null);
    assert.equal(firstInspect.data.comparison.has_previous, false);
    assert.equal(firstInspect.data.comparison.changed, true);
    assert.equal(firstInspect.data.checkpoint, null);

    const firstAdvance = await checkpointProjection({
      caller: CALLER,
      input: { projection_type: "minimal_board", advance: true }
    }, { pluginConfig });
    assert.equal(firstAdvance.data.advanced, true);
    assert.equal(firstAdvance.data.checkpoint.board_id, "project");
    assert.equal(firstAdvance.data.checkpoint.board_agent_id, "parley-agent");
    assert.equal(firstAdvance.data.checkpoint.projection_type, "minimal_board");
    assert.deepEqual(firstAdvance.data.checkpoint.last_seen_by_runtime_ref, AGENT_RUNTIME_REF);

    const stored = await loadProjectionCheckpointRecord(pluginConfig, board, "parley-agent", "minimal_board");
    assert.equal(stored.cursor.projection_digest, firstAdvance.data.current_cursor.projection_digest);

    const unchangedInspect = await checkpointProjection({
      caller: CALLER,
      input: { projection_type: "minimal_board" }
    }, { pluginConfig });
    assert.equal(unchangedInspect.data.comparison.has_previous, true);
    assert.equal(unchangedInspect.data.comparison.changed, false);
    assert.deepEqual(unchangedInspect.data.comparison.count_deltas, {});

    await saveArtifactRecord(pluginConfig, board, createArtifactRecord({
      board_id: "project",
      artifact_id: "artifact_checkpoint_delta",
      kind: "plan",
      storage_mode: "reference_only",
      uri: path.join(pluginConfig.__tempRoot, "refs", "checkpoint-delta.md"),
      title: "Checkpoint Delta Plan"
    }));

    const changedInspect = await checkpointProjection({
      caller: CALLER,
      input: { projection_type: "minimal_board" }
    }, { pluginConfig });
    assert.equal(changedInspect.data.comparison.changed, true);
    assert.deepEqual(changedInspect.data.comparison.count_deltas.artifacts, { before: 0, after: 1, delta: 1 });
    assert.deepEqual(changedInspect.data.comparison.count_deltas["artifacts_by_kind.plan"], { before: 0, after: 1, delta: 1 });

    const whereAdvance = await checkpointProjection({
      caller: CALLER,
      input: { projection_type: "where_am_i", advance: true }
    }, { pluginConfig });
    assert.equal(whereAdvance.data.checkpoint.projection_type, "where_am_i");
    assert.equal(whereAdvance.data.current_cursor.counts.assigned, 0);
  });
});

test("service checkpointProjection rejects unsupported projection types", async () => {
  await withPluginConfig(async (pluginConfig) => {
    await assert.rejects(
      () => checkpointProjection({ caller: CALLER, input: { projection_type: "activation_candidates" } }, { pluginConfig }),
      (error) => {
        assert.equal(error.code, SERVICE_ERROR_CODES.VALIDATION_FAILED);
        assert.match(error.message, /projectionType must be one of/);
        return true;
      }
    );
  });
});


test("service mutate bridge returns plan projection payloads for plan mutations", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const result = await mutate({
      caller: CALLER,
      input: {
        board_id: "project",
        action: "create_plan",
        input: {
          title: "Service Projection Plan",
          planId: "plan_service_projection",
          landingSubpath: "service",
          filename: "projection-plan.md"
        }
      }
    }, { pluginConfig });

    assert.equal(result.status, "ok");
    assert.equal(result.data.tool, "parley_create_plan");
    assert.equal(result.data.projection.kind, "plan_markdown");
    assert.equal(result.data.projection.uri, "repo://plans/service/projection-plan.md");
    assert.equal(result.data.projection.namespace, "project_plans");
    assert.match(result.data.projection.body, /Service Projection Plan/);
    assert.match(result.data.projection.contentDigest, /^sha256:/);
  });
});

test("service mutate bridge routes proven write actions through command envelope", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const result = await mutate({
      caller: CALLER,
      input: {
        board_id: "project",
        action: "register_artifact",
        input: {
          artifactId: "artifact_service_mutate",
          kind: "plan",
          storageMode: "reference_only",
          uri: path.join(pluginConfig.__tempRoot, "refs", "service-mutate-plan.md"),
          title: "Service Mutate Plan"
        }
      }
    }, { pluginConfig });

    assert.equal(result.status, "ok");
    assert.equal(result.data.tool, "parley_register_artifact");
    assert.equal(result.data.artifact.artifact_id, "artifact_service_mutate");
    assert.equal(result.data.guidance.next[0].tool, "parley_where_am_i");
  });
});
