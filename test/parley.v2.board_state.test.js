import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveCallerBoardMemberships, resolveCallerIdentity } from "../src/core/board/board.js";
import { resolveParleyBoardRegistry } from "../src/core/config.js";
import { createRegisterArtifactTool } from "../src/adapters/openclaw/tools/register_artifact.js";
import { createCreateObjectTool } from "../src/adapters/openclaw/tools/create_object.js";
import { createRecordEffectTool } from "../src/adapters/openclaw/tools/record_effect.js";
import { createCreateObligationTool } from "../src/adapters/openclaw/tools/create_obligation.js";
import { createCreateTriggerTool } from "../src/adapters/openclaw/tools/create_trigger.js";
import { createResolveObligationTool } from "../src/adapters/openclaw/tools/resolve_obligation.js";
import { createWhereAmITool } from "../src/adapters/openclaw/tools/where_am_i.js";
import { createBoardProjectionTool } from "../src/adapters/openclaw/tools/board_projection.js";
import { createRecordRelationshipTool } from "../src/adapters/openclaw/tools/record_relationship.js";
import { createRemoveRelationshipTool } from "../src/adapters/openclaw/tools/remove_relationship.js";
import { createCheckpointProjectionTool } from "../src/adapters/openclaw/tools/checkpoint_projection.js";
import { createValidateStateAction } from "../src/adapters/openclaw/tools/validate_state.js";
import { createQueryTool } from "../src/adapters/openclaw/tools/query.js";
import { createMutateTool } from "../src/adapters/openclaw/tools/mutate.js";
import { createDescribeTool } from "../src/adapters/openclaw/tools/describe.js";
import {
  createCoordinationObjectRecord,
  createEffectRecord,
  saveEffectRecord,
  loadArtifactRecord,
  loadCoordinationObjectRecord,
  loadPlanSetupRecord,
  loadObligationRecord,
  listEffectRecords,
  listObligationRecords,
  loadProjectionCheckpointRecord,
  savePlanSetupRecord
} from "../src/core/storage/board_store.js";
import { createThreadRecord, saveThreadRecord } from "../src/core/storage/store.js";
import { createParleyPlanV1Document } from "../src/core/schema/index.js";

const REPO_ROOT = path.join(os.tmpdir(), "parley-test-repo");
const AGENT_RUNTIME_REF = { scheme: "openclaw", type: "agent", id: "parley-agent" };

function createProjectBoardConfig(pluginConfig = {}, options = {}) {
  const repoRoot = options.repoRoot ?? pluginConfig.repoRoot;
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
      },
      {
        id: "project_refs",
        roles: ["reference"],
        default_for: [],
        uri_prefix: "repo://refs/",
        resolved_root: path.join(pluginConfig.__tempRoot, "refs"),
        allowed_subpaths: []
      }
    ],
    allowed_reference_namespaces: ["project_plans", "project_refs"],
    members: [
      {
        agent_id: "parley-agent",
        board_agent_id: "parley-agent",
        display_name: "Parley Agent",
        kind: "agent",
        runtime_refs: [AGENT_RUNTIME_REF],
        roles: ["implementation"],
        permissions: { preset: "board_admin" }
      },
      {
        agent_id: "project-reviewer",
        board_agent_id: "project-reviewer",
        display_name: "Project Reviewer",
        kind: "agent",
        runtime_refs: [],
        roles: ["review"],
        permissions: { preset: "board_member" }
      }
    ],
    permission_model: { mode: "board_wide_all_tools", future_agent_scoping: true }
  };
}

async function makePluginConfig() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "parley-v2-test-"));
  const baseConfig = {
    repoRoot: REPO_ROOT,
    parleyRuntimeRoot: path.join(tempRoot, "thread-runtime"),
    parleyRoot: path.join(tempRoot, "board-runtime"),
    parleyProjectDefaultPlanLandingRoot: path.join(tempRoot, "repo", "plans"),
    parleyProjectAllowedReferenceRoots: [path.join(tempRoot, "refs")],
    parleyProjectAllowedLandingRoots: [path.join(tempRoot, "repo", "plans")],
    __tempRoot: tempRoot
  };
  return {
    ...baseConfig,
    parleyDefaultBoards: {
      project: createProjectBoardConfig(baseConfig, { repoRoot: REPO_ROOT })
    }
  };
}

async function withPluginConfig(run) {
  const pluginConfig = await makePluginConfig();
  try {
    await fs.mkdir(path.join(pluginConfig.__tempRoot, "refs"), { recursive: true });
    await fs.mkdir(path.join(pluginConfig.__tempRoot, "repo", "plans"), { recursive: true });
    await run(pluginConfig);
  } finally {
    await fs.rm(pluginConfig.__tempRoot, { recursive: true, force: true });
  }
}

function toolApi(pluginConfig) {
  return { pluginConfig };
}

async function createGuidedPlan(mutateTool, input = {}) {
  const planId = input.planId ?? "plan_guided_test";
  const createResult = await mutateTool.execute(null, {
    callerRuntimeRef: input.callerRuntimeRef ?? AGENT_RUNTIME_REF,
    boardId: input.boardId ?? "project",
    action: "create_plan",
    input: {
      planId,
      title: input.title ?? "Guided Test Plan",
      authority: "implementation-plan",
      landingSubpath: input.landingSubpath ?? "agent-comms/parley",
      filename: input.filename ?? `${planId}.md`,
      participants: input.participants ?? ["parley-agent", "human:sensei"]
    }
  });
  await mutateTool.execute(null, {
    callerRuntimeRef: input.callerRuntimeRef ?? AGENT_RUNTIME_REF,
    boardId: input.boardId ?? "project",
    action: "write_plan_overview",
    input: {
      planId,
      purpose: input.purpose ?? "Verify guided plan setup.",
      background: input.background ?? "Plans are assembled through narrow Parley mutations.",
      scopeSummary: input.scopeSummary ?? "Exercise plan setup.",
      inScope: input.inScope ?? ["Create a namespaced plan projection"],
      outOfScope: input.outOfScope ?? ["Execute deferred work"],
      currentState: input.currentState ?? "No complete plan has been assembled yet.",
      targetState: input.targetState ?? "A valid generated projection exists.",
      approach: input.approach ?? "Create shell, write overview, add phase.",
      acceptanceCriteria: input.acceptanceCriteria ?? ["The file exists", "Validation succeeds"],
      risksAndConstraints: input.risksAndConstraints ?? ["Keep this non-executing."]
    }
  });
  const phaseResult = await mutateTool.execute(null, {
    callerRuntimeRef: input.callerRuntimeRef ?? AGENT_RUNTIME_REF,
    boardId: input.boardId ?? "project",
    action: "add_plan_phase",
    input: input.phase ?? {
      planId,
      phaseId: "phase_1",
      title: "Initial Phase",
      owner: "parley-agent",
      status: "draft",
      entryCriteria: ["Plan shell exists."],
      work: ["Validate generated projection."],
      exitCriteria: ["Projection validates."],
      supportingAgents: []
    }
  });
  return { createResult, phaseResult, planId };
}

test("Parley v2 identity resolves a configured runtime ref to one board agent", async () => {
  await withPluginConfig(async (pluginConfig) => {
    assert.throws(
      () => resolveCallerIdentity(pluginConfig, { callerRuntimeRef: AGENT_RUNTIME_REF }),
      /requires boardId/
    );
    assert.throws(
      () => resolveCallerIdentity(pluginConfig, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: null }),
      /requires boardId/
    );

    const identity = resolveCallerIdentity(pluginConfig, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project" });

    assert.equal(identity.board_id, "project");
    assert.equal(identity.board_agent_id, "parley-agent");
    assert.equal(identity.actor.board_agent_id, "parley-agent");
    assert.deepEqual(identity.runtime_ref, AGENT_RUNTIME_REF);
  });
});

test("Parley v2 identity fails closed when no board agent matches", async () => {
  await withPluginConfig(async (pluginConfig) => {
    assert.throws(
      () => resolveCallerIdentity(pluginConfig, { callerRuntimeRef: { scheme: "openclaw", type: "agent", id: "missing" } }),
      /did not resolve/
    );
  });
});

test("Parley v2 board registry accepts explicit non-default board config without embedded defaults", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const soloRoot = path.join(pluginConfig.__tempRoot, "solo-board");
    const explicitOnlyConfig = {
      repoRoot: REPO_ROOT,
      parleyBoards: {
        solo: {
          board_id: "solo",
          board_root: soloRoot,
          default_plan_landing_root: path.join(pluginConfig.__tempRoot, "solo-plans"),
          agent_registry: [
            {
              board_agent_id: "solo-agent",
              runtime_refs: [{ scheme: "openclaw", type: "agent", id: "solo-agent" }]
            }
          ]
        }
      }
    };

    const registry = resolveParleyBoardRegistry(explicitOnlyConfig);
    assert.deepEqual(Object.keys(registry.boards), ["solo"]);
    const identity = resolveCallerIdentity(explicitOnlyConfig, {
      callerRuntimeRef: { scheme: "openclaw", type: "agent", id: "solo-agent" },
      boardId: "solo"
    });
    assert.equal(identity.board_id, "solo");
    assert.equal(identity.board_agent_id, "solo-agent");
  });
});

test("Parley v2 board registry accepts namespace-first plan landing config", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const soloRoot = path.join(pluginConfig.__tempRoot, "namespace-board");
    const config = {
      repoRoot: REPO_ROOT,
      parleyBoards: {
        solo: {
          board_id: "solo",
          board_root: soloRoot,
          artifact_namespaces: [
            {
              id: "solo_plans",
              roles: ["plan_landing", "reference"],
              default_for: ["plan_landing"],
              uri_prefix: "solo://plans/",
              resolved_root: path.join(pluginConfig.__tempRoot, "solo", "plans"),
              allowed_subpaths: ["coordination"]
            }
          ],
          allowed_reference_namespaces: ["solo_plans"],
          agent_registry: [
            {
              board_agent_id: "solo-agent",
              runtime_refs: [{ scheme: "openclaw", type: "agent", id: "solo-agent" }]
            }
          ]
        }
      }
    };

    const board = resolveParleyBoardRegistry(config).boards.solo;
    assert.equal(board.default_plan_landing_root, path.join(pluginConfig.__tempRoot, "solo", "plans"));
    assert.deepEqual(board.allowed_reference_namespaces, ["solo_plans"]);
    assert.equal(board.artifact_namespaces[0].default_for[0], "plan_landing");
  });
});

test("Parley v2 global registry resolves default and explicit board memberships", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const parleyRoot = path.join(pluginConfig.__tempRoot, "parley-board");
    const parleyPlansRoot = path.join(pluginConfig.__tempRoot, "parley-repo", "plans");
    const config = {
      ...pluginConfig,
      parleyRegistry: {
        agents: {
          "parley-agent": {
            display_name: "Parley Agent",
            kind: "agent",
            runtime_bindings: [AGENT_RUNTIME_REF],
            default_board: "project",
            memberships: {
              project: {
                board_agent_id: "parley-agent",
                permissions: { preset: "board_admin" },
                roles: ["implementation", "runtime"]
              },
              parley: {
                board_agent_id: "parley-agent",
                permissions: { preset: "board_admin" },
                roles: ["maintainer", "implementation"]
              }
            }
          }
        }
      },
      parleyBoards: {
        parley: {
          board_id: "parley",
          display_name: "Parley",
          board_root: parleyRoot,
          artifact_namespaces: [
            {
              id: "parley_plans",
              roles: ["plan_landing", "explicit_landing", "reference"],
              default_for: ["plan_landing"],
              uri_prefix: "repo://plans/",
              resolved_root: parleyPlansRoot
            }
          ],
          members: [
            {
              agent_id: "parley-agent",
              board_agent_id: "parley-agent"
            }
          ]
        }
      }
    };

    assert.throws(
      () => resolveCallerIdentity(config, { callerRuntimeRef: AGENT_RUNTIME_REF }),
      /requires boardId/
    );

    const defaultIdentity = resolveCallerIdentity(config, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project" });
    assert.equal(defaultIdentity.global_agent_id, "parley-agent");
    assert.equal(defaultIdentity.board_id, "project");
    assert.equal(defaultIdentity.identity_resolution.used_default_board, false);

    const parleyIdentity = resolveCallerIdentity(config, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "parley" });
    assert.equal(parleyIdentity.global_agent_id, "parley-agent");
    assert.equal(parleyIdentity.board_id, "parley");
    assert.equal(parleyIdentity.board_agent_id, "parley-agent");
    assert.equal(parleyIdentity.identity_resolution.used_default_board, false);

    const memberships = resolveCallerBoardMemberships(config, { callerRuntimeRef: AGENT_RUNTIME_REF });
    assert.equal(memberships.global_agent_id, "parley-agent");
    assert.equal(memberships.default_board, "project");
    assert.deepEqual(memberships.boards.map((board) => board.board_id), ["project", "parley"]);
    assert.deepEqual(
      memberships.boards.map((board) => [board.board_id, board.board_agent_id, board.is_default]),
      [["project", "parley-agent", true], ["parley", "parley-agent", false]]
    );
    assert.equal(memberships.identity_resolution.accessible_board_count, 2);
  });
});

