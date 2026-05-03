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
  loadProjectionCheckpointRecord
} from "../src/core/storage/board_store.js";
import { createThreadRecord, saveThreadRecord } from "../src/core/storage/store.js";

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
    assert.deepEqual(result.details.identity.runtime_ref, AGENT_RUNTIME_REF);
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
    assert.deepEqual(result.details.identity.runtime_ref, {
      scheme: "openclaw",
      type: "session",
      id: "agent:parley-agent:discord:channel:channel-test-001"
    });
    assert.equal(result.details.identity.identity_resolution.caller_runtime_ref_persisted, false);
    assert.equal(result.details.identity.identity_resolution.source, "adapter_discovered");
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
    assert.equal(artifactResult.details.tool, "parley_mutate");
    assert.equal(artifactResult.details.action, "register_artifact");
    assert.equal(artifactResult.details.result.artifact.artifact_id, "artifact_facade");

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
    assert.equal(runtimeResult.details.result.obligations[0].target.kind, "thread");
    assert.equal(runtimeResult.details.result.obligations[0].target.thread_id, "thread_runtime_action");

    const whereResult = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      action: "where_am_i"
    });
    assert.equal(whereResult.details.result.runtime.obligations.length, 1);
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

    const mutate = await describeTool.execute(null, { topic: "mutate" });
    assert.ok(mutate.details.descriptor.actions.includes("create_plan"));

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
    assert.ok(createPlan.details.descriptor.required_fields.includes("input.phases"));
    assert.match(createPlan.details.descriptor.plan_namespace_behavior[0], /plan_landing/);

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

test("Parley query/mutate façade creates and validates parley.plan.v1 documents", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const api = toolApi(pluginConfig);
    const queryTool = createQueryTool(api);
    const mutateTool = createMutateTool(api);

    const createResult = await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "create_plan",
      input: {
        planId: "plan_facade_create_validate",
        title: "Facade Create Validate Plan",
        authority: "implementation-plan",
        landingSubpath: "agent-comms/parley",
        filename: "facade-create-validate-plan.md",
        participants: ["parley-agent", "human:sensei"],
        scope: {
          summary: "Exercise plan creation through the Parley façade.",
          in: ["Create a namespaced plan document"],
          out: ["Execute deferred work"]
        },
        sections: {
          purpose: "Verify plan tool UX.",
          background: "The schema exists and needs façade access.",
          current_state: "No plan document has been created yet.",
          target_state: "A valid plan document is written and registered.",
          plan: "Create the plan through parley_mutate.",
          acceptance_criteria: "- The file exists\n- Validation succeeds",
          risks_and_constraints: "Keep this non-executing."
        }
      }
    });

    assert.equal(createResult.details.tool, "parley_mutate");
    assert.equal(createResult.details.action, "create_plan");
    assert.equal(createResult.details.result.plan.validation.ok, true);
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
      input: { resolvedPath: planPath }
    });
    assert.equal(validateResult.details.action, "validate_plan");
    assert.equal(validateResult.details.result.validation.ok, true);
  });
});

