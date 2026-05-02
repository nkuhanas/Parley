import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveCallerBoardMemberships, resolveCallerIdentity } from "../src/board.js";
import { createKairosBoardConfig } from "../src/adapters/kairos_board.js";
import { resolveParleyBoardRegistry } from "../src/config.js";
import { createRegisterArtifactTool } from "../src/actions/register_artifact.js";
import { createCreateObjectTool } from "../src/actions/create_object.js";
import { createRecordEffectTool } from "../src/actions/record_effect.js";
import { createCreateObligationTool } from "../src/actions/create_obligation.js";
import { createWhereAmITool } from "../src/actions/where_am_i.js";
import { createBoardProjectionTool } from "../src/actions/board_projection.js";
import { createRecordRelationshipTool } from "../src/actions/record_relationship.js";
import { createRemoveRelationshipTool } from "../src/actions/remove_relationship.js";
import { createCheckpointProjectionTool } from "../src/actions/checkpoint_projection.js";
import { createValidateStateAction } from "../src/actions/validate_state.js";
import { createQueryTool } from "../src/actions/query.js";
import { createMutateTool } from "../src/actions/mutate.js";
import {
  createCoordinationObjectRecord,
  createEffectRecord,
  saveEffectRecord,
  loadArtifactRecord,
  loadCoordinationObjectRecord,
  loadProjectionCheckpointRecord
} from "../src/board_store.js";

const REPO_ROOT = "/home/agent/workspace/Kairos";
const OPERATOR_RUNTIME_REF = { scheme: "openclaw", type: "agent", id: "kairos-operator" };

async function makePluginConfig() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "parley-v2-test-"));
  const baseConfig = {
    repoRoot: REPO_ROOT,
    parleyRuntimeRoot: path.join(tempRoot, "thread-runtime"),
    parleyRoot: path.join(tempRoot, "board-runtime"),
    parleyKairosDefaultPlanLandingRoot: path.join(tempRoot, "repo", "plans"),
    parleyKairosAllowedReferenceRoots: [path.join(tempRoot, "refs")],
    parleyKairosAllowedLandingRoots: [path.join(tempRoot, "repo", "plans")],
    __tempRoot: tempRoot
  };
  return {
    ...baseConfig,
    parleyDefaultBoards: {
      kairos: createKairosBoardConfig(baseConfig, { repoRoot: REPO_ROOT })
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
    const identity = resolveCallerIdentity(pluginConfig, { callerRuntimeRef: OPERATOR_RUNTIME_REF });

    assert.equal(identity.board_id, "kairos");
    assert.equal(identity.board_agent_id, "kairos-operator");
    assert.equal(identity.actor.board_agent_id, "kairos-operator");
    assert.deepEqual(identity.runtime_ref, OPERATOR_RUNTIME_REF);
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

test("Parley v2 board registry accepts explicit non-Kairos board config without embedded defaults", async () => {
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
      callerRuntimeRef: { scheme: "openclaw", type: "agent", id: "solo-agent" }
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
          "kairos-operator": {
            display_name: "Rio",
            kind: "agent",
            runtime_bindings: [OPERATOR_RUNTIME_REF],
            default_board: "kairos",
            memberships: {
              kairos: {
                board_agent_id: "kairos-operator",
                permissions: { preset: "board_admin" },
                roles: ["implementation", "runtime"]
              },
              parley: {
                board_agent_id: "kairos-operator",
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
              agent_id: "kairos-operator",
              board_agent_id: "kairos-operator"
            }
          ]
        }
      }
    };

    const defaultIdentity = resolveCallerIdentity(config, { callerRuntimeRef: OPERATOR_RUNTIME_REF });
    assert.equal(defaultIdentity.global_agent_id, "kairos-operator");
    assert.equal(defaultIdentity.board_id, "kairos");
    assert.equal(defaultIdentity.identity_resolution.used_default_board, true);

    const parleyIdentity = resolveCallerIdentity(config, { callerRuntimeRef: OPERATOR_RUNTIME_REF, boardId: "parley" });
    assert.equal(parleyIdentity.global_agent_id, "kairos-operator");
    assert.equal(parleyIdentity.board_id, "parley");
    assert.equal(parleyIdentity.board_agent_id, "kairos-operator");
    assert.equal(parleyIdentity.identity_resolution.used_default_board, false);

    const memberships = resolveCallerBoardMemberships(config, { callerRuntimeRef: OPERATOR_RUNTIME_REF });
    assert.equal(memberships.global_agent_id, "kairos-operator");
    assert.equal(memberships.default_board, "kairos");
    assert.deepEqual(memberships.boards.map((board) => board.board_id), ["kairos", "parley"]);
    assert.deepEqual(
      memberships.boards.map((board) => [board.board_id, board.board_agent_id, board.is_default]),
      [["kairos", "kairos-operator", true], ["parley", "kairos-operator", false]]
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
          "kairos-operator": {
            runtime_bindings: [OPERATOR_RUNTIME_REF],
            default_board: "kairos",
            memberships: {
              kairos: { board_agent_id: "kairos-operator" }
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
      () => resolveCallerIdentity(config, { callerRuntimeRef: OPERATOR_RUNTIME_REF, boardId: "parley" }),
      /not a member of board: parley/
    );
  });
});