test("Parley v2 global registry fails closed for non-member explicit boards", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const config = {
      ...pluginConfig,
      parleyRegistry: {
        agents: {
          "parley-agent": {
            runtime_bindings: [AGENT_RUNTIME_REF],
            default_board: "project",
            memberships: {
              project: { board_agent_id: "parley-agent" }
            }
          }
        }
      },
      parleyBoards: {
        parley: {
          board_id: "parley",
          board_root: path.join(pluginConfig.__tempRoot, "parley-board"),
          default_plan_landing_root: path.join(pluginConfig.__tempRoot, "parley-plans"),
          members: [{ agent_id: "another-agent", board_agent_id: "another-agent" }]
        }
      }
    };

    assert.throws(
      () => resolveCallerIdentity(config, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "parley" }),
      /not a member of board: parley/
    );
  });
});

test("Parley v2 tools derive caller identity from trusted OpenClaw runtime context", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const whereTool = createWhereAmITool({ pluginConfig, toolContext: { agentId: "parley-agent" } });

    assert.ok(!whereTool.parameters.required?.includes("callerRuntimeRef"));

    const result = await whereTool.execute(null, { boardId: "project" });
    assert.equal(result.details.identity.board_agent_id, "parley-agent");
    assert.equal(result.details.identity.runtime_ref, undefined);
  });
});

test("Parley v2 tool caller identity falls back to runtime session key when agent id is unavailable", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const whereTool = createWhereAmITool({
      pluginConfig,
      toolContext: { sessionKey: "agent:parley-agent:discord:channel:channel-test-001" }
    });

    const result = await whereTool.execute(null, { boardId: "project" });
    assert.equal(result.details.identity.board_agent_id, "parley-agent");
    assert.equal(result.details.identity.runtime_ref, undefined);
    assert.equal(result.details.identity.identity_resolution, undefined);
  });
});

test("Parley identity derives OpenClaw agent aliases without persisting discovered sessions", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const agentOnlyConfig = {
      ...pluginConfig,
      parleyDefaultBoards: {
        project: {
          ...pluginConfig.parleyDefaultBoards.project,
          members: pluginConfig.parleyDefaultBoards.project.members.map((agent) => ({
            ...agent,
            runtime_refs: (agent.runtime_refs ?? []).filter((runtimeRef) => runtimeRef.type === "agent")
          }))
        }
      }
    };

    const callerRuntimeRef = {
      scheme: "openclaw",
      type: "session",
      id: "agent:parley-agent:discord:channel:channel-test-001"
    };
    const identity = resolveCallerIdentity(agentOnlyConfig, { callerRuntimeRef, boardId: "project" });

    assert.equal(identity.board_agent_id, "parley-agent");
    assert.deepEqual(identity.runtime_ref, callerRuntimeRef);
    assert.equal(identity.identity_resolution.source, "adapter_discovered");
    assert.equal(identity.identity_resolution.caller_runtime_ref_persisted, false);
    assert.deepEqual(identity.identity_resolution.resolved_by_runtime_ref, {
      scheme: "openclaw",
      type: "agent",
      id: "parley-agent",
      key: "openclaw:agent:parley-agent"
    });
    assert.ok(identity.identity_resolution.candidates.some((candidate) => candidate.runtime_ref.key === "openclaw:session:agent:parley-agent:discord:channel:channel-test-001"));
  });
});

test("Parley v2 identity fails closed when a runtime ref is ambiguous", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const otherRoot = path.join(pluginConfig.__tempRoot, "other-board");
    const ambiguousConfig = {
      ...pluginConfig,
      parleyBoards: {
        other: {
          board_id: "other",
          board_root: otherRoot,
          default_plan_landing_root: path.join(pluginConfig.__tempRoot, "other-plans"),
          agent_registry: [
            {
              board_agent_id: "other-agent",
              runtime_refs: [AGENT_RUNTIME_REF]
            }
          ]
        }
      }
    };

    assert.throws(
      () => resolveCallerIdentity(ambiguousConfig, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project" }),
      /ambiguously/
    );
    assert.throws(
      () => resolveCallerIdentity(ambiguousConfig, {
        callerRuntimeRef: {
          scheme: "openclaw",
          type: "session",
          id: "agent:parley-agent:discord:channel:channel-test-001"
        },
        boardId: "project"
      }),
      /ambiguously.*parley-agent, other-agent/
    );
  });
});

test("Parley v2 first-class schemas route raw target/payload through constructors", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const api = toolApi(pluginConfig);
    const effectTool = createRecordEffectTool(api);
    const obligationTool = createCreateObligationTool(api);
    const projectionTool = createBoardProjectionTool(api);
    const relationshipTool = createRecordRelationshipTool(api);
    const removeRelationshipTool = createRemoveRelationshipTool(api);
    const checkpointTool = createCheckpointProjectionTool(api);

    assert.equal(effectTool.parameters.properties.target.type, "object");
    assert.equal(effectTool.parameters.properties.payload.type, "object");
    assert.equal(obligationTool.parameters.properties.target.type, "object");
    assert.match(projectionTool.description, /read-only minimal projection/i);
    assert.deepEqual(Object.keys(projectionTool.parameters.properties).sort(), ["boardId", "callerRuntimeRef", "includeRecords", "recordLimit"]);
    assert.match(relationshipTool.description, /relationship record/);
    assert.deepEqual(relationshipTool.parameters.required, ["boardId", "type", "from", "to"]);
    assert.match(removeRelationshipTool.description, /Logically remove/);
    assert.deepEqual(removeRelationshipTool.parameters.required, ["boardId", "relationshipId", "reason"]);
    assert.match(checkpointTool.description, /projection checkpoint/);
    assert.deepEqual(Object.keys(checkpointTool.parameters.properties).sort(), ["advance", "boardId", "callerRuntimeRef", "includeTerminal", "projectionType"]);

    await assert.rejects(
      () => effectTool.execute(null, {
        callerRuntimeRef: AGENT_RUNTIME_REF,
        boardId: "project",
        type: "activation_proposed",
        target: {
          artifact_id: "artifact_demo",
          artifact_version: 1,
          plan_id: "plan_demo",
          phase_id: "phase_1",
          invented: "field"
        },
        payload: {
          requested_action: "review_activation",
          non_executing: true,
          review_required_from: ["parley-agent"]
        }
      }),
      /target\.invented is not allowed/
    );

    await assert.rejects(
      () => obligationTool.execute(null, {
        callerRuntimeRef: AGENT_RUNTIME_REF,
        boardId: "project",
        agent: "parley-agent",
        type: "review",
        target: { note: "invented shape" }
      }),
      /target\.note is not allowed/
    );
  });
});

test("Parley v2 board-state schemas reject raw-authored malformed actor and artifact refs", () => {
  assert.throws(
    () => createEffectRecord({
      board_id: "project",
      effect_id: "effect_bad_actor",
      type: "decision_recorded",
      actor: { board_agent_id: "parley-agent" },
      target: { object_id: "object_demo" },
      payload: { decision: "accept" }
    }),
    /actor\.runtime_ref must be an object/
  );

  assert.throws(
    () => createCoordinationObjectRecord({
      board_id: "project",
      object_id: "object_bad_artifact_ref",
      kind: "plan",
      title: "Bad artifact ref",
      artifact_ref: { artifact: "artifact_demo", version: 1 }
    }),
    /artifact_ref\.artifact is not allowed/
  );
});

test("Parley query/mutate façade routes only proven v2 actions", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const api = toolApi(pluginConfig);
    const queryTool = createQueryTool(api);
    const mutateTool = createMutateTool(api);

    assert.equal(queryTool.name, "parley_query");
    assert.equal(mutateTool.name, "parley_mutate");
    assert.deepEqual(queryTool.parameters.required, ["action"]);
    assert.deepEqual(mutateTool.parameters.required, ["boardId", "action"]);

    const artifactResult = await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "register_artifact",
      input: {
        artifactId: "artifact_facade",
        kind: "plan",
        storageMode: "reference_only",
        uri: path.join(pluginConfig.__tempRoot, "refs", "facade-plan.md"),
        title: "Facade Plan"
      }
    });
    assert.equal(artifactResult.details.ok, true);
    assert.match(artifactResult.details.summary, /mutation facade action/);
    assert.equal(artifactResult.details.tool, "parley_mutate");
    assert.equal(artifactResult.details.action, "register_artifact");
    assert.equal(artifactResult.details.result.artifact.artifact_id, "artifact_facade");
    assert.equal(artifactResult.details.guidance.meaning, "This facade delegated to the corresponding first-class Parley tool. Prefer first-class tools when available.");
    assert.equal(artifactResult.details.guidance.next[0].tool, "parley_where_am_i");

    const boardResultValue = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "board"
    });
    assert.equal(boardResultValue.details.tool, "parley_query");
    assert.equal(boardResultValue.details.action, "board");
    assert.equal(boardResultValue.details.result.projection.counts.artifacts, 1);
    assert.equal(boardResultValue.details.result.projection.records, null);

    const runtimeWhere = await queryTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, action: "where_am_i" });
    assert.equal(runtimeWhere.details.action, "where_am_i");
    assert.equal(runtimeWhere.details.result.scope, "runtime");
    assert.equal(runtimeWhere.details.result.boards.default_board, "project");
    assert.equal(runtimeWhere.details.guidance.next[0].tool, "parley_where_am_i");
    assert.deepEqual(runtimeWhere.details.guidance.next[0].args, { boardId: "project" });
    await assert.rejects(
      () => mutateTool.execute(null, {
        callerRuntimeRef: AGENT_RUNTIME_REF,
        action: "register_artifact",
        input: {
          artifactId: "artifact_facade_missing_board",
          kind: "plan",
          storageMode: "reference_only",
          uri: path.join(pluginConfig.__tempRoot, "refs", "facade-missing-board.md")
        }
      }),
      /requires boardId/
    );

    await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "create_obligation",
      input: {
        obligationId: "obligation_facade_thread_reply",
        agent: "parley-agent",
        type: "preserve_awareness",
        status: "active",
        target: { thread_id: "thread_facade", message_id: "message_facade", plan_id: "plan_facade" },
        reason: "verify generic obligation filters"
      }
    });
    const obligationsResult = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "board_obligations",
      input: { filter: "needs_my_action", targetKinds: ["plans"] }
    });
    assert.equal(obligationsResult.details.action, "board_obligations");
    assert.equal(obligationsResult.details.result.counts.matched, 1);
    assert.equal(obligationsResult.details.result.counts.highest_priority, "low");
    assert.equal(obligationsResult.details.result.obligations[0].priority, "low");
    assert.equal(obligationsResult.details.result.obligations[0].obligation.priority, "low");
    assert.deepEqual(obligationsResult.details.result.obligations[0].target_kinds, ["plans"]);

    await fs.writeFile(path.join(pluginConfig.__tempRoot, "refs", "namespace-search.md"), "Namespace routed recovery needle for Parley query search.\n", "utf8");
    const searchResult = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "search",
      input: { query: "recovery needle", namespaces: ["project_refs"], limit: 5 }
    });
    assert.equal(searchResult.details.action, "search");
    assert.equal(searchResult.details.result.counts.returned, 1);
    assert.equal(searchResult.details.result.results[0].namespace, "project_refs");
    assert.match(searchResult.details.result.results[0].uri, /namespace-search\.md$/);

    const whereResult = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "where_am_i"
    });
    assert.equal(whereResult.details.result.projection.board_agent_id, "parley-agent");
    assert.equal(whereResult.details.guidance.next[0].tool, "parley_query_board_obligations");
    assert.deepEqual(whereResult.details.guidance.next[0].args, { boardId: "project", filter: "needs_my_action" });

    const myBoardsResult = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      action: "my_boards"
    });
    assert.equal(myBoardsResult.details.action, "my_boards");
    assert.equal(myBoardsResult.details.result.result.global_agent_id, "parley-agent");
    assert.deepEqual(myBoardsResult.details.result.result.boards.map((board) => board.board_id), ["project"]);
    await assert.rejects(
      () => queryTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, action: "my_boards", boardId: "project" }),
      /parley_my_boards does not accept parameter: boardId/
    );

    await assert.rejects(
      () => queryTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project", action: "activation_candidates" }),
      (error) => {
        assert.match(error.message, /unsupported parley_query action/);
        assert.equal(error.code, "INVALID_PARLEY_QUERY_ACTION");
        assert.ok(error.validValues.includes("board_obligations"));
        assert.match(error.describeHint, /topic: "query"/);
        return true;
      }
    );
    await assert.rejects(
      () => mutateTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project", action: "defer_phase" }),
      (error) => {
        assert.match(error.message, /unsupported parley_mutate action/);
        assert.equal(error.code, "INVALID_PARLEY_MUTATE_ACTION");
        assert.ok(error.validValues.includes("create_plan"));
        assert.match(error.describeHint, /topic: "mutate"/);
        return true;
      }
    );
    await assert.rejects(
      () => queryTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project", action: "board_obligations", input: { filter: "urgent" } }),
      (error) => {
        assert.equal(error.code, "INVALID_OBLIGATIONS_FILTER");
        assert.deepEqual(error.validValues, ["needs_my_action", "assigned_to_me", "all"]);
        assert.match(error.describeHint, /query\.board_obligations/);
        return true;
      }
    );
    await assert.rejects(
      () => queryTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project", action: "board_obligations", input: { scope: ["plans"] } }),
      (error) => {
        assert.equal(error.code, "BOARD_OBLIGATIONS_SCOPE_REMOVED");
        assert.deepEqual(error.validValues, ["targetKinds"]);
        assert.match(error.describeHint, /query\.board_obligations/);
        return true;
      }
    );
    await assert.rejects(
      () => mutateTool.execute(null, {
        callerRuntimeRef: AGENT_RUNTIME_REF,
        boardId: "project",
        action: "register_artifact",
        input: {
          artifactId: "artifact_facade_unknown_param",
          kind: "plan",
          storageMode: "reference_only",
          uri: path.join(pluginConfig.__tempRoot, "refs", "facade-unknown.md"),
          inventedParam: true
        }
      }),
      /parley_register_artifact does not accept parameter: inventedParam/
    );
  });
});

