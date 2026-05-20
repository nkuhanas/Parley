import { withOpenClawRuntimeConfig, wrapOpenClawToolForRuntime } from "./runtime_client.js";
import { createOpenThreadTool } from "./tools/open_thread.js";
import { createProbeThreadTool } from "./tools/probe.js";
import { createClaimTurnTool } from "./tools/claim_turn.js";
import { createReplyThreadTool } from "./tools/reply.js";
import { createSettleTurnTool } from "./tools/settle_turn.js";
import { createConcludeThreadTool } from "./tools/conclude_thread.js";
import { createRecordTransportResultTool } from "./tools/record_transport_result.js";
import { createDispatchTransportRequestTool } from "./tools/dispatch_transport_request.js";
import { createRecordHumanSummaryAnchorTool } from "./tools/record_human_summary_anchor.js";
import { createRegisterArtifactTool } from "./tools/register_artifact.js";
import { createCreateObjectTool } from "./tools/create_object.js";
import { createRecordEffectTool } from "./tools/record_effect.js";
import { createCreateObligationTool } from "./tools/create_obligation.js";
import { createCreateTriggerTool } from "./tools/create_trigger.js";
import { createResolveObligationTool } from "./tools/resolve_obligation.js";
import { createWhereAmITool } from "./tools/where_am_i.js";
import { createMyBoardsTool } from "./tools/my_boards.js";
import { createBoardProjectionTool } from "./tools/board_projection.js";
import { createRecordRelationshipTool } from "./tools/record_relationship.js";
import { createRemoveRelationshipTool } from "./tools/remove_relationship.js";
import { createCheckpointProjectionTool } from "./tools/checkpoint_projection.js";
import { createValidatePlanAction } from "./tools/validate_plan.js";
import { createValidateStateAction } from "./tools/validate_state.js";
import { createCreatePlanAction } from "./tools/create_plan.js";
import { createWritePlanOverviewAction } from "./tools/write_plan_overview.js";
import { createAddPlanPhaseAction } from "./tools/add_plan_phase.js";
import { createAddPlanCheckpointAction } from "./tools/add_plan_checkpoint.js";
import { createGetPlanSetupStatusAction } from "./tools/get_plan_setup_status.js";
import { createGetPlanStatusAction } from "./tools/get_plan_status.js";
import { createReadPlanProjectionAction } from "./tools/read_plan_projection.js";
import { createActivatePlanAction, createMarkPlanReadyAction, createPausePlanAction, createRecordHitlInputAction, createRecordPhaseOutcomeAction, createRecordPlanDispositionAction, createRecordReviewDecisionAction, createRequestPlanReviewAction, createResumePlanAction } from "./tools/plan_lifecycle.js";
import { createRuntimeObligationsQueryAction, createBoardObligationsQueryAction } from "./tools/obligations.js";
import { createNamespaceSearchAction } from "./tools/namespace_search.js";
import { createQueryTool } from "./tools/query.js";
import { createMutateTool } from "./tools/mutate.js";
import { createDescribeTool } from "./tools/describe.js";

function createRuntimeTool(api, createTool) {
  const tool = createTool(api);
  return wrapOpenClawToolForRuntime(api, tool);
}

function withRuntimeContext(api, createTool) {
  return (toolContext) => createRuntimeTool({ ...api, toolContext }, createTool);
}

function registerRuntimeContextTool(api, createTool) {
  const toolName = createRuntimeTool(api, createTool).name;
  api.registerTool(withRuntimeContext(api, createTool), { name: toolName });
}

export function registerParleyTools(api) {
  const runtimeApi = withOpenClawRuntimeConfig(api);
  registerRuntimeContextTool(runtimeApi, createDescribeTool);
  runtimeApi.registerTool(createRuntimeTool(runtimeApi, createOpenThreadTool));
  runtimeApi.registerTool(createRuntimeTool(runtimeApi, createClaimTurnTool));
  runtimeApi.registerTool(createRuntimeTool(runtimeApi, createReplyThreadTool));
  runtimeApi.registerTool(createRuntimeTool(runtimeApi, createProbeThreadTool));
  runtimeApi.registerTool(createRuntimeTool(runtimeApi, createSettleTurnTool));
  runtimeApi.registerTool(createRuntimeTool(runtimeApi, createConcludeThreadTool));
  runtimeApi.registerTool(createRuntimeTool(runtimeApi, createRecordTransportResultTool));
  runtimeApi.registerTool(createRuntimeTool(runtimeApi, createDispatchTransportRequestTool));
  runtimeApi.registerTool(createRuntimeTool(runtimeApi, createRecordHumanSummaryAnchorTool));
  registerRuntimeContextTool(runtimeApi, createRegisterArtifactTool);
  registerRuntimeContextTool(runtimeApi, createCreateObjectTool);
  registerRuntimeContextTool(runtimeApi, createRecordEffectTool);
  registerRuntimeContextTool(runtimeApi, createCreateObligationTool);
  registerRuntimeContextTool(runtimeApi, createCreateTriggerTool);
  registerRuntimeContextTool(runtimeApi, createResolveObligationTool);
  registerRuntimeContextTool(runtimeApi, createWhereAmITool);
  registerRuntimeContextTool(runtimeApi, createMyBoardsTool);
  registerRuntimeContextTool(runtimeApi, createBoardProjectionTool);
  registerRuntimeContextTool(runtimeApi, createRecordRelationshipTool);
  registerRuntimeContextTool(runtimeApi, createRemoveRelationshipTool);
  registerRuntimeContextTool(runtimeApi, createCheckpointProjectionTool);
  registerRuntimeContextTool(runtimeApi, createValidatePlanAction);
  registerRuntimeContextTool(runtimeApi, createValidateStateAction);
  registerRuntimeContextTool(runtimeApi, createCreatePlanAction);
  registerRuntimeContextTool(runtimeApi, createWritePlanOverviewAction);
  registerRuntimeContextTool(runtimeApi, createAddPlanPhaseAction);
  registerRuntimeContextTool(runtimeApi, createAddPlanCheckpointAction);
  registerRuntimeContextTool(runtimeApi, createGetPlanSetupStatusAction);
  registerRuntimeContextTool(runtimeApi, createGetPlanStatusAction);
  registerRuntimeContextTool(runtimeApi, createReadPlanProjectionAction);
  registerRuntimeContextTool(runtimeApi, createRequestPlanReviewAction);
  registerRuntimeContextTool(runtimeApi, createMarkPlanReadyAction);
  registerRuntimeContextTool(runtimeApi, createRecordReviewDecisionAction);
  registerRuntimeContextTool(runtimeApi, createActivatePlanAction);
  registerRuntimeContextTool(runtimeApi, createPausePlanAction);
  registerRuntimeContextTool(runtimeApi, createResumePlanAction);
  registerRuntimeContextTool(runtimeApi, createRecordPlanDispositionAction);
  registerRuntimeContextTool(runtimeApi, createRecordHitlInputAction);
  registerRuntimeContextTool(runtimeApi, createRecordPhaseOutcomeAction);
  registerRuntimeContextTool(runtimeApi, createRuntimeObligationsQueryAction);
  registerRuntimeContextTool(runtimeApi, createBoardObligationsQueryAction);
  registerRuntimeContextTool(runtimeApi, createNamespaceSearchAction);
  registerRuntimeContextTool(runtimeApi, createQueryTool);
  registerRuntimeContextTool(runtimeApi, createMutateTool);
}
