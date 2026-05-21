import { createCreateObjectTool } from "../../adapters/openclaw/tools/create_object.js";
import { createCreateObligationTool } from "../../adapters/openclaw/tools/create_obligation.js";
import { createCreateTriggerTool } from "../../adapters/openclaw/tools/create_trigger.js";
import { createResolveObligationTool } from "../../adapters/openclaw/tools/resolve_obligation.js";
import { createCreatePlanAction } from "../../adapters/openclaw/tools/create_plan.js";
import { createWritePlanOverviewAction } from "../../adapters/openclaw/tools/write_plan_overview.js";
import { createAddPlanPhaseAction } from "../../adapters/openclaw/tools/add_plan_phase.js";
import { createAddPlanCheckpointAction } from "../../adapters/openclaw/tools/add_plan_checkpoint.js";
import {
  createActivatePlanAction,
  createCancelPlanReviewAction,
  createMarkPlanReadyAction,
  createPausePlanAction,
  createRecordHitlInputAction,
  createRecordHumanReviewAttestationAction,
  createRecordPhaseOutcomeAction,
  createRecordPlanDispositionAction,
  createRecordReviewDecisionAction,
  createReplacePlanReviewRoutingAction,
  createRequestPlanReviewAction,
  createResumePlanAction
} from "../../adapters/openclaw/tools/plan_lifecycle.js";
import { createRecordEffectTool } from "../../adapters/openclaw/tools/record_effect.js";
import { createRecordRelationshipTool } from "../../adapters/openclaw/tools/record_relationship.js";
import { createRemoveRelationshipTool } from "../../adapters/openclaw/tools/remove_relationship.js";
import { createRegisterArtifactTool } from "../../adapters/openclaw/tools/register_artifact.js";
import { createValidationError, MUTATE_ACTIONS } from "../../adapters/openclaw/tools/descriptors.js";
import { explicitBoardId, normalizeServiceRequest } from "../context.js";
import { callerRuntimeRefFromServiceCaller } from "../identity.js";
import { withParleyServiceLedgerTransaction } from "../../core/storage/sqlite_ledger.js";
import { serviceResponse } from "../responses.js";

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
  add_plan_checkpoint: createAddPlanCheckpointAction,
  request_plan_review: createRequestPlanReviewAction,
  replace_plan_review_routing: createReplacePlanReviewRoutingAction,
  cancel_plan_review: createCancelPlanReviewAction,
  mark_plan_ready: createMarkPlanReadyAction,
  record_review_decision: createRecordReviewDecisionAction,
  record_human_review_attestation: createRecordHumanReviewAttestationAction,
  activate_plan: createActivatePlanAction,
  pause_plan: createPausePlanAction,
  resume_plan: createResumePlanAction,
  record_plan_disposition: createRecordPlanDispositionAction,
  record_hitl_input: createRecordHitlInputAction,
  record_phase_outcome: createRecordPhaseOutcomeAction
};

function value(input, snakeName, camelName = snakeName) {
  return input?.[snakeName] ?? input?.[camelName];
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

function bridgeApi(deps = {}) {
  return {
    pluginConfig: deps.pluginConfig,
    toolContext: null
  };
}

export async function mutate(request = {}, deps = {}) {
  const { caller, input } = normalizeServiceRequest(request);
  const action = value(input, "action");
  const factory = getFactory(action);
  const delegatedTool = factory(bridgeApi(deps));
  const delegatedParams = {
    callerRuntimeRef: callerRuntimeRefFromServiceCaller(caller),
    boardId: explicitBoardId(input),
    ...normalizeInput(value(input, "input"))
  };
  assertDelegatedParams(delegatedTool, delegatedParams);
  const delegated = await withParleyServiceLedgerTransaction(deps.pluginConfig, () => delegatedTool.execute(null, delegatedParams));
  return serviceResponse({ data: delegated.details });
}