test("Parley v2 tools derive caller identity from trusted OpenClaw runtime context", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const whereTool = createWhereAmITool({ pluginConfig, toolContext: { agentId: "kairos-operator" } });

    assert.ok(!whereTool.parameters.required?.includes("callerRuntimeRef"));

    const result = await whereTool.execute(null, {});
    assert.equal(result.details.identity.board_agent_id, "kairos-operator");
    assert.deepEqual(result.details.identity.runtime_ref, OPERATOR_RUNTIME_REF);
  });
});

test("Parley v2 tool caller identity falls back to runtime session key when agent id is unavailable", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const whereTool = createWhereAmITool({
      pluginConfig,
      toolContext: { sessionKey: "agent:kairos-operator:discord:channel:1494492383726010418" }
    });

    const result = await whereTool.execute(null, {});
    assert.equal(result.details.identity.board_agent_id, "kairos-operator");
    assert.deepEqual(result.details.identity.runtime_ref, {
      scheme: "openclaw",
      type: "session",
      id: "agent:kairos-operator:discord:channel:1494492383726010418"
    });
    assert.equal(result.details.identity.identity_resolution.caller_runtime_ref_persisted, true);
  });
});

test("Parley identity derives OpenClaw agent aliases without persisting discovered sessions", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const agentOnlyConfig = {
      ...pluginConfig,
      parleyDefaultBoards: {
        kairos: {
          ...pluginConfig.parleyDefaultBoards.kairos,
          agent_registry: pluginConfig.parleyDefaultBoards.kairos.agent_registry.map((agent) => ({
            ...agent,
            runtime_refs: agent.runtime_refs.filter((runtimeRef) => runtimeRef.type === "agent")
          }))
        }
      }
    };

    const callerRuntimeRef = {
      scheme: "openclaw",
      type: "session",
      id: "agent:kairos-operator:discord:channel:1494492383726010418"
    };
    const identity = resolveCallerIdentity(agentOnlyConfig, { callerRuntimeRef });

    assert.equal(identity.board_agent_id, "kairos-operator");
    assert.deepEqual(identity.runtime_ref, callerRuntimeRef);
    assert.equal(identity.identity_resolution.source, "adapter_discovered");
    assert.equal(identity.identity_resolution.caller_runtime_ref_persisted, false);
    assert.deepEqual(identity.identity_resolution.resolved_by_runtime_ref, {
      scheme: "openclaw",
      type: "agent",
      id: "kairos-operator",
      key: "openclaw:agent:kairos-operator"
    });
    assert.ok(identity.identity_resolution.candidates.some((candidate) => candidate.runtime_ref.key === "openclaw:session:agent:kairos-operator:discord:channel:1494492383726010418"));
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
              runtime_refs: [OPERATOR_RUNTIME_REF]
            }
          ]
        }
      }
    };

    assert.throws(
      () => resolveCallerIdentity(ambiguousConfig, { callerRuntimeRef: OPERATOR_RUNTIME_REF }),
      /ambiguously/
    );
    assert.throws(
      () => resolveCallerIdentity(ambiguousConfig, {
        callerRuntimeRef: {
          scheme: "openclaw",
          type: "session",
          id: "agent:kairos-operator:discord:channel:1494492383726010418"
        }
      }),
      /ambiguously.*kairos-operator, other-agent/
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
    assert.deepEqual(relationshipTool.parameters.required, ["type", "from", "to"]);
    assert.match(removeRelationshipTool.description, /Logically remove/);
    assert.deepEqual(removeRelationshipTool.parameters.required, ["relationshipId", "reason"]);
    assert.match(checkpointTool.description, /projection checkpoint/);
    assert.deepEqual(Object.keys(checkpointTool.parameters.properties).sort(), ["advance", "boardId", "callerRuntimeRef", "includeTerminal", "projectionType"]);

    await assert.rejects(
      () => effectTool.execute(null, {
        callerRuntimeRef: OPERATOR_RUNTIME_REF,
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
          review_required_from: ["kairos-operator"]
        }
      }),
      /target\.invented is not allowed/
    );

    await assert.rejects(
      () => obligationTool.execute(null, {
        callerRuntimeRef: OPERATOR_RUNTIME_REF,
        agent: "kairos-operator",
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
      board_id: "kairos",
      effect_id: "effect_bad_actor",
      type: "decision_recorded",
      actor: { board_agent_id: "kairos-operator" },
      target: { object_id: "object_demo" },
      payload: { decision: "accept" }
    }),
    /actor\.runtime_ref must be an object/
  );

  assert.throws(
    () => createCoordinationObjectRecord({
      board_id: "kairos",
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
    assert.deepEqual(mutateTool.parameters.required, ["action"]);

    const artifactResult = await mutateTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
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
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      action: "board"
    });
    assert.equal(boardResultValue.details.tool, "parley_query");
    assert.equal(boardResultValue.details.action, "board");
    assert.equal(boardResultValue.details.result.projection.counts.artifacts, 1);
    assert.equal(boardResultValue.details.result.projection.records, null);

    const whereResult = await queryTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      action: "where_am_i"
    });
    assert.equal(whereResult.details.result.projection.board_agent_id, "kairos-operator");

    const myBoardsResult = await queryTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      action: "my_boards"
    });
    assert.equal(myBoardsResult.details.action, "my_boards");
    assert.equal(myBoardsResult.details.result.result.global_agent_id, "kairos-operator");
    assert.deepEqual(myBoardsResult.details.result.result.boards.map((board) => board.board_id), ["kairos"]);
    await assert.rejects(
      () => queryTool.execute(null, { callerRuntimeRef: OPERATOR_RUNTIME_REF, action: "my_boards", boardId: "kairos" }),
      /parley_my_boards does not accept parameter: boardId/
    );

    await assert.rejects(
      () => queryTool.execute(null, { callerRuntimeRef: OPERATOR_RUNTIME_REF, action: "activation_candidates" }),
      /unsupported parley_query action/
    );
    await assert.rejects(
      () => mutateTool.execute(null, { callerRuntimeRef: OPERATOR_RUNTIME_REF, action: "defer_phase" }),
      /unsupported parley_mutate action/
    );
    await assert.rejects(
      () => mutateTool.execute(null, {
        callerRuntimeRef: OPERATOR_RUNTIME_REF,
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

test("Parley query/mutate façade creates and validates parley.plan.v1 documents", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const api = toolApi(pluginConfig);
    const queryTool = createQueryTool(api);
    const mutateTool = createMutateTool(api);

    const createResult = await mutateTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      action: "create_plan",
      input: {
        planId: "plan_facade_create_validate",
        title: "Facade Create Validate Plan",
        authority: "implementation-plan",
        landingSubpath: "agent-comms/parley",
        filename: "facade-create-validate-plan.md",
        participants: ["kairos-operator", "human:sensei"],
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

    const artifact = await loadArtifactRecord(pluginConfig, resolveParleyBoardRegistry(pluginConfig).boards.kairos, "artifact_facade_create_validate");
    assert.equal(artifact.resolved_path, planPath);

    const validateResult = await queryTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
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
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
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
            shepherd: "kairos-operator",
            trigger: "plan_created",
            status: "pending",
            requested_decision: "approve_or_request_changes"
          }
        ],
        participants: ["kairos-operator", "human:sensei"],
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
    assert.equal(created[0].obligation.agent, "kairos-operator");
    assert.equal(created[0].obligation.type, "notify_human");
    assert.equal(created[0].obligation.target.review_required_from, "human:sensei");
    assert.equal(created[0].effect.type, "review_requested");

    const boardResultValue = await queryTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      action: "board"
    });
    const checkpointState = boardResultValue.details.result.projection.checkpoint_state;
    assert.equal(boardResultValue.details.result.projection.counts.human_checkpoints, 1);
    assert.equal(boardResultValue.details.result.projection.counts.active_human_checkpoint_obligations, 1);
    assert.equal(checkpointState.human_checkpoints[0].checkpoint_id, "checkpoint_initial_review");
    assert.equal(checkpointState.human_checkpoints[0].obligation_id, created[0].obligation.obligation_id);

    const whereResult = await queryTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      action: "where_am_i"
    });
    assert.equal(whereResult.details.result.projection.counts.human_checkpoints_to_shepherd, 1);
    assert.equal(whereResult.details.result.projection.human_checkpoints_to_shepherd[0].required_from, "human:sensei");
  });
});

