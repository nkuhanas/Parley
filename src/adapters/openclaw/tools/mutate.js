import { createCreateObjectTool } from "./create_object.js";
import { createCreateObligationTool } from "./create_obligation.js";
import { createCreateTriggerTool } from "./create_trigger.js";
import { createResolveObligationTool } from "./resolve_obligation.js";
import { createCreatePlanAction } from "./create_plan.js";
import { createWritePlanOverviewAction } from "./write_plan_overview.js";
import { createAddPlanPhaseAction } from "./add_plan_phase.js";
import { createAddPlanCheckpointAction } from "./add_plan_checkpoint.js";
import { createRecordEffectTool } from "./record_effect.js";
import { createRecordRelationshipTool } from "./record_relationship.js";
import { createRemoveRelationshipTool } from "./remove_relationship.js";
import { createRegisterArtifactTool } from "./register_artifact.js";
import { createValidationError, MUTATE_ACTIONS } from "./descriptors.js";
import { boardResult, callerRuntimeRefParameter } from "./v2_common.js";

const MUTATE_TOOL_FACTORIES = {
  register_artifact: createRegisterArtifactTool,
  create_object: createCreateObjectTool,
  record_effect: createRecordEffectTool,
  create_obligation: createCreateObligationTool,
  create_trigger: createCreateTriggerTool,
  resolve_obligation: createResolveObligationTool,
  record_relationship: createRecordRelationshipTool,
  remove_relationship: createRemoveRelationshipTool,
  create_plan: createCreatePlanAction,
  write_plan_overview: createWritePlanOverviewAction,
  add_plan_phase: createAddPlanPhaseAction,
  add_plan_checkpoint: createAddPlanCheckpointAction
};

function pickSharedParams(params) {
  const shared = {};
  if (params?.callerRuntimeRef != null) shared.callerRuntimeRef = params.callerRuntimeRef;
  if (params?.boardId != null) shared.boardId = params.boardId;
  return shared;
}

function normalizeInput(input) {
  if (input == null) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("input must be an object");
  return input;
}

function getFactory(action) {
  const factory = MUTATE_TOOL_FACTORIES[action];
  if (factory == null) {
    throw createValidationError(`unsupported parley_mutate action: ${action}`, {
      code: "INVALID_PARLEY_MUTATE_ACTION",
      validValues: MUTATE_ACTIONS,
      describeTopic: "mutate"
    });
  }
  return factory;
}

function assertDelegatedParams(tool, params) {
  if (tool.parameters?.additionalProperties !== false) return;
  const allowed = new Set(Object.keys(tool.parameters?.properties ?? {}));
  for (const key of Object.keys(params)) {
    if (!allowed.has(key)) throw new Error(`${tool.name} does not accept parameter: ${key}`);
  }
}

export function createMutateTool(api) {
  return {
    name: "parley_mutate",
    label: "Parley Mutate",
    description: "Stable write façade over proven Parley v2/dev mutation verbs.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId", "action"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Required board id for this board-scoped operation. Call parley_my_boards to discover accessible boards and default_board." },
        action: {
          type: "string",
          description: "Write action. Supported now: register_artifact, create_object, record_effect, create_obligation, create_trigger, resolve_obligation, record_relationship, remove_relationship, create_plan, write_plan_overview, add_plan_phase, add_plan_checkpoint."
        },
        input: {
          type: "object",
          description: "Action-specific input matching the corresponding explicit v2/dev tool parameters. Top-level callerRuntimeRef and boardId are propagated when omitted.",
          additionalProperties: true
        }
      }
    },
    async execute(toolCallId, params) {
      const factory = getFactory(params?.action);
      const delegatedTool = factory(api);
      const delegatedParams = {
        ...pickSharedParams(params),
        ...normalizeInput(params?.input)
      };
      assertDelegatedParams(delegatedTool, delegatedParams);
      const delegated = await delegatedTool.execute(toolCallId, delegatedParams);

      return boardResult({
        tool: "parley_mutate",
        action: params.action,
        result: delegated.details
      });
    }
  };
}