test("Parley runtime obligations remain separate from board obligations", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const queryTool = createQueryTool(toolApi(pluginConfig));
    await saveThreadRecord(pluginConfig, createThreadRecord({
      thread_id: "thread_runtime_action",
      kind: "coordination",
      control_mode: "peer",
      initiator: "project-reviewer",
      recipient: "parley-agent",
      next_action_owner: "parley-agent",
      thread_state: "active"
    }));

    const runtimeResult = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      action: "runtime_obligations"
    });
    assert.equal(runtimeResult.details.result.counts.matched, 1);
    assert.equal(runtimeResult.details.result.counts.highest_priority, "high");
    assert.equal(runtimeResult.details.result.obligations[0].priority, "high");
    assert.equal(runtimeResult.details.result.obligations[0].target.kind, "thread");
    assert.equal(runtimeResult.details.result.obligations[0].target.thread_id, "thread_runtime_action");

    const whereResult = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      action: "where_am_i"
    });
    assert.equal(whereResult.details.result.runtime.obligations.length, 1);
    assert.equal(whereResult.details.result.runtime.obligations[0].priority, "high");
    assert.equal(whereResult.details.result.obligation_summary.runtime.highest_priority, "high");
    assert.equal(whereResult.details.result.boards.default_board, "project");

    await assert.rejects(
      () => queryTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project", action: "runtime_obligations" }),
      (error) => {
        assert.equal(error.code, "RUNTIME_OBLIGATIONS_BOARD_ID_NOT_ALLOWED");
        assert.match(error.describeHint, /query\.runtime_obligations/);
        return true;
      }
    );
    await assert.rejects(
      () => queryTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, action: "obligations" }),
      (error) => {
        assert.equal(error.code, "INVALID_PARLEY_QUERY_ACTION");
        assert.ok(!error.validValues.includes("obligations"));
        assert.ok(error.validValues.includes("runtime_obligations"));
        assert.ok(error.validValues.includes("board_obligations"));
        return true;
      }
    );
  });
});

test("Parley describe provides fresh-agent discovery and board metadata", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const describeTool = createDescribeTool(toolApi(pluginConfig));

    const overview = await describeTool.execute(null, {});
    assert.equal(overview.details.tool, "parley_describe");
    assert.equal(overview.details.topic, "overview");
    assert.ok(overview.details.descriptor.query_actions.includes("board_obligations"));
    assert.ok(overview.details.descriptor.query_actions.includes("runtime_obligations"));
    assert.ok(overview.details.descriptor.mutate_actions.includes("create_plan"));

    const unknown = await describeTool.execute(null, { topic: "query.cards" });
    assert.equal(unknown.details.descriptor.known, false);
    assert.ok(unknown.details.descriptor.valid_topics.includes("query.search"));
    assert.ok(unknown.details.descriptor.valid_topics.includes("targets"));
    assert.match(unknown.details.descriptor.hint, /parley_describe/);

    const recovery = await describeTool.execute(null, { topic: "recovery" });
    assert.equal(recovery.details.descriptor.boot_sequence[1].tool, "parley_where_am_i");
    assert.deepEqual(recovery.details.descriptor.boot_sequence[1].call, {});
    assert.equal(recovery.details.descriptor.boot_sequence[2].call.boardId, "<default_board>");

    const query = await describeTool.execute(null, { topic: "query" });
    assert.deepEqual(query.details.descriptor.boardless_actions, ["my_boards", "runtime_obligations"]);
    assert.ok(query.details.descriptor.actions.includes("search"));
    assert.equal(query.details.descriptor.role, "advanced facade over first-class read tools");
    assert.ok(query.details.descriptor.first_class_equivalents.includes("parley_query_board_obligations"));

    const mutate = await describeTool.execute(null, { topic: "mutate" });
    assert.ok(mutate.details.descriptor.actions.includes("create_plan"));
    assert.equal(mutate.details.descriptor.role, "advanced facade over first-class write tools");
    assert.ok(mutate.details.descriptor.first_class_equivalents.includes("parley_record_effect"));

    const targets = await describeTool.execute(null, { topic: "targets" });
    assert.deepEqual(targets.details.descriptor.runtime_targets.kinds, ["thread", "message", "turn"]);
    assert.ok(targets.details.descriptor.board_targets.kinds.includes("board_obligation"));

    const runtimeObligations = await describeTool.execute(null, { topic: "query.runtime_obligations" });
    assert.deepEqual(runtimeObligations.details.descriptor.input_schema.filter.enum, ["needs_my_action", "assigned_to_me", "all"]);
    assert.deepEqual(runtimeObligations.details.descriptor.rejected_fields, ["boardId"]);

    const obligations = await describeTool.execute(null, { topic: "query.board_obligations" });
    assert.deepEqual(obligations.details.descriptor.input_schema.filter.enum, ["needs_my_action", "assigned_to_me", "all"]);
    assert.ok(obligations.details.descriptor.targetKinds.includes("plans"));
    assert.ok(!obligations.details.descriptor.targetKinds.includes("threads"));

    const search = await describeTool.execute(null, { topic: "query.search" });
    assert.ok(search.details.descriptor.searchable_nouns.includes("registered reference namespace files"));
    assert.equal(search.details.descriptor.input_schema.namespaces.default, "board.allowed_reference_namespaces");

    const createPlan = await describeTool.execute(null, { topic: "mutate.create_plan" });
    assert.equal(createPlan.details.descriptor.tool, "parley_create_plan");
    assert.deepEqual(createPlan.details.descriptor.required_fields, ["boardId", "title"]);
    assert.ok(createPlan.details.descriptor.setup_tools.includes("parley_add_plan_phase"));
    assert.match(createPlan.details.descriptor.design_rule, /guided, narrow/);

    const identity = await describeTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, topic: "boards/identity" });
    assert.match(identity.details.descriptor.rules.join("\n"), /default_board is a selection hint/);
    assert.match(identity.details.descriptor.rules.join("\n"), /require explicit boardId/);
    assert.equal(identity.details.identity.default_board, "project");
    assert.equal(identity.details.identity.boards[0].board_agent_id, "parley-agent");

    const boardScoped = await describeTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project" });
    assert.equal(boardScoped.details.topic, "board");
    assert.equal(boardScoped.details.descriptor.metadata_only, true);
    assert.equal(boardScoped.details.overview, undefined);
    assert.equal(boardScoped.details.board.board_id, "project");
    assert.equal(boardScoped.details.board.explicit_board_required, true);
    assert.deepEqual(boardScoped.details.board.allowed_reference_namespaces, ["project_plans", "project_refs"]);
    assert.equal(boardScoped.details.board.artifact_namespaces[0].resolved_root, undefined);
    assert.equal(boardScoped.details.board.records, undefined);
  });
});

test("Parley guided plan tools generate ids and expose setup status", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const mutateTool = createMutateTool(toolApi(pluginConfig));
    const queryTool = createQueryTool(toolApi(pluginConfig));

    const createResult = await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "create_plan",
      input: { title: "Generated Id Guided Plan", landingSubpath: "agent-comms/parley" }
    });
    const planId = createResult.details.result.plan.plan_id;
    assert.match(planId, /^plan_[a-z0-9]+$/);
    assert.equal(createResult.details.result.setupState.setupComplete, false);
    assert.deepEqual(createResult.details.result.setupState.missingRequired, ["overview", "phase"]);
    assert.equal(createResult.details.result.setupState.nextRequiredAction.tool, "parley_write_plan_overview");
    assert.equal(createResult.details.result.plan_lifecycle.obligations.length, 1);
    assert.equal(createResult.details.result.plan_lifecycle.obligations[0].obligation_id, `obligation_${planId}_lifecycle_owner`);
    assert.equal(createResult.details.result.plan_lifecycle.obligations[0].agent, "parley-agent");
    assert.equal(createResult.details.result.plan_lifecycle.obligations[0].status, "active");
    assert.match(createResult.details.result.plan_lifecycle.obligations[0].reason, /needs setup/);

    const board = resolveParleyBoardRegistry(pluginConfig).boards.project;
    const obligations = await listObligationRecords(pluginConfig, board);
    assert.equal(obligations.some((obligation) => obligation.obligation_id === `obligation_${planId}_lifecycle_owner`), true);

    const statusResult = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "plan_setup_status",
      input: { planId }
    });
    assert.equal(statusResult.details.result.setupState.planId, planId);
    assert.equal(statusResult.details.result.setupState.validOwners.includes("parley-agent"), true);
  });
});

test("Parley plan mutation tools preserve concurrent phase additions", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const mutateTool = createMutateTool(toolApi(pluginConfig));
    const planId = "plan_concurrent_phase_add";

    await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "create_plan",
      input: {
        planId,
        title: "Concurrent Phase Add Plan",
        authority: "implementation-plan",
        landingSubpath: "agent-comms/parley",
        filename: "concurrent-phase-add-plan.md",
        participants: ["parley-agent"]
      }
    });
    await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "write_plan_overview",
      input: {
        planId,
        purpose: "Verify concurrent plan mutations do not overwrite each other.",
        background: "Multiple tools can target the same plan in adjacent turns.",
        scopeSummary: "Exercise plan-level mutation serialization.",
        inScope: ["Add phases concurrently"],
        outOfScope: ["Execute phases"],
        currentState: "The plan has no phases.",
        targetState: "Both submitted phases are retained.",
        approach: "Run concurrent add_plan_phase mutations.",
        acceptanceCriteria: ["Both phase ids are present"],
        risksAndConstraints: ["Keep the test local"]
      }
    });

    await Promise.all([
      mutateTool.execute(null, {
        callerRuntimeRef: AGENT_RUNTIME_REF,
        boardId: "project",
        action: "add_plan_phase",
        input: {
          planId,
          phaseId: "phase_concurrent_a",
          title: "Concurrent Phase A",
          owner: "parley-agent",
          status: "draft",
          entryCriteria: ["Overview exists."],
          work: ["Retain phase A."],
          exitCriteria: ["Phase A is present."],
          supportingAgents: []
        }
      }),
      mutateTool.execute(null, {
        callerRuntimeRef: AGENT_RUNTIME_REF,
        boardId: "project",
        action: "add_plan_phase",
        input: {
          planId,
          phaseId: "phase_concurrent_b",
          title: "Concurrent Phase B",
          owner: "parley-agent",
          status: "draft",
          entryCriteria: ["Overview exists."],
          work: ["Retain phase B."],
          exitCriteria: ["Phase B is present."],
          supportingAgents: []
        }
      })
    ]);

    const board = resolveParleyBoardRegistry(pluginConfig).boards.project;
    const plan = await loadPlanSetupRecord(pluginConfig, board, planId);
    assert.deepEqual(plan.phases.map((phase) => phase.phase_id).sort(), ["phase_concurrent_a", "phase_concurrent_b"]);
  });
});