test("Parley namespace landing fails closed outside allowed plan subpaths", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const mutateTool = createMutateTool(toolApi(pluginConfig));

    await assert.rejects(
      () => mutateTool.execute(null, {
        callerRuntimeRef: OPERATOR_RUNTIME_REF,
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
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      action: "create_plan",
      input: {
        planId: "plan_activation_visibility",
        title: "Activation Visibility Plan",
        authority: "implementation-plan",
        landingSubpath: "agent-comms/parley",
        filename: "activation-visibility-plan.md",
        participants: ["kairos-operator", "kairos-orchestrator"],
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
            "Owner: kairos-operator",
            "",
            "Supporting agents:",
            "- kairos-orchestrator",
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
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      action: "board"
    });
    assert.equal(boardBefore.details.result.projection.counts.deferred_phases, 1);
    assert.equal(boardBefore.details.result.projection.counts.activation_candidates, 0);
    assert.equal(boardBefore.details.result.projection.activation_state.deferred_phases[0].status, "deferred_visible");

    const whereBefore = await queryTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      action: "where_am_i"
    });
    assert.equal(whereBefore.details.result.projection.counts.deferred_phases_owned_not_actionable, 1);
    assert.equal(whereBefore.details.result.projection.counts.activation_candidates, 0);

    await mutateTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
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
          review_required_from: ["kairos-operator"],
          evidence: [
            { type: "manual_proposal", summary: "Human asked to revisit the deferred gate.", confidence: "proposed_not_verified" }
          ]
        }
      }
    });

    const boardAfterProposal = await queryTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      action: "board"
    });
    const [candidate] = boardAfterProposal.details.result.projection.activation_state.activation_candidates;
    assert.equal(boardAfterProposal.details.result.projection.counts.activation_candidates, 1);
    assert.equal(candidate.status, "proposed");
    assert.equal(candidate.candidate_key, "kairos:plan_activation_visibility:phase_4:v1");
    assert.equal(candidate.review_required_from[0], "kairos-operator");

    const whereAfterProposal = await queryTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      action: "where_am_i"
    });
    assert.equal(whereAfterProposal.details.result.projection.counts.activation_candidates, 1);
    assert.equal(whereAfterProposal.details.result.projection.activation_candidates_needing_attention[0].status, "proposed");

    await mutateTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
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
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      action: "board"
    });
    assert.equal(boardAfterDismissal.details.result.projection.activation_state.activation_candidates[0].status, "dismissed");

    const whereAfterDismissal = await queryTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
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
    const board = registry.boards.kairos;

    const firstInspect = await checkpointTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      projectionType: "minimal_board"
    });
    assert.equal(firstInspect.details.projection_type, "minimal_board");
    assert.equal(firstInspect.details.advanced, false);
    assert.equal(firstInspect.details.previous_checkpoint, null);
    assert.equal(firstInspect.details.comparison.has_previous, false);
    assert.equal(firstInspect.details.comparison.changed, true);
    assert.equal(firstInspect.details.checkpoint, null);

    const firstAdvance = await checkpointTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      projectionType: "minimal_board",
      advance: true
    });
    assert.equal(firstAdvance.details.advanced, true);
    assert.equal(firstAdvance.details.checkpoint.board_id, "kairos");
    assert.equal(firstAdvance.details.checkpoint.board_agent_id, "kairos-operator");
    assert.equal(firstAdvance.details.checkpoint.projection_type, "minimal_board");
    assert.deepEqual(firstAdvance.details.checkpoint.last_seen_by_runtime_ref, OPERATOR_RUNTIME_REF);

    const stored = await loadProjectionCheckpointRecord(pluginConfig, board, "kairos-operator", "minimal_board");
    assert.equal(stored.cursor.projection_digest, firstAdvance.details.current_cursor.projection_digest);

    const unchangedInspect = await checkpointTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      projectionType: "minimal_board"
    });
    assert.equal(unchangedInspect.details.comparison.has_previous, true);
    assert.equal(unchangedInspect.details.comparison.changed, false);
    assert.deepEqual(unchangedInspect.details.comparison.count_deltas, {});

    await artifactTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      artifactId: "artifact_checkpoint_delta",
      kind: "plan",
      storageMode: "reference_only",
      uri: path.join(pluginConfig.__tempRoot, "refs", "checkpoint-delta.md"),
      title: "Checkpoint Delta Plan"
    });

    const changedInspect = await checkpointTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      projectionType: "minimal_board"
    });
    assert.equal(changedInspect.details.comparison.changed, true);
    assert.deepEqual(changedInspect.details.comparison.count_deltas.artifacts, { before: 0, after: 1, delta: 1 });
    assert.deepEqual(changedInspect.details.comparison.count_deltas["artifacts_by_kind.plan"], { before: 0, after: 1, delta: 1 });

    const whereAdvance = await checkpointTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      projectionType: "where_am_i",
      advance: true
    });
    assert.equal(whereAdvance.details.checkpoint.projection_type, "where_am_i");
    assert.equal(whereAdvance.details.current_cursor.counts.assigned, 0);

    await assert.rejects(
      () => checkpointTool.execute(null, { callerRuntimeRef: OPERATOR_RUNTIME_REF, projectionType: "activation_candidates" }),
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
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
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
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      objectId: "object_demo",
      kind: "plan",
      title: "Demo coordination object",
      status: "active",
      artifactId: "artifact_demo",
      participants: ["kairos-operator", "kairos-orchestrator"]
    });
    const object = objectResult.details.object;
    assert.equal(object.object_id, "object_demo");
    assert.deepEqual(object.artifact_ref, { artifact_id: "artifact_demo", version: 1 });

    const effectResult = await effectTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      effectId: "effect_demo",
      type: "review_requested",
      target: { object_id: "object_demo", artifact_id: "artifact_demo" },
      payload: { reason: "test projection" },
      sourceThreadId: "thread_demo",
      sourceMessageId: "message_demo"
    });
    assert.equal(effectResult.details.effect.effect_id, "effect_demo");

    const obligationResult = await obligationTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      obligationId: "obligation_demo",
      agent: "kairos-operator",
      type: "review",
      status: "blocking",
      target: { object_id: "object_demo", artifact_id: "artifact_demo" },
      scope: "mvp-test",
      reason: "verify where_am_i",
      sourceEffectId: "effect_demo"
    });
    assert.equal(obligationResult.details.obligation.obligation_id, "obligation_demo");

    const registry = resolveParleyBoardRegistry(pluginConfig);
    const board = registry.boards.kairos;
    assert.equal((await loadArtifactRecord(pluginConfig, board, "artifact_demo")).title, "Demo Plan");
    assert.equal((await loadCoordinationObjectRecord(pluginConfig, board, "object_demo")).title, "Demo coordination object");

    const whereResult = await whereTool.execute(null, { callerRuntimeRef: OPERATOR_RUNTIME_REF });
    assert.equal(whereResult.details.identity.board_agent_id, "kairos-operator");
    assert.equal(whereResult.details.projection.counts.blocking, 1);
    assert.equal(whereResult.details.projection.blocking_obligations[0].obligation.obligation_id, "obligation_demo");
    assert.equal(whereResult.details.projection.blocking_obligations[0].source_refs.source_thread_id, "thread_demo");
    assert.equal(whereResult.details.projection.blocking_obligations[0].source_refs.source_message_id, "message_demo");
    assert.equal(whereResult.details.projection.blocking_obligations[0].object.object_id, "object_demo");
    assert.equal(whereResult.details.projection.blocking_obligations[0].artifact.artifact_id, "artifact_demo");

    const boardProjectionResult = await boardProjectionTool.execute(null, { callerRuntimeRef: OPERATOR_RUNTIME_REF, includeRecords: true });
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
    assert.equal(projection.counts.obligations_by_agent["kairos-operator"].by_status.blocking, 1);
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
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      artifactId: "artifact_graph_plan",
      kind: "plan",
      storageMode: "reference_only",
      uri: path.join(pluginConfig.__tempRoot, "refs", "graph-plan.md"),
      version: 1,
      title: "Graph Plan"
    });
    await objectTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      objectId: "object_graph_plan",
      kind: "plan",
      title: "Graph plan object",
      artifactId: "artifact_graph_plan"
    });
    await objectTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      objectId: "object_graph_review",
      kind: "review_request",
      title: "Graph review request"
    });

    const relationshipResult = await relationshipTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
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

    const projection = (await boardProjectionTool.execute(null, { callerRuntimeRef: OPERATOR_RUNTIME_REF, includeRecords: true })).details.projection;
    assert.equal(projection.counts.relationships, 1);
    assert.equal(projection.counts.relationship_edges, 1);
    assert.equal(projection.counts.relationship_nodes, 2);
    assert.equal(projection.counts.relationships_by_type.depends_on, 1);
    assert.equal(projection.relationship_graph.active_edges[0].relationship_id, "relationship_graph_review_depends");
    assert.equal(projection.relationship_graph.active_edges[0].from, "object:object_graph_review");
    assert.equal(projection.relationship_graph.active_edges[0].to, "object:object_graph_plan");
    assert.equal(projection.records.relationships[0].source_effect_id, "effect_relationship_graph_review_depends");

    const removalResult = await removeRelationshipTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      relationshipId: "relationship_graph_review_depends",
      effectId: "effect_relationship_graph_review_depends_removed",
      reason: "Original edge was imprecise; replace it with a constrains edge."
    });
    assert.equal(removalResult.details.relationship.status, "removed");
    assert.equal(removalResult.details.relationship.removed_effect_id, "effect_relationship_graph_review_depends_removed");
    assert.equal(removalResult.details.effect.type, "relationship_removed");
    assert.equal(removalResult.details.effect.payload.removal_mode, "inactive_in_projection");

    const removedProjection = (await boardProjectionTool.execute(null, { callerRuntimeRef: OPERATOR_RUNTIME_REF, includeRecords: true })).details.projection;
    assert.equal(removedProjection.counts.relationships, 1);
    assert.equal(removedProjection.counts.relationship_edges, 0);
    assert.equal(removedProjection.counts.relationship_nodes, 0);
    assert.equal(removedProjection.counts.relationships_by_status.removed, 1);
    assert.equal(removedProjection.relationship_graph.active_edges.length, 0);
    assert.equal(removedProjection.relationship_graph.inactive_edges[0].relationship_id, "relationship_graph_review_depends");
    assert.equal(removedProjection.records.relationships[0].status, "removed");

    const correctedRelationshipResult = await relationshipTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
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

    const correctedProjection = (await boardProjectionTool.execute(null, { callerRuntimeRef: OPERATOR_RUNTIME_REF, includeRecords: true })).details.projection;
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
        callerRuntimeRef: OPERATOR_RUNTIME_REF,
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
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      artifactId: "artifact_reviewed",
      kind: "plan",
      storageMode: "reference_only",
      uri: path.join(pluginConfig.__tempRoot, "refs", "reviewed-v1.md"),
      version: 1,
      title: "Reviewed Plan"
    });

    await effectTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      effectId: "effect_approval_v1",
      type: "approval_recorded",
      target: { artifact_id: "artifact_reviewed", artifact_version: 1, scope: "implementation" },
      payload: { note: "v1 accepted" }
    });

    await artifactTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      artifactId: "artifact_reviewed",
      kind: "plan",
      storageMode: "reference_only",
      uri: path.join(pluginConfig.__tempRoot, "refs", "reviewed-v2.md"),
      version: 2,
      title: "Reviewed Plan v2"
    });

    const staleProjection = await boardProjectionTool.execute(null, { callerRuntimeRef: OPERATOR_RUNTIME_REF, includeRecords: false });
    assert.equal(staleProjection.details.projection.counts.approvals, 1);
    assert.equal(staleProjection.details.projection.counts.stale_approvals, 1);
    assert.equal(staleProjection.details.projection.approval_state.approvals[0].status, "stale");
    assert.equal(staleProjection.details.projection.approval_state.approvals[0].stale_reason, "artifact_version_changed");

    const staleWhere = await whereTool.execute(null, { callerRuntimeRef: OPERATOR_RUNTIME_REF });
    assert.equal(staleWhere.details.projection.counts.stale_approvals, 1);
    assert.equal(staleWhere.details.projection.stale_approvals[0].artifact_id, "artifact_reviewed");

    await effectTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      effectId: "effect_approval_v2_carry_forward",
      type: "approval_recorded",
      target: { artifact_id: "artifact_reviewed", artifact_version: 2, scope: "implementation" },
      payload: { carry_forward_from_version: 1, note: "carry v1 review forward" }
    });

    const carriedProjection = await boardProjectionTool.execute(null, { callerRuntimeRef: OPERATOR_RUNTIME_REF, includeRecords: false });
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
        callerRuntimeRef: OPERATOR_RUNTIME_REF,
        effectId: "effect_unversioned_approval",
        type: "approval_recorded",
        target: { artifact_id: "artifact_missing_version", scope: "implementation" }
      }),
      /requires target.artifact_version/
    );
    await assert.rejects(
      () => effectTool.execute(null, {
        callerRuntimeRef: OPERATOR_RUNTIME_REF,
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
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      obligationId: "obligation_resolved",
      agent: "kairos-operator",
      type: "report_status",
      status: "resolved",
      target: { note: "done" }
    });

    const defaultResult = await whereTool.execute(null, { callerRuntimeRef: OPERATOR_RUNTIME_REF });
    assert.equal(defaultResult.details.projection.counts.assigned, 1);
    assert.equal(defaultResult.details.projection.counts.visible, 0);

    const includedResult = await whereTool.execute(null, { callerRuntimeRef: OPERATOR_RUNTIME_REF, includeTerminal: true });
    assert.equal(includedResult.details.projection.counts.visible, 1);
    assert.equal(includedResult.details.projection.other_visible_obligations[0].obligation.obligation_id, "obligation_resolved");
  });
});