test("Parley create_plan creates shepherd obligations for human checkpoints", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const api = toolApi(pluginConfig);
    const queryTool = createQueryTool(api);
    const mutateTool = createMutateTool(api);

    const createResult = await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "create_plan",
      input: {
        planId: "plan_human_checkpoint",
        title: "Human Checkpoint Plan",
        authority: "implementation-plan",
        landingSubpath: "agent-comms/parley",
        filename: "human-checkpoint-plan.md",
        coordinationMode: "single_agent_with_human_checkpoints",
        humanCheckpoints: [
          {
            checkpoint_id: "checkpoint_initial_review",
            title: "Initial human review",
            kind: "review",
            required_from: "human:sensei",
            shepherd: "parley-agent",
            trigger: "plan_created",
            status: "pending",
            requested_decision: "approve_or_request_changes"
          }
        ],
        participants: ["parley-agent", "human:sensei"],
        scope: {
          summary: "Exercise human checkpoint obligation creation.",
          in: ["Create shepherd obligation"],
          out: ["Assign obligation directly to a human"]
        },
        sections: {
          purpose: "Verify single-agent human checkpoint MVP.",
          background: "Human checkpoints should create shepherd obligations only through Parley tooling.",
          current_state: "No checkpoint has been requested.",
          target_state: "The shepherd agent has a notify_human obligation.",
          plan: "Create a plan with human_checkpoints frontmatter.",
          acceptance_criteria: "- Checkpoint is visible\n- Shepherd obligation is active",
          risks_and_constraints: "Do not create direct human obligations."
        }
      }
    });

    const created = createResult.details.result.human_checkpoints.created_obligations;
    assert.equal(created.length, 1);
    assert.equal(created[0].obligation.agent, "parley-agent");
    assert.equal(created[0].obligation.type, "notify_human");
    assert.equal(created[0].obligation.target.review_required_from, "human:sensei");
    assert.equal(created[0].effect.type, "review_requested");

    const boardResultValue = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "board"
    });
    const checkpointState = boardResultValue.details.result.projection.checkpoint_state;
    assert.equal(boardResultValue.details.result.projection.counts.human_checkpoints, 1);
    assert.equal(boardResultValue.details.result.projection.counts.active_human_checkpoint_obligations, 1);
    assert.equal(checkpointState.human_checkpoints[0].checkpoint_id, "checkpoint_initial_review");
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
          filename: "bad.md",
          scope: {
            summary: "Should fail.",
            in: ["Attempt bad landing"],
            out: ["Write outside allowed subpaths"]
          }
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

    const createResult = await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "create_plan",
      input: {
        planId: "plan_activation_visibility",
        title: "Activation Visibility Plan",
        authority: "implementation-plan",
        landingSubpath: "agent-comms/parley",
        filename: "activation-visibility-plan.md",
        participants: ["parley-agent", "project-reviewer"],
        scope: {
          summary: "Exercise deferred phase visibility.",
          in: ["Surface deferred phases"],
          out: ["Activate or execute phases"]
        },
        sections: {
          purpose: "Test activation visibility.",
          background: "Deferred phases should be visible but non-executing.",
          current_state: "No candidate has been proposed.",
          target_state: "Deferred phases are visible and proposals are derived from effects.",
          plan: "Create a plan with a deferred phase.",
          phases: [
            "### Phase 4 — Deferred Gate",
            "",
            "Status: deferred",
            "Owner: parley-agent",
            "",
            "Supporting agents:",
            "- project-reviewer",
            "",
            "Entry criteria:",
            "- Prior relationship is complete.",
            "",
            "Work:",
            "- Review whether this gate should open.",
            "",
            "Exit criteria:",
            "- Review decision is recorded.",
            "",
            "Review trigger:",
            "- Human asks to revisit the deferred gate.",
            "",
            "Deferral reason:",
            "- Outside the current slice.",
            "",
            "Non-goals before activation:",
            "- Do not mutate phase status.",
            "- Do not create implementation obligations."
          ].join("\n"),
          acceptance_criteria: "- Board shows one deferred phase\n- No candidate exists before proposal",
          risks_and_constraints: "Candidate visibility must remain non-executing."
        }
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

    const whereBefore = await queryTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "where_am_i"
    });
    assert.equal(whereBefore.details.result.projection.counts.deferred_phases_owned_not_actionable, 1);
    assert.equal(whereBefore.details.result.projection.counts.activation_candidates, 0);

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
    assert.equal(effectResult.details.effect.effect_id, "effect_demo");

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
    assert.equal(defaultResult.details.projection.counts.assigned, 1);
    assert.equal(defaultResult.details.projection.counts.visible, 0);

    const includedResult = await whereTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project", includeTerminal: true });
    assert.equal(includedResult.details.verbosity, "compact");
    assert.equal(includedResult.details.projection.counts.visible, 1);
    assert.equal(includedResult.details.projection.other_visible_obligations[0].obligation_id, "obligation_resolved");

    const fullResult = await whereTool.execute(null, { callerRuntimeRef: AGENT_RUNTIME_REF, boardId: "project", includeTerminal: true, verbosity: "full" });
    assert.equal(fullResult.details.verbosity, "full");
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
        filename: "fake-board-fixture.md",
        scope: {
          summary: "Exercise fake-board validation.",
          in: ["Create non-default plan"],
          out: ["Use generic runtime paths"]
        },
        sections: {
          purpose: "Prove fake-board fixtures remain generic.",
          plan: "Create one valid plan artifact.",
          acceptance_criteria: "- validate_state is clean"
        }
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

test("Parley validate_state reports hash mismatches and relationship cycles", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const api = toolApi(pluginConfig);
    const queryTool = createQueryTool(api);
    const mutateTool = createMutateTool(api);

    const createResult = await mutateTool.execute(null, {
      callerRuntimeRef: AGENT_RUNTIME_REF,
      boardId: "project",
      action: "create_plan",
      input: {
        planId: "plan_validation_hash",
        title: "Validation Hash Plan",
        landingSubpath: "agent-comms/parley",
        filename: "validation-hash-plan.md",
        scope: {
          summary: "Exercise artifact hash diagnostics.",
          in: ["Create hashed artifact"],
          out: ["Infer semantic version changes"]
        },
        sections: {
          purpose: "Test hash mismatch warnings.",
          plan: "Create then manually edit the plan body.",
          acceptance_criteria: "- validate_state warns"
        }
      }
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