test("Parley query/mutate façade creates and validates parley.plan.v1 documents", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const api = toolApi(pluginConfig);
    const queryTool = createQueryTool(api);
    const mutateTool = createMutateTool(api);

    const { createResult } = await createGuidedPlan(mutateTool, {
      planId: "plan_facade_create_validate",
      title: "Facade Create Validate Plan",
      filename: "facade-create-validate-plan.md"
    });

    assert.equal(createResult.details.tool, "parley_mutate");
    assert.equal(createResult.details.action, "create_plan");
    assert.equal(createResult.details.result.plan.projection_validation.ok, true);
    assert.equal(createResult.details.result.setupState.setupComplete, false);
    assert.equal(createResult.details.result.artifact.kind, "plan");
    assert.equal(createResult.details.result.artifact.storage_mode, "explicit_landing");
    assert.match(createResult.details.result.artifact.uri, /^repo:\/\/plans\/agent-comms\/parley\//);

    const planPath = createResult.details.result.plan.path;
    assert.equal(planPath, path.join(pluginConfig.__tempRoot, "repo", "plans", "agent-comms", "parley", "facade-create-validate-plan.md"));
    const markdown = await fs.readFile(planPath, "utf8");
    assert.match(markdown, /schema: parley.plan.v1/);
    assert.match(markdown, /namespace: project_plans/);

    const artifact = await loadArtifactRecord(pluginConfig, resolveParleyBoardRegistry(pluginConfig).boards.project, "artifact_facade_create_validate");
    assert.equal(artifact.resolved_path, planPath);

    const validateResult = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "validate_plan",
      input: { planId: "plan_facade_create_validate" }
    });
    assert.equal(validateResult.details.action, "validate_plan");
    assert.equal(validateResult.details.result.validation.ok, true);
    assert.equal(validateResult.details.result.validation.shell_valid, true);
    assert.equal(validateResult.details.result.validation.setup_complete, true);
  });
});



test("Parley plan artifact registration imports tracked setup state and lifecycle obligations", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const api = toolApi(pluginConfig);
    const artifactTool = createRegisterArtifactTool(api);
    const board = resolveParleyBoardRegistry(pluginConfig).boards.project;
    const timestamp = "2026-05-03T00:00:00.000Z";
    const markdown = createParleyPlanV1Document({
      authority: "implementation-plan",
      plan_id: "plan_imported_projection",
      board_id: "project",
      title: "Imported Projection Plan",
      status: "draft",
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      owner: "parley-agent",
      participants: ["parley-agent", "project-reviewer"],
      scope: { summary: "Import an existing generated plan projection.", in: ["Import state"], out: ["Execute work"] },
      landing: { namespace: "project_plans", subpath: "imports", filename: "imported-projection-plan.md" },
      review: { required_reviewers: [], approvals: [], objections: [] },
      relationships: { supersedes: [], superseded_by: [], extracts_from: [], constrains: [], constrained_by: [], depends_on: [], blocks: [], blocked_by: [], related_to: [] },
      parley: { object_id: null, artifact_id: "artifact_imported_projection", source_thread_id: null, source_message_id: null },
      sections: {
        purpose: "Verify registration imports canonical mutable plan state.",
        background: "Some generated plan projections may arrive through artifact registration first.",
        scope: "Import an existing generated plan projection.",
        current_state: "The board has a plan projection but no setup record.",
        target_state: "The board has a tracked setup record and lifecycle obligation.",
        plan: "Register the artifact and import the plan setup state.",
        phases: `### Phase 1 — Import smoke phase\n\nKind: implementation\nStatus: draft\nOwner: parley-agent\n\nRequired from:\nN/A\n\nRequested decision:\nN/A\n\nDue at:\nN/A\n\nEntry criteria:\n- Artifact exists.\n\nWork:\n- Import setup state.\n\nExit criteria:\n- Plan state exists.\n\nSupporting agents:\n- project-reviewer\n\nActivation conditions:\nNone.\n\nReview trigger:\n- Import completes.\n\nDeferral reason:\nNone.\n\nNon-goals before activation:\n- Do not execute implementation.`,
        acceptance_criteria: "- Plan setup state is saved.\n- Lifecycle obligation is active.",
        risks_and_constraints: "- Import must stay non-executing.",
        open_questions: "None recorded.",
        review_and_approval: "No review recorded yet.",
        change_log: "- v1: Import smoke projection."
      }
    });

    const result = await artifactTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      artifactId: "artifact_imported_projection",
      kind: "plan",
      storageMode: "explicit_landing",
      artifactNamespace: "project_plans",
      landingSubpath: "imports",
      filename: "imported-projection-plan.md",
      bodyText: markdown
    });

    assert.equal(result.details.artifact.kind, "plan");
    assert.equal(result.details.plan.plan_id, "plan_imported_projection");
    assert.equal(result.details.plan.phase_count, 1);
    assert.equal(result.details.plan.phases, undefined);
    assert.equal(result.details.plan.overview, undefined);
    assert.equal(result.details.setupState.setupComplete, true);
    assert.equal(result.details.plan_validation.heading_count > 0, true);
    assert.equal(result.details.plan_validation.headings, undefined);
    assert.equal(result.details.plan_lifecycle.obligations.length, 1);
    assert.equal(result.details.plan_lifecycle.obligations[0].obligation_id, "obligation_plan_imported_projection_lifecycle_owner");
    assert.match(result.details.plan_lifecycle.obligations[0].reason, /setup-complete but not routed/);

    const savedPlan = await loadPlanSetupRecord(pluginConfig, board, "plan_imported_projection");
    assert.equal(savedPlan.artifact_id, "artifact_imported_projection");
    assert.equal(savedPlan.overview.purpose, "Verify registration imports canonical mutable plan state.");
    assert.equal(savedPlan.phases.length, 1);
    assert.equal(savedPlan.phases[0].owner, "parley-agent");
  });
});

test("Parley review lifecycle obligations sanitize board-agent ids for record ids", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const api = toolApi(pluginConfig);
    const artifactTool = createRegisterArtifactTool(api);
    const timestamp = "2026-05-03T00:00:00.000Z";
    const markdown = createParleyPlanV1Document({
      authority: "implementation-plan",
      plan_id: "plan_imported_review",
      board_id: "project",
      title: "Imported Review Plan",
      status: "review",
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      owner: "parley-agent",
      participants: ["parley-agent", "project-reviewer"],
      scope: { summary: "Import a plan that is ready for reviewer routing.", in: ["Route review"], out: ["Execute work"] },
      landing: { namespace: "project_plans", subpath: "imports", filename: "imported-review-plan.md" },
      review: { required_reviewers: ["project-reviewer"], approvals: [], objections: [] },
      relationships: { supersedes: [], superseded_by: [], extracts_from: [], constrains: [], constrained_by: [], depends_on: [], blocks: [], blocked_by: [], related_to: [] },
      parley: { object_id: null, artifact_id: "artifact_imported_review", source_thread_id: null, source_message_id: null },
      sections: {
        purpose: "Verify review lifecycle obligation ids are valid when reviewer ids contain hyphens.",
        background: "Board agent ids permit hyphens, but obligation record ids do not.",
        scope: "Import a review-status plan.",
        current_state: "A plan projection is ready for review.",
        target_state: "A board-local reviewer obligation is created with a valid record id.",
        plan: "Register the artifact and inspect lifecycle obligations.",
        phases: `### Phase 1 — Review routing smoke phase\n\nKind: implementation\nStatus: draft\nOwner: parley-agent\n\nRequired from:\nN/A\n\nRequested decision:\nN/A\n\nDue at:\nN/A\n\nEntry criteria:\n- Artifact exists.\n\nWork:\n- Import setup state.\n\nExit criteria:\n- Reviewer obligation exists.\n\nSupporting agents:\n- project-reviewer\n\nActivation conditions:\nNone.\n\nReview trigger:\n- Import completes.\n\nDeferral reason:\nNone.\n\nNon-goals before activation:\n- Do not execute implementation.`,
        acceptance_criteria: "- Reviewer obligation id is valid.",
        risks_and_constraints: "- Reviewer id contains a hyphen.",
        open_questions: "None recorded.",
        review_and_approval: "Review is routed to project-reviewer.",
        change_log: "- v1: Import review projection."
      }
    });

    const result = await artifactTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      artifactId: "artifact_imported_review",
      kind: "plan",
      storageMode: "explicit_landing",
      artifactNamespace: "project_plans",
      landingSubpath: "imports",
      filename: "imported-review-plan.md",
      bodyText: markdown
    });

    assert.equal(result.details.plan.status, "review");
    assert.equal(result.details.plan_lifecycle.obligations.length, 1);
    assert.equal(result.details.plan_lifecycle.obligations[0].agent, "project-reviewer");
    assert.equal(result.details.plan_lifecycle.obligations[0].obligation_id, "obligation_plan_imported_review_lifecycle_review_project_reviewer");
    assert.equal(result.details.plan_lifecycle.obligations[0].scope, "plan_lifecycle:review_decision");
    assert.deepEqual(result.details.plan_lifecycle.obligations[0].managedBinding, {
      system: "plan_lifecycle",
      plan_id: "plan_imported_review",
      role: "review_decision",
      revision: 0,
      phase_id: null
    });
    const saved = await loadObligationRecord(pluginConfig, resolveParleyBoardRegistry(pluginConfig).boards.project, "obligation_plan_imported_review_lifecycle_review_project_reviewer");
    assert.equal(saved.agent, "project-reviewer");
  });
});


test("Parley managed plan lifecycle tools own review, activation, and phase cursor transitions", async () => {
  await withPluginConfig(async (pluginConfig) => {
    pluginConfig.parleyDefaultBoards.project.members[1].runtime_refs = [{ scheme: "openclaw", type: "agent", id: "project-reviewer" }];
    const api = toolApi(pluginConfig);
    const mutateTool = createMutateTool(api);
    const resolveTool = createResolveObligationTool(api);
    const board = resolveParleyBoardRegistry(pluginConfig).boards.project;
    const { planId } = await createGuidedPlan(mutateTool, {
      planId: "plan_managed_lifecycle",
      filename: "managed-lifecycle-plan.md",
      participants: ["parley-agent", "project-reviewer"]
    });

    const reviewResult = await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "request_plan_review",
      input: { planId, requiredReviewers: ["project-reviewer"], reason: "Ready for owner-scoped review." }
    });
    assert.equal(reviewResult.details.result.plan.status, "review");
    const reviewObligation = reviewResult.details.result.plan_lifecycle.obligations[0];
    assert.equal(reviewObligation.agent, "project-reviewer");
    assert.equal(reviewObligation.managedBinding.role, "review_decision");

    await assert.rejects(
      () => resolveTool.execute(null, {
        callerRuntimeRef: { scheme: "openclaw", type: "agent", id: "project-reviewer" },
        boardId: "project",
        obligationId: reviewObligation.obligation_id,
        resolution: "completed",
        note: "Attempted through generic resolution."
      }),
      /explicit lifecycle command/
    );

    const decisionResult = await mutateTool.execute(null, {
      callerRuntimeRef: { scheme: "openclaw", type: "agent", id: "project-reviewer" },
      boardId: "project",
      action: "record_review_decision",
      input: { planId, obligationId: reviewObligation.obligation_id, decision: "approve", note: "Looks ready." }
    });
    assert.equal(decisionResult.details.result.plan.status, "ready");
    const resolvedReview = await loadObligationRecord(pluginConfig, board, reviewObligation.obligation_id);
    assert.equal(resolvedReview.status, "resolved");
    assert.equal(resolvedReview.resolution, "completed");

    const activationResult = await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "activate_plan",
      input: { planId, reason: "Owner accepts review and starts work." }
    });
    assert.equal(activationResult.details.result.plan.status, "active");
    const phaseWork = activationResult.details.result.plan_lifecycle.obligations.find((obligation) => obligation.managedBinding.role === "phase_work");
    const phaseOutcome = activationResult.details.result.plan_lifecycle.obligations.find((obligation) => obligation.managedBinding.role === "phase_outcome_decision");
    assert.equal(phaseWork.agent, "parley-agent");
    assert.equal(phaseOutcome.agent, "parley-agent");

    const workResolution = await resolveTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      obligationId: phaseWork.obligation_id,
      resolution: "completed",
      note: "Worker reports phase evidence complete."
    });
    assert.equal(workResolution.details.obligation.status, "resolved");
    const stillActive = await loadPlanSetupRecord(pluginConfig, board, planId);
    assert.equal(stillActive.status, "active");
    assert.equal(stillActive.managed.current_phase_id, "phase_1");
    assert.deepEqual(stillActive.managed.activeLifecycleObligationIds, [phaseOutcome.obligation_id]);

    const phaseOutcomeResult = await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "record_phase_outcome",
      input: { planId, phaseId: "phase_1", outcome: "complete", note: "Owner accepts completion evidence." }
    });
    assert.equal(phaseOutcomeResult.details.result.plan.status, "complete");
    const completedPlan = await loadPlanSetupRecord(pluginConfig, board, planId);
    assert.deepEqual(completedPlan.managed.activeLifecycleObligationIds, []);
  });
});