test("Parley v2 effects are append-only by id", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const effectTool = createRecordEffectTool(toolApi(pluginConfig));
    const payload = {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      effectId: "effect_once",
      type: "decision_recorded",
      target: { object_id: "object_demo" },
      payload: { decision: "first" }
    };

    await effectTool.execute(null, payload);
    await assert.rejects(() => effectTool.execute(null, payload), /already exists/);
  });
});

test("Parley validate_state reports fake-board safety diagnostics without Kairos defaults", async () => {
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
      action: "create_plan",
      input: {
        planId: "plan_fake_board_fixture",
        title: "Fake Board Fixture",
        landingSubpath: "coordination",
        filename: "fake-board-fixture.md",
        scope: {
          summary: "Exercise fake-board validation.",
          in: ["Create non-Kairos plan"],
          out: ["Use Kairos runtime paths"]
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
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
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
        callerRuntimeRef: OPERATOR_RUNTIME_REF,
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
        callerRuntimeRef: OPERATOR_RUNTIME_REF,
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
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
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
    const board = registry.boards.kairos;
    const artifactResult = await mutateTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
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
      actor: { board_agent_id: "kairos-operator", runtime_ref: OPERATOR_RUNTIME_REF },
      target: { artifact_id: artifact.artifact_id, artifact_version: 1, scope: "schema" },
      payload: { reason: "Withdraw before re-approval in same timestamp fixture." },
      created_at: createdAt
    });
    const earlierAlphabeticalEffect = createEffectRecord({
      board_id: board.board_id,
      effect_id: "effect_same_time_a",
      type: "approval_recorded",
      actor: { board_agent_id: "kairos-operator", runtime_ref: OPERATOR_RUNTIME_REF },
      target: { artifact_id: artifact.artifact_id, artifact_version: 1, scope: "schema" },
      payload: { note: "Approve in same timestamp fixture." },
      created_at: createdAt
    });
    await saveEffectRecord(pluginConfig, board, laterAlphabeticalEffect);
    await saveEffectRecord(pluginConfig, board, earlierAlphabeticalEffect);

    const first = await queryTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
      action: "board",
      includeRecords: true,
      recordLimit: 10
    });
    const second = await queryTool.execute(null, {
      callerRuntimeRef: OPERATOR_RUNTIME_REF,
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