test("Parley migration-safe lifecycle commands cover no-review ready, pause/resume, and terminal disposition", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const api = toolApi(pluginConfig);
    const mutateTool = createMutateTool(api);
    const board = resolveParleyBoardRegistry(pluginConfig).boards.project;
    const { planId } = await createGuidedPlan(mutateTool, {
      planId: "plan_migration_safe_lifecycle",
      filename: "migration-safe-lifecycle-plan.md"
    });

    const readyResult = await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "mark_plan_ready",
      input: { planId, noReviewReason: "Migration owner accepts this plan without separate review." }
    });
    assert.equal(readyResult.details.result.plan.status, "ready");
    assert.equal(readyResult.details.result.effect.payload.action, "mark_ready_no_review");
    assert.equal(readyResult.details.result.plan_lifecycle.obligations[0].managedBinding.role, "activation_decision");

    const activationResult = await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "activate_plan",
      input: { planId, reason: "Start migration-safe smoke phase." }
    });
    assert.equal(activationResult.details.result.plan.status, "active");
    const phaseWork = activationResult.details.result.plan_lifecycle.obligations.find((obligation) => obligation.managedBinding.role === "phase_work");
    assert.ok(phaseWork);

    await assert.rejects(
      () => mutateTool.execute(null, {
        callerRuntimeRef: AGENT_RUNTIME_REF,
        boardId: "project",
        action: "record_plan_disposition",
        input: { planId, disposition: "archived", reason: "Attempt direct active archive." }
      }),
      /active plans cannot be archived directly/
    );

    const pauseResult = await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "pause_plan",
      input: { planId, reason: "Wait for external migration prerequisite." }
    });
    assert.equal(pauseResult.details.result.plan.status, "paused");
    assert.equal(pauseResult.details.result.resume_point.phase_id, "phase_1");
    assert.equal(pauseResult.details.result.plan_lifecycle.obligations[0].managedBinding.role, "blocker_resolution");
    const pausedPlan = await loadPlanSetupRecord(pluginConfig, board, planId);
    assert.equal(pausedPlan.managed.resumePoint.phase_id, "phase_1");
    const pausedWork = await loadObligationRecord(pluginConfig, board, phaseWork.obligation_id);
    assert.equal(pausedWork.status, "superseded");

    const resumeResult = await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "resume_plan",
      input: { planId, reason: "Prerequisite cleared." }
    });
    assert.equal(resumeResult.details.result.plan.status, "active");
    const resumedPlan = await loadPlanSetupRecord(pluginConfig, board, planId);
    assert.equal(resumedPlan.managed.resumePoint, null);
    assert.ok(resumeResult.details.result.plan_lifecycle.obligations.some((obligation) => obligation.managedBinding.role === "phase_work"));

    const dispositionResult = await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "record_plan_disposition",
      input: { planId, disposition: "cancelled", reason: "Migration-safe cancellation path validated." }
    });
    assert.equal(dispositionResult.details.result.plan.status, "cancelled");
    const cancelledPlan = await loadPlanSetupRecord(pluginConfig, board, planId);
    assert.deepEqual(cancelledPlan.managed.activeLifecycleObligationIds, []);
    assert.equal(dispositionResult.details.result.effect.payload.disposition, "cancelled");
  });
});

test("Parley human checkpoint phases create shepherd obligations", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const api = toolApi(pluginConfig);
    const queryTool = createQueryTool(api);
    const mutateTool = createMutateTool(api);

    await createGuidedPlan(mutateTool, {
      planId: "plan_human_checkpoint",
      title: "Human Checkpoint Plan",
      filename: "human-checkpoint-plan.md",
      purpose: "Verify single-agent human checkpoint MVP."
    });
    const checkpointResult = await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "add_plan_checkpoint",
      input: {
        planId: "plan_human_checkpoint",
        checkpointId: "checkpoint_initial_review",
        title: "Initial human review",
        kind: "human_checkpoint",
        requiredFrom: "human:sensei",
        shepherd: "parley-agent",
        trigger: "manual",
        status: "pending",
        requestedDecision: "approve_or_request_changes"
      }
    });

    const created = checkpointResult.details.result.human_checkpoints.created_obligations;
    assert.equal(created.length, 1);
    assert.equal(created[0].obligation.agent, "parley-agent");
    assert.equal(created[0].obligation.type, "notify_human");
    assert.equal(created[0].obligation.target.review_required_from, "human:sensei");
    assert.equal(created[0].effect.type, "review_requested");

    await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "create_plan",
      input: {
        planId: "plan_human_checkpoint_archived",
        title: "Archived Human Checkpoint Plan",
        authority: "implementation-plan",
        landingSubpath: "agent-comms/parley",
        filename: "human-checkpoint-archived-plan.md",
        participants: ["parley-agent", "human:sensei"]
      }
    });
    await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "write_plan_overview",
      input: {
        planId: "plan_human_checkpoint_archived",
        purpose: "Verify archived plans do not leak checkpoint visibility.",
        background: "Archived sources can retain historical human gates.",
        scopeSummary: "Exercise inactive-source checkpoint filtering.",
        inScope: ["Hide archived human checkpoints"],
        outOfScope: ["Delete historical checkpoint records"],
        currentState: "An archived source may still have human gate phases.",
        targetState: "Derived checkpoint state ignores inactive sources.",
        approach: "Archive the artifact after adding a deferred human gate.",
        acceptanceCriteria: ["Archived human checkpoints are absent from derived board state"],
        risksAndConstraints: ["Do not create notify obligations for deferred gates."]
      }
    });
    const archivedCheckpointResult = await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "add_plan_phase",
      input: {
        planId: "plan_human_checkpoint_archived",
        phaseId: "checkpoint_archived_review",
        title: "Archived human review",
        kind: "human_checkpoint",
        owner: "parley-agent",
        status: "deferred",
        requiredFrom: "human:sensei",
        requestedDecision: "review",
        reviewTrigger: ["Historical review would have been requested before archiving."],
        deferralReason: ["Archived source is not active coordination work."],
        nonGoalsBeforeActivation: ["Do not notify the human from an archived plan."]
      }
    });
    const archivedCheckpointArtifact = archivedCheckpointResult.details.result.artifact;
    await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "register_artifact",
      input: {
        artifactId: archivedCheckpointArtifact.artifact_id,
        kind: "plan",
        storageMode: "explicit_landing",
        uri: archivedCheckpointArtifact.uri,
        version: archivedCheckpointArtifact.version,
        status: "archived",
        title: archivedCheckpointArtifact.title,
        landingRoot: archivedCheckpointArtifact.landing_root,
        resolvedPath: archivedCheckpointArtifact.resolved_path
      }
    });

    const boardResultValue = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "board"
    });
    const checkpointState = boardResultValue.details.result.projection.checkpoint_state;
    assert.equal(boardResultValue.details.result.projection.counts.human_checkpoints, 1);
    assert.equal(boardResultValue.details.result.projection.counts.active_human_checkpoint_obligations, 1);
    assert.equal(checkpointState.human_checkpoints[0].checkpoint_id, "checkpoint_initial_review");
    assert.equal(checkpointState.human_checkpoints[0].phase_id, "checkpoint_initial_review");
    assert.equal(checkpointState.human_checkpoints[0].plan_id, "plan_human_checkpoint");
    assert.equal(checkpointState.human_checkpoints[0].kind, "human_checkpoint");
    assert.equal(checkpointState.human_checkpoints[0].obligation_id, created[0].obligation.obligation_id);

    const whereResult = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "where_am_i"
    });
    assert.equal(whereResult.details.result.projection.counts.human_checkpoints_to_shepherd, 1);
    assert.equal(whereResult.details.result.projection.human_checkpoints_to_shepherd[0].required_from, "human:sensei");
  });
});

test("Parley deferred human approval gate phases do not create notify obligations", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const mutateTool = createMutateTool(toolApi(pluginConfig));
    const queryTool = createQueryTool(toolApi(pluginConfig));

    await createGuidedPlan(mutateTool, {
      planId: "plan_deferred_approval_gate",
      title: "Deferred Approval Gate Plan",
      filename: "deferred-approval-gate-plan.md"
    });
    const gateResult = await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "add_plan_phase",
      input: {
        planId: "plan_deferred_approval_gate",
        phaseId: "phase_human_approval",
        title: "Human approval gate",
        kind: "human_approval_gate",
        owner: "parley-agent",
        status: "deferred",
        requiredFrom: "human:sensei",
        requestedDecision: "approve_or_request_changes",
        reviewTrigger: ["Implementation changes are ready for Sensei review."],
        deferralReason: ["Implementation is not ready for human approval yet."],
        nonGoalsBeforeActivation: ["Do not notify the human while deferred."]
      }
    });
    assert.equal(gateResult.details.result.accepted.phase.kind, "human_approval_gate");
    assert.equal(gateResult.details.result.accepted.phase.owner, "parley-agent");
    assert.equal(gateResult.details.result.human_checkpoints.created_obligations.length, 0);

    const boardResultValue = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "board"
    });
    assert.equal(boardResultValue.details.result.projection.counts.human_checkpoints, 1);
    assert.equal(boardResultValue.details.result.projection.counts.active_human_checkpoint_obligations, 0);
    assert.equal(boardResultValue.details.result.projection.checkpoint_state.human_checkpoints[0].status, "deferred");
  });
});

test("Parley resolves obligations through bound board-scoped triggers", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const mutateTool = createMutateTool(toolApi(pluginConfig));
    const createTriggerTool = createCreateTriggerTool(toolApi(pluginConfig));
    const createObligationTool = createCreateObligationTool(toolApi(pluginConfig));
    const resolveObligationTool = createResolveObligationTool(toolApi(pluginConfig));

    await createGuidedPlan(mutateTool, {
      planId: "plan_trigger_flow",
      title: "Trigger Flow Plan",
      filename: "trigger-flow-plan.md",
      phase: {
        planId: "plan_trigger_flow",
        phaseId: "phase_1",
        title: "Complete phase one",
        owner: "parley-agent",
        status: "complete",
        entryCriteria: ["Plan exists."],
        work: ["Complete the first phase."],
        exitCriteria: ["Phase one is complete."],
        supportingAgents: []
      }
    });

    const triggerResult = await createTriggerTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      triggerId: "trigger_phase_1_done",
      title: "Route completed phase one",
      source: {
        eventType: "obligation.resolved",
        obligationTemplateId: "template_phase_1_execution",
        subjectRef: { kind: "plan_phase", plan_id: "plan_trigger_flow", phase_id: "phase_1" }
      },
      condition: {
        obligationResolutionIn: ["completed"],
        subjectStatusIn: ["complete"]
      },
      action: {
        type: "create_obligation",
        obligation: {
          obligationId: "obligation_phase_2_status",
          templateId: "template_phase_2_status",
          agent: "project-reviewer",
          type: "report_status",
          target: { plan_id: "plan_trigger_flow", phase_id: "phase_2", status: "waiting" },
          reason: "Phase one completed; report phase two readiness."
        }
      },
      firePolicy: "once_per_source_obligation"
    });
    assert.equal(triggerResult.details.trigger.trigger_id, "trigger_phase_1_done");

    const obligationResult = await createObligationTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      obligationId: "obligation_phase_1_execution",
      templateId: "template_phase_1_execution",
      agent: "parley-agent",
      type: "report_status",
      target: { plan_id: "plan_trigger_flow", phase_id: "phase_1", status: "complete" },
      reason: "Report phase one execution result.",
      onResolveTriggerIds: ["trigger_phase_1_done"]
    });
    assert.deepEqual(obligationResult.details.obligation.on_resolve_trigger_ids, ["trigger_phase_1_done"]);

    const resolveResult = await resolveObligationTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      obligationId: "obligation_phase_1_execution",
      resolution: "completed",
      note: "Phase one is complete."
    });

    assert.equal(resolveResult.details.obligation.status, "resolved");
    assert.equal(resolveResult.details.obligation.resolution, "completed");
    assert.equal(resolveResult.details.trigger_evaluation.mode, "obligation_bound");
    assert.equal(resolveResult.details.trigger_evaluation.fired_count, 1);
    assert.equal(resolveResult.details.created_obligations[0].obligation_id, "obligation_phase_2_status");
    assert.equal(resolveResult.details.next_expected_actions[0].actor, "project-reviewer");

    const createdNext = await loadObligationRecord(pluginConfig, resolveParleyBoardRegistry(pluginConfig).boards.project, "obligation_phase_2_status");
    assert.equal(createdNext.agent, "project-reviewer");
    assert.equal(createdNext.source_effect_id, resolveResult.details.effect.effect_id);

    const effects = await listEffectRecords(pluginConfig, resolveParleyBoardRegistry(pluginConfig).boards.project);
    assert.equal(effects.some((effect) => effect.type === "obligation_resolved" && effect.target.obligation_id === "obligation_phase_1_execution"), true);
    assert.equal(effects.some((effect) => effect.effect_id === "effect_trigger_phase_1_done_obligation_phase_1_execution_fired" && effect.type === "trigger_fired"), true);
  });
});

test("Parley once triggers fire before recording side effects only once globally", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const createTriggerTool = createCreateTriggerTool(toolApi(pluginConfig));
    const createObligationTool = createCreateObligationTool(toolApi(pluginConfig));
    const resolveObligationTool = createResolveObligationTool(toolApi(pluginConfig));
    const board = resolveParleyBoardRegistry(pluginConfig).boards.project;

    await createTriggerTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      triggerId: "trigger_once_decision",
      title: "Record first completion decision only",
      source: {
        eventType: "obligation.resolved",
        obligationTemplateId: "template_once_source"
      },
      condition: { obligationResolutionIn: ["completed"] },
      action: {
        type: "record_effect",
        effect: {
          effectId: "effect_once_side_effect",
          type: "decision_recorded",
          target: { trigger_id: "trigger_once_decision" },
          payload: { decision: "first completion observed" }
        }
      },
      firePolicy: "once"
    });

    for (const obligationId of ["obligation_once_a", "obligation_once_b"]) {
      await createObligationTool.execute(null, {
        callerRuntimeRef: AGENT_RUNTIME_REF,
        boardId: "project",
        obligationId,
        templateId: "template_once_source",
        agent: "parley-agent",
        type: "report_status",
        target: { status: "complete" },
        onResolveTriggerIds: ["trigger_once_decision"]
      });
    }

    const firstResolve = await resolveObligationTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      obligationId: "obligation_once_a",
      resolution: "completed"
    });
    const secondResolve = await resolveObligationTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      obligationId: "obligation_once_b",
      resolution: "completed"
    });

    assert.equal(firstResolve.details.trigger_evaluation.fired_count, 1);
    assert.equal(secondResolve.details.trigger_evaluation.fired_count, 0);
    assert.equal(secondResolve.details.skipped_triggers[0].reason, "fire_policy_already_satisfied");

    const effects = await listEffectRecords(pluginConfig, board);
    assert.equal(effects.filter((effect) => effect.effect_id === "effect_once_side_effect").length, 1);
    assert.equal(effects.filter((effect) => effect.effect_id === "effect_trigger_once_decision_fired").length, 1);
  });
});

test("Parley namespace landing fails closed outside allowed plan subpaths", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const restrictedProjectBoard = createProjectBoardConfig(pluginConfig, { repoRoot: REPO_ROOT });
    restrictedProjectBoard.artifact_namespaces = restrictedProjectBoard.artifact_namespaces.map((namespace) => (
      namespace.id === "project_plans" ? { ...namespace, allowed_subpaths: ["approved"] } : namespace
    ));
    const restrictedConfig = {
      ...pluginConfig,
      parleyDefaultBoards: { project: restrictedProjectBoard }
    };
    const mutateTool = createMutateTool(toolApi(restrictedConfig));

    await assert.rejects(
      () => mutateTool.execute(null, {
        callerRuntimeRef: AGENT_RUNTIME_REF,
        boardId: "project",
        action: "create_plan",
        input: {
          planId: "plan_bad_namespace_subpath",
          title: "Bad Namespace Subpath",
          artifactNamespace: "project_plans",
          landingSubpath: "not-approved",
          filename: "bad.md"
        }
      }),
      /allowed namespace subpath/
    );
  });
});

test("Parley activation state surfaces deferred phases and non-executing proposals", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const api = toolApi(pluginConfig);
    const queryTool = createQueryTool(api);
    const mutateTool = createMutateTool(api);

    await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "create_plan",
      input: {
        planId: "plan_activation_visibility",
        title: "Activation Visibility Plan",
        authority: "implementation-plan",
        landingSubpath: "agent-comms/parley",
        filename: "activation-visibility-plan.md",
        participants: ["parley-agent", "project-reviewer"]
      }
    });
    await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "write_plan_overview",
      input: {
        planId: "plan_activation_visibility",
        purpose: "Test activation visibility.",
        background: "Deferred phases should be visible but non-executing.",
        scopeSummary: "Exercise deferred phase visibility.",
        inScope: ["Surface deferred phases"],
        outOfScope: ["Activate or execute phases"],
        currentState: "No candidate has been proposed.",
        targetState: "Deferred phases are visible and proposals are derived from effects.",
        approach: "Create a plan with a deferred phase.",
        acceptanceCriteria: ["Board shows one deferred phase", "No candidate exists before proposal"],
        risksAndConstraints: ["Candidate visibility must remain non-executing."]
      }
    });
    const createResult = await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "add_plan_phase",
      input: {
        planId: "plan_activation_visibility",
        phaseId: "phase_4",
        title: "Deferred Gate",
        owner: "parley-agent",
        status: "deferred",
        supportingAgents: ["project-reviewer"],
        entryCriteria: ["Prior relationship is complete."],
        work: ["Review whether this gate should open."],
        exitCriteria: ["Review decision is recorded."],
        reviewTrigger: ["Human asks to revisit the deferred gate."],
        deferralReason: ["Outside the current slice."],
        nonGoalsBeforeActivation: ["Do not mutate phase status.", "Do not create implementation obligations."]
      }
    });

    await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "create_plan",
      input: {
        planId: "plan_activation_visibility_archived",
        title: "Archived Activation Visibility Plan",
        authority: "implementation-plan",
        landingSubpath: "agent-comms/parley",
        filename: "activation-visibility-archived-plan.md",
        participants: ["parley-agent", "project-reviewer"]
      }
    });
    await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "write_plan_overview",
      input: {
        planId: "plan_activation_visibility_archived",
        purpose: "Verify archived plans do not leak derived activation visibility.",
        background: "Archived sources are historical records, not active coordination work.",
        scopeSummary: "Exercise inactive-source filtering.",
        inScope: ["Hide archived deferred phases"],
        outOfScope: ["Delete historical plan records"],
        currentState: "An archived source may still have deferred phases on disk.",
        targetState: "Derived board state ignores inactive sources.",
        approach: "Archive the artifact after creating a deferred phase.",
        acceptanceCriteria: ["Archived deferred phases are absent from board activation state"],
        risksAndConstraints: ["Do not mutate phase status as part of filtering."]
      }
    });
    const statusWithPhase = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "plan_setup_status",
      input: { planId: "plan_activation_visibility" }
    });
    assert.equal(statusWithPhase.details.result.plan.phase_count, 1);
    assert.equal(statusWithPhase.details.result.plan.checkpoint_count, 0);

    const archivedCreateResult = await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "add_plan_phase",
      input: {
        planId: "plan_activation_visibility_archived",
        phaseId: "phase_archived",
        title: "Archived Deferred Gate",
        owner: "parley-agent",
        status: "deferred",
        entryCriteria: ["Historical record exists."],
        work: ["Do not surface as current work."],
        exitCriteria: ["Projection filtering hides this phase."],
        reviewTrigger: ["Historical review would have been requested before archiving."],
        deferralReason: ["Archived source is not active coordination work."],
        nonGoalsBeforeActivation: ["Do not create activation candidates from an archived plan."]
      }
    });
    const archivedArtifact = archivedCreateResult.details.result.artifact;
    await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "register_artifact",
      input: {
        artifactId: archivedArtifact.artifact_id,
        kind: "plan",
        storageMode: "explicit_landing",
        uri: archivedArtifact.uri,
        version: archivedArtifact.version,
        status: "archived",
        title: archivedArtifact.title,
        landingRoot: archivedArtifact.landing_root,
        resolvedPath: archivedArtifact.resolved_path
      }
    });

    const boardBefore = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "board"
    });
    assert.equal(boardBefore.details.result.projection.counts.deferred_phases, 1);
    assert.equal(boardBefore.details.result.projection.counts.activation_candidates, 0);
    assert.equal(boardBefore.details.result.projection.activation_state.deferred_phases[0].status, "deferred_visible");
    assert.equal(boardBefore.details.result.projection.activation_state.deferred_phases[0].plan_id, "plan_activation_visibility");

    const whereBefore = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "where_am_i"
    });
    assert.equal(whereBefore.details.result.board, undefined);
    assert.equal(whereBefore.details.result.projection.counts.deferred_phases_owned_not_actionable, 1);
    assert.equal(whereBefore.details.result.projection.counts.activation_candidates, 0);
    assert.equal(whereBefore.details.result.projection.deferred_phases_owned_not_actionable[0].activation_conditions, undefined);
    assert.equal(whereBefore.details.result.projection.deferred_phases_owned_not_actionable[0].review_trigger_count, 1);

    await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "record_effect",
      input: {
        type: "activation_proposed",
        target: {
          artifact_id: createResult.details.result.artifact.artifact_id,
          artifact_version: 1,
          plan_id: "plan_activation_visibility",
          phase_id: "phase_4"
        },
        payload: {
          requested_action: "review_activation",
          non_executing: true,
          review_required_from: ["parley-agent"],
          evidence: [
            { type: "manual_proposal", summary: "Human asked to revisit the deferred gate.", confidence: "proposed_not_verified" }
          ]
        }
      }
    });

    const boardAfterProposal = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "board"
    });
    const [candidate] = boardAfterProposal.details.result.projection.activation_state.activation_candidates;
    assert.equal(boardAfterProposal.details.result.projection.counts.activation_candidates, 1);
    assert.equal(candidate.status, "proposed");
    assert.equal(candidate.candidate_key, "project:plan_activation_visibility:phase_4:v1");
    assert.equal(candidate.review_required_from[0], "parley-agent");

    const whereAfterProposal = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "where_am_i"
    });
    assert.equal(whereAfterProposal.details.result.projection.counts.activation_candidates, 1);
    assert.equal(whereAfterProposal.details.result.projection.activation_candidates_needing_attention[0].status, "proposed");

    await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "record_effect",
      input: {
        type: "activation_candidate_dismissed",
        target: {
          artifact_id: createResult.details.result.artifact.artifact_id,
          artifact_version: 1,
          plan_id: "plan_activation_visibility",
          phase_id: "phase_4"
        },
        payload: {
          reason: "Still outside the current implementation slice.",
          suppress_until: { artifact_version_changes: true, new_proposal_effect: true }
        }
      }
    });

    const boardAfterDismissal = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "board"
    });
    assert.equal(boardAfterDismissal.details.result.projection.activation_state.activation_candidates[0].status, "dismissed");

    const whereAfterDismissal = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "where_am_i"
    });
    assert.equal(whereAfterDismissal.details.result.projection.counts.activation_candidates, 0);
  });
});

test("Parley projection checkpoints compare and advance board-agent cursors", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const api = toolApi(pluginConfig);
    const checkpointTool = createCheckpointProjectionTool(api);
    const artifactTool = createRegisterArtifactTool(api);
    const registry = resolveParleyBoardRegistry(pluginConfig);
    const board = registry.boards.project;

    const firstInspect = await checkpointTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      projectionType: "minimal_board"
    });
    assert.equal(firstInspect.details.projection_type, "minimal_board");
    assert.equal(firstInspect.details.advanced, false);
    assert.equal(firstInspect.details.previous_checkpoint, null);
    assert.equal(firstInspect.details.comparison.has_previous, false);
    assert.equal(firstInspect.details.comparison.changed, true);
    assert.equal(firstInspect.details.checkpoint, null);

    const firstAdvance = await checkpointTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      projectionType: "minimal_board",
      advance: true
    });
    assert.equal(firstAdvance.details.advanced, true);
    assert.equal(firstAdvance.details.checkpoint.board_id, "project");
    assert.equal(firstAdvance.details.checkpoint.board_agent_id, "parley-agent");
    assert.equal(firstAdvance.details.checkpoint.projection_type, "minimal_board");
    assert.deepEqual(firstAdvance.details.checkpoint.last_seen_by_runtime_ref, AGENT_RUNTIME_REF);

    const stored = await loadProjectionCheckpointRecord(pluginConfig, board, "parley-agent", "minimal_board");
    assert.equal(stored.cursor.projection_digest, firstAdvance.details.current_cursor.projection_digest);

    const unchangedInspect = await checkpointTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      projectionType: "minimal_board"
    });
    assert.equal(unchangedInspect.details.comparison.has_previous, true);
    assert.equal(unchangedInspect.details.comparison.changed, false);
    assert.deepEqual(unchangedInspect.details.comparison.count_deltas, {});

    await artifactTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      artifactId: "artifact_checkpoint_delta",
      kind: "plan",
      storageMode: "reference_only",
      uri: path.join(pluginConfig.__tempRoot, "refs", "checkpoint-delta.md"),
      title: "Checkpoint Delta Plan"
    });

    const changedInspect = await checkpointTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      projectionType: "minimal_board"
    });
    assert.equal(changedInspect.details.comparison.changed, true);
    assert.deepEqual(changedInspect.details.comparison.count_deltas.artifacts, { before: 0, after: 1, delta: 1 });
    assert.deepEqual(changedInspect.details.comparison.count_deltas["artifacts_by_kind.plan"], { before: 0, after: 1, delta: 1 });

    const whereAdvance = await checkpointTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      projectionType: "where_am_i",
      advance: true
    });
    assert.equal(whereAdvance.details.checkpoint.projection_type, "where_am_i");
    assert.equal(whereAdvance.details.current_cursor.counts.assigned, 0);

    await assert.rejects(
      () => checkpointTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project", projectionType: "activation_candidates" }),
      /projectionType must be one of/
    );
  });
});

test("Parley v2 tools write artifact, object, effect, obligation and where_am_i projection", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const api = toolApi(pluginConfig);
    const artifactTool = createRegisterArtifactTool(api);
    const objectTool = createCreateObjectTool(api);
    const effectTool = createRecordEffectTool(api);
    const obligationTool = createCreateObligationTool(api);
    const whereTool = createWhereAmITool(api);
    const boardProjectionTool = createBoardProjectionTool(api);

    const artifactResult = await artifactTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      artifactId: "artifact_demo",
      kind: "plan",
      storageMode: "managed_local",
      filename: "demo-plan.md",
      title: "Demo Plan",
      bodyText: "# Demo Plan\n"
    });
    const artifact = artifactResult.details.artifact;
    assert.equal(artifact.artifact_id, "artifact_demo");
    assert.equal(artifact.storage_mode, "managed_local");
    assert.match(artifact.resolved_path, /demo-plan\.md$/);
    assert.equal(await fs.readFile(artifact.resolved_path, "utf8"), "# Demo Plan\n");

    const objectResult = await objectTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      objectId: "object_demo",
      kind: "plan",
      title: "Demo coordination object",
      status: "active",
      artifactId: "artifact_demo",
      participants: ["parley-agent", "project-reviewer"]
    });
    const object = objectResult.details.object;
    assert.equal(object.object_id, "object_demo");
    assert.deepEqual(object.artifact_ref, { artifact_id: "artifact_demo", version: 1 });

    const effectResult = await effectTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      effectId: "effect_demo",
      type: "review_requested",
      target: { object_id: "object_demo", artifact_id: "artifact_demo" },
      payload: { reason: "test projection" },
      sourceThreadId: "thread_demo",
      sourceMessageId: "message_demo"
    });
    assert.equal(effectResult.details.ok, true);
    assert.equal(effectResult.details.summary, "Recorded an append-only board effect.");
    assert.equal(effectResult.details.effect.effect_id, "effect_demo");
    assert.equal(effectResult.details.guidance.next[0].tool, "parley_where_am_i");

    const obligationResult = await obligationTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      obligationId: "obligation_demo",
      agent: "parley-agent",
      type: "review",
      status: "blocking",
      target: { object_id: "object_demo", artifact_id: "artifact_demo" },
      scope: "mvp-test",
      reason: "verify where_am_i",
      sourceEffectId: "effect_demo"
    });
    assert.equal(obligationResult.details.obligation.obligation_id, "obligation_demo");

    const registry = resolveParleyBoardRegistry(pluginConfig);
    const board = registry.boards.project;
    assert.equal((await loadArtifactRecord(pluginConfig, board, "artifact_demo")).title, "Demo Plan");
    assert.equal((await loadCoordinationObjectRecord(pluginConfig, board, "object_demo")).title, "Demo coordination object");

    const whereResult = await whereTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project" });
    assert.equal(whereResult.details.identity.board_agent_id, "parley-agent");
    assert.equal(whereResult.details.projection.counts.blocking, 1);
    assert.equal(whereResult.details.projection.blocking_obligations[0].obligation_id, "obligation_demo");
    assert.equal(whereResult.details.projection.blocking_obligations[0].priority, "high");
    assert.equal(whereResult.details.obligation_summary.board.highest_priority, "high");
    assert.equal(whereResult.details.projection.blocking_obligations[0].source_refs.source_thread_id, "thread_demo");
    assert.equal(whereResult.details.projection.blocking_obligations[0].source_refs.source_message_id, "message_demo");
    assert.equal(whereResult.details.projection.blocking_obligations[0].object.object_id, "object_demo");
    assert.equal(whereResult.details.projection.blocking_obligations[0].artifact.artifact_id, "artifact_demo");

    const boardProjectionResult = await boardProjectionTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project", includeRecords: true });
    const projection = boardProjectionResult.details.projection;
    assert.equal(projection.projection_type, "minimal_board");
    assert.equal(projection.derived, true);
    assert.equal(projection.counts.agents, 2);
    assert.equal(projection.counts.artifacts, 1);
    assert.equal(projection.counts.objects, 1);
    assert.equal(projection.counts.effects, 1);
    assert.equal(projection.counts.obligations, 1);
    assert.equal(projection.counts.artifacts_by_kind.plan, 1);
    assert.equal(projection.counts.objects_by_status.active, 1);
    assert.equal(projection.counts.effects_by_type.review_requested, 1);
    assert.equal(projection.counts.obligations_by_agent["parley-agent"].by_status.blocking, 1);
    assert.equal(projection.records.artifacts[0].artifact_id, "artifact_demo");
    assert.equal(projection.records.objects[0].object_id, "object_demo");
    assert.equal(projection.records.effects[0].effect_id, "effect_demo");
    assert.equal(projection.records.obligations[0].obligation_id, "obligation_demo");
  });
});

test("Parley v2 relationship records feed the board relationship graph", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const api = toolApi(pluginConfig);
    const artifactTool = createRegisterArtifactTool(api);
    const objectTool = createCreateObjectTool(api);
    const relationshipTool = createRecordRelationshipTool(api);
    const removeRelationshipTool = createRemoveRelationshipTool(api);
    const boardProjectionTool = createBoardProjectionTool(api);

    await artifactTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      artifactId: "artifact_graph_plan",
      kind: "plan",
      storageMode: "reference_only",
      uri: path.join(pluginConfig.__tempRoot, "refs", "graph-plan.md"),
      version: 1,
      title: "Graph Plan"
    });
    await objectTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      objectId: "object_graph_plan",
      kind: "plan",
      title: "Graph plan object",
      artifactId: "artifact_graph_plan"
    });
    await objectTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      objectId: "object_graph_review",
      kind: "review_request",
      title: "Graph review request"
    });

    const relationshipResult = await relationshipTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      relationshipId: "relationship_graph_review_depends",
      effectId: "effect_relationship_graph_review_depends",
      type: "depends_on",
      from: { kind: "object", id: "object_graph_review" },
      to: { kind: "object", id: "object_graph_plan" },
      reason: "review depends on the plan object",
      sourceThreadId: "thread_graph",
      sourceMessageId: "message_graph"
    });
    assert.equal(relationshipResult.details.relationship.relationship_id, "relationship_graph_review_depends");
    assert.equal(relationshipResult.details.effect.type, "relationship_added");

    const projection = (await boardProjectionTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project", includeRecords: true })).details.projection;
    assert.equal(projection.counts.relationships, 1);
    assert.equal(projection.counts.relationship_edges, 1);
    assert.equal(projection.counts.relationship_nodes, 2);
    assert.equal(projection.counts.relationships_by_type.depends_on, 1);
    assert.equal(projection.relationship_graph.active_edges[0].relationship_id, "relationship_graph_review_depends");
    assert.equal(projection.relationship_graph.active_edges[0].from, "object:object_graph_review");
    assert.equal(projection.relationship_graph.active_edges[0].to, "object:object_graph_plan");
    assert.equal(projection.records.relationships[0].source_effect_id, "effect_relationship_graph_review_depends");

    const removalResult = await removeRelationshipTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      relationshipId: "relationship_graph_review_depends",
      effectId: "effect_relationship_graph_review_depends_removed",
      reason: "Original edge was imprecise; replace it with a constrains edge."
    });
    assert.equal(removalResult.details.relationship.status, "removed");
    assert.equal(removalResult.details.relationship.removed_effect_id, "effect_relationship_graph_review_depends_removed");
    assert.equal(removalResult.details.effect.type, "relationship_removed");
    assert.equal(removalResult.details.effect.payload.removal_mode, "inactive_in_projection");

    const removedProjection = (await boardProjectionTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project", includeRecords: true })).details.projection;
    assert.equal(removedProjection.counts.relationships, 1);
    assert.equal(removedProjection.counts.relationship_edges, 0);
    assert.equal(removedProjection.counts.relationship_nodes, 0);
    assert.equal(removedProjection.counts.relationships_by_status.removed, 1);
    assert.equal(removedProjection.relationship_graph.active_edges.length, 0);
    assert.equal(removedProjection.relationship_graph.inactive_edges[0].relationship_id, "relationship_graph_review_depends");
    assert.equal(removedProjection.records.relationships[0].status, "removed");

    const correctedRelationshipResult = await relationshipTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      relationshipId: "relationship_graph_review_constrains",
      effectId: "effect_relationship_graph_review_constrains",
      type: "constrains",
      from: { kind: "object", id: "object_graph_review" },
      to: { kind: "object", id: "object_graph_plan" },
      reason: "Corrected relation after removing the imprecise depends_on edge.",
      correctionOf: "relationship_graph_review_depends"
    });
    assert.equal(correctedRelationshipResult.details.relationship.correction_of, "relationship_graph_review_depends");
    assert.equal(correctedRelationshipResult.details.effect.payload.correction_of, "relationship_graph_review_depends");

    const correctedProjection = (await boardProjectionTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project", includeRecords: true })).details.projection;
    assert.equal(correctedProjection.counts.relationships, 2);
    assert.equal(correctedProjection.counts.relationship_edges, 1);
    assert.equal(correctedProjection.counts.relationship_nodes, 2);
    assert.equal(correctedProjection.counts.relationships_by_status.active, 1);
    assert.equal(correctedProjection.counts.relationships_by_status.removed, 1);
    assert.equal(correctedProjection.relationship_graph.active_edges[0].relationship_id, "relationship_graph_review_constrains");
    assert.equal(correctedProjection.relationship_graph.active_edges[0].correction_of, "relationship_graph_review_depends");
    assert.equal(correctedProjection.relationship_graph.inactive_edges[0].relationship_id, "relationship_graph_review_depends");
  });
});

test("Parley v2 relationship endpoints must reference existing artifacts or objects", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const relationshipTool = createRecordRelationshipTool(toolApi(pluginConfig));
    await assert.rejects(
      () => relationshipTool.execute(null, {
        callerRuntimeRef: AGENT_RUNTIME_REF,
        boardId: "project",
        type: "depends_on",
        from: { kind: "object", id: "object_missing" },
        to: { kind: "object", id: "object_other_missing" }
      }),
      /from object not found/
    );
  });
});

test("Parley v2 scoped approvals become stale across artifact versions unless carried forward", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const api = toolApi(pluginConfig);
    const artifactTool = createRegisterArtifactTool(api);
    const effectTool = createRecordEffectTool(api);
    const whereTool = createWhereAmITool(api);
    const boardProjectionTool = createBoardProjectionTool(api);

    await artifactTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      artifactId: "artifact_reviewed",
      kind: "plan",
      storageMode: "reference_only",
      uri: path.join(pluginConfig.__tempRoot, "refs", "reviewed-v1.md"),
      version: 1,
      title: "Reviewed Plan"
    });

    await effectTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      effectId: "effect_approval_v1",
      type: "approval_recorded",
      target: { artifact_id: "artifact_reviewed", artifact_version: 1, scope: "implementation" },
      payload: { note: "v1 accepted" }
    });

    await artifactTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      artifactId: "artifact_reviewed",
      kind: "plan",
      storageMode: "reference_only",
      uri: path.join(pluginConfig.__tempRoot, "refs", "reviewed-v2.md"),
      version: 2,
      title: "Reviewed Plan v2"
    });

    const staleProjection = await boardProjectionTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project", includeRecords: false });
    assert.equal(staleProjection.details.projection.counts.approvals, 1);
    assert.equal(staleProjection.details.projection.counts.stale_approvals, 1);
    assert.equal(staleProjection.details.projection.approval_state.approvals[0].status, "stale");
    assert.equal(staleProjection.details.projection.approval_state.approvals[0].stale_reason, "artifact_version_changed");

    const staleWhere = await whereTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project" });
    assert.equal(staleWhere.details.projection.counts.stale_approvals, 1);
    assert.equal(staleWhere.details.projection.stale_approvals[0].artifact_id, "artifact_reviewed");

    await effectTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      effectId: "effect_approval_v2_carry_forward",
      type: "approval_recorded",
      target: { artifact_id: "artifact_reviewed", artifact_version: 2, scope: "implementation" },
      payload: { carry_forward_from_version: 1, note: "carry v1 review forward" }
    });

    const carriedProjection = await boardProjectionTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project", includeRecords: false });
    assert.equal(carriedProjection.details.projection.counts.approvals, 2);
    assert.equal(carriedProjection.details.projection.counts.stale_approvals, 0);
    assert.equal(carriedProjection.details.projection.counts.carried_forward_approvals, 1);
    assert.equal(carriedProjection.details.projection.counts.active_approvals, 1);
    assert.equal(carriedProjection.details.projection.approval_state.approvals[0].status, "carried_forward");
    assert.equal(carriedProjection.details.projection.approval_state.approvals[1].status, "active");
  });
});

test("Parley v2 scoped approval effects require artifact version and authority scope", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const effectTool = createRecordEffectTool(toolApi(pluginConfig));
    await assert.rejects(
      () => effectTool.execute(null, {
        callerRuntimeRef: AGENT_RUNTIME_REF,
        boardId: "project",
        effectId: "effect_unversioned_approval",
        type: "approval_recorded",
        target: { artifact_id: "artifact_missing_version", scope: "implementation" }
      }),
      /requires target.artifact_version/
    );
    await assert.rejects(
      () => effectTool.execute(null, {
        callerRuntimeRef: AGENT_RUNTIME_REF,
        boardId: "project",
        effectId: "effect_unscoped_approval",
        type: "approval_recorded",
        target: { artifact_id: "artifact_missing_scope", artifact_version: 1 }
      }),
      /requires target.scope/
    );
  });
});

test("Parley v2 where_am_i hides terminal obligations by default", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const api = toolApi(pluginConfig);
    const obligationTool = createCreateObligationTool(api);
    const whereTool = createWhereAmITool(api);

    await obligationTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      obligationId: "obligation_resolved",
      agent: "parley-agent",
      type: "report_status",
      status: "resolved",
      target: { note: "done" }
    });

    const defaultResult = await whereTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project" });
    assert.equal(defaultResult.details.board, undefined);
    assert.equal(defaultResult.details.projection.counts.assigned, 1);
    assert.equal(defaultResult.details.projection.counts.visible, 0);

    const includedResult = await whereTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project", includeTerminal: true });
    assert.equal(includedResult.details.verbosity, "compact");
    assert.equal(includedResult.details.projection.counts.visible, 1);
    assert.equal(includedResult.details.projection.other_visible_obligations[0].obligation_id, "obligation_resolved");

    const fullResult = await whereTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project", includeTerminal: true, verbosity: "full" });
    assert.equal(fullResult.details.verbosity, "full");
    assert.deepEqual(fullResult.details.identity.runtime_ref, AGENT_RUNTIME_REF);
    assert.ok(Array.isArray(fullResult.details.identity.runtime_aliases));
    assert.equal(fullResult.details.projection.other_visible_obligations[0].obligation.obligation_id, "obligation_resolved");
  });
});

test("Parley v2 effects are append-only by id", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const effectTool = createRecordEffectTool(toolApi(pluginConfig));
    const payload = {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      effectId: "effect_once",
      type: "decision_recorded",
      target: { object_id: "object_demo" },
      payload: { decision: "first" }
    };

    await effectTool.execute(null, payload);
    await assert.rejects(() => effectTool.execute(null, payload), /already exists/);
  });
});

test("Parley validate_state reports fake-board safety diagnostics without Project defaults", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const fakeRoot = path.join(pluginConfig.__tempRoot, "fake-board-runtime");
    const fakePlans = path.join(pluginConfig.__tempRoot, "fake-plans");
    const fakeConfig = {
      repoRoot: REPO_ROOT,
      parleyBoards: {
        fake: {
          board_id: "fake",
          display_name: "Fake Board",
          board_root: fakeRoot,
          artifact_namespaces: [
            {
              id: "fake_plans",
              roles: ["plan_landing", "explicit_landing", "reference"],
              default_for: ["plan_landing"],
              uri_prefix: "fake://plans/",
              resolved_root: fakePlans,
              allowed_subpaths: ["coordination"]
            }
          ],
          allowed_reference_namespaces: ["fake_plans"],
          permission_model: { mode: "board_wide_all_tools", future_agent_scoping: true },
          agent_registry: [
            {
              board_agent_id: "fake-agent",
              runtime_refs: [{ scheme: "openclaw", type: "agent", id: "fake-agent" }],
              roles: ["implementation"]
            }
          ]
        }
      }
    };
    const fakeRuntimeRef = { scheme: "openclaw", type: "agent", id: "fake-agent" };
    const api = toolApi(fakeConfig);
    const mutateTool = createMutateTool(api);
    const queryTool = createQueryTool(api);
    const validateTool = createValidateStateAction(api);

    assert.match(validateTool.description, /Read-only validator/);
    assert.deepEqual(Object.keys(validateTool.parameters.properties).sort(), ["boardId", "callerRuntimeRef"]);

    await mutateTool.execute(null, {
      callerRuntimeRef: fakeRuntimeRef,
      boardId: "fake",
      action: "create_plan",
      input: {
        planId: "plan_fake_board_fixture",
        title: "Fake Board Fixture",
        landingSubpath: "coordination",
        filename: "fake-board-fixture.md"
      }
    });

    const validationResult = await queryTool.execute(null, {
      callerRuntimeRef: fakeRuntimeRef,
      boardId: "fake",
      action: "validate_state"
    });
    assert.equal(validationResult.details.action, "validate_state");
    assert.equal(validationResult.details.result.validation.ok, true);
    assert.equal(validationResult.details.result.validation.board_id, "fake");
    assert.equal(validationResult.details.result.validation.counts.artifacts, 1);
    assert.equal(validationResult.details.result.validation.errors.length, 0);
    assert.ok(validationResult.details.result.validation.info.some((item) => item.code === "permission_model_advisory"));
  });
});


test("Parley validate_state reports plan lifecycle migration diagnostics", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const api = toolApi(pluginConfig);
    const mutateTool = createMutateTool(api);
    const validateTool = createValidateStateAction(api);
    const board = resolveParleyBoardRegistry(pluginConfig).boards.project;

    const { planId: terminalPlanId } = await createGuidedPlan(mutateTool, {
      planId: "plan_lifecycle_validation_terminal",
      filename: "lifecycle-validation-terminal.md"
    });
    await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "mark_plan_ready",
      input: { planId: terminalPlanId, noReviewReason: "Validation fixture can bypass review." }
    });
    await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "activate_plan",
      input: { planId: terminalPlanId, reason: "Create active lifecycle obligations." }
    });
    const activePlan = await loadPlanSetupRecord(pluginConfig, board, terminalPlanId);
    await savePlanSetupRecord(pluginConfig, board, { ...activePlan, status: "archived" });

    const { planId: activePlanId } = await createGuidedPlan(mutateTool, {
      planId: "plan_lifecycle_validation_active",
      filename: "lifecycle-validation-active.md"
    });
    const badActive = await loadPlanSetupRecord(pluginConfig, board, activePlanId);
    await savePlanSetupRecord(pluginConfig, board, {
      ...badActive,
      status: "active",
      managed: {
        ...badActive.managed,
        current_phase_id: null,
        activeLifecycleObligationIds: ["obligation_missing_lifecycle"]
      }
    });

    const validationResult = await validateTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project" });
    const codes = validationResult.details.validation.errors.map((error) => error.code);
    assert.equal(validationResult.details.validation.ok, false);
    assert.ok(codes.includes("plan_lifecycle_terminal_cursor_present"));
    assert.ok(codes.includes("plan_lifecycle_terminal_active_obligations"));
    assert.ok(codes.includes("plan_lifecycle_active_phase_missing"));
    assert.ok(codes.includes("plan_lifecycle_active_obligation_missing"));
  });
});

test("Parley validate_state reports hash mismatches and relationship cycles", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const api = toolApi(pluginConfig);
    const queryTool = createQueryTool(api);
    const mutateTool = createMutateTool(api);

    const { createResult } = await createGuidedPlan(mutateTool, {
      planId: "plan_validation_hash",
      title: "Validation Hash Plan",
      filename: "validation-hash-plan.md",
      purpose: "Test hash mismatch warnings.",
      approach: "Create then manually edit the plan body.",
      acceptanceCriteria: ["validate_state warns"]
    });
    await fs.appendFile(createResult.details.result.plan.path, "\nManual edit after registration.\n", "utf8");

    for (const objectId of ["object_cycle_a", "object_cycle_b"]) {
      await mutateTool.execute(null, {
        callerRuntimeRef: AGENT_RUNTIME_REF,
        boardId: "project",
        action: "create_object",
        input: { objectId, kind: "plan", title: objectId.replaceAll("_", " ") }
      });
    }
    for (const relationship of [
      ["relationship_depends_a_b", "depends_on", "object_cycle_a", "object_cycle_b"],
      ["relationship_depends_b_a", "depends_on", "object_cycle_b", "object_cycle_a"],
      ["relationship_supersedes_a_b", "supersedes", "object_cycle_a", "object_cycle_b"],
      ["relationship_supersedes_b_a", "supersedes", "object_cycle_b", "object_cycle_a"]
    ]) {
      const [relationshipId, type, fromId, toId] = relationship;
      await mutateTool.execute(null, {
        callerRuntimeRef: AGENT_RUNTIME_REF,
        boardId: "project",
        action: "record_relationship",
        input: {
          relationshipId,
          type,
          from: { kind: "object", id: fromId },
          to: { kind: "object", id: toId }
        }
      });
    }

    const validationResult = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "validate_state"
    });
    const validation = validationResult.details.result.validation;
    assert.equal(validation.ok, false);
    assert.ok(validation.warnings.some((item) => item.code === "artifact_hash_mismatch"));
    assert.ok(validation.warnings.some((item) => item.code === "relationship_cycle" && item.details.relationship_type === "depends_on"));
    assert.ok(validation.errors.some((item) => item.code === "relationship_cycle" && item.details.relationship_type === "supersedes"));
  });
});

test("Parley effect-derived projections use deterministic created_at plus effect_id ordering", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const api = toolApi(pluginConfig);
    const mutateTool = createMutateTool(api);
    const queryTool = createQueryTool(api);
    const registry = resolveParleyBoardRegistry(pluginConfig);
    const board = registry.boards.project;
    const artifactResult = await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "register_artifact",
      input: {
        artifactId: "artifact_same_time_order",
        kind: "plan",
        storageMode: "reference_only",
        uri: path.join(pluginConfig.__tempRoot, "refs", "same-time-order.md"),
        title: "Same Time Order",
        version: 1
      }
    });
    const artifact = artifactResult.details.result.artifact;
    const createdAt = "2026-05-01T00:00:00.000Z";

    const laterAlphabeticalEffect = createEffectRecord({
      board_id: board.board_id,
      effect_id: "effect_same_time_b",
      type: "approval_withdrawn",
      actor: { board_agent_id: "parley-agent", runtime_ref: AGENT_RUNTIME_REF },
      target: { artifact_id: artifact.artifact_id, artifact_version: 1, scope: "schema" },
      payload: { reason: "Withdraw before re-approval in same timestamp fixture." },
      created_at: createdAt
    });
    const earlierAlphabeticalEffect = createEffectRecord({
      board_id: board.board_id,
      effect_id: "effect_same_time_a",
      type: "approval_recorded",
      actor: { board_agent_id: "parley-agent", runtime_ref: AGENT_RUNTIME_REF },
      target: { artifact_id: artifact.artifact_id, artifact_version: 1, scope: "schema" },
      payload: { note: "Approve in same timestamp fixture." },
      created_at: createdAt
    });
    await saveEffectRecord(pluginConfig, board, laterAlphabeticalEffect);
    await saveEffectRecord(pluginConfig, board, earlierAlphabeticalEffect);

    const first = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "board",
      includeRecords: true,
      recordLimit: 10
    });
    const second = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "board",
      includeRecords: true,
      recordLimit: 10
    });

    const effectIds = first.details.result.projection.records.effects.map((effect) => effect.effect_id);
    assert.deepEqual(effectIds.slice(0, 2), ["effect_same_time_a", "effect_same_time_b"]);
    assert.deepEqual(second.details.result.projection.records.effects.map((effect) => effect.effect_id), effectIds);
    assert.equal(first.details.result.projection.approval_state.approvals[0].status, "withdrawn");
  });
});
