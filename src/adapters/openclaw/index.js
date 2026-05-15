import { resolveParleyRuntimeConfig } from "../../core/config.js";
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
import { createActivatePlanAction, createMarkPlanReadyAction, createPausePlanAction, createRecordPhaseOutcomeAction, createRecordPlanDispositionAction, createRecordReviewDecisionAction, createRequestPlanReviewAction, createResumePlanAction } from "./tools/plan_lifecycle.js";
import { createRuntimeObligationsQueryAction, createBoardObligationsQueryAction } from "./tools/obligations.js";
import { createNamespaceSearchAction } from "./tools/namespace_search.js";
import { createQueryTool } from "./tools/query.js";
import { createMutateTool } from "./tools/mutate.js";
import { createDescribeTool } from "./tools/describe.js";

function withRuntimeContext(api, createTool) {
  return (toolContext) => createTool({ ...api, toolContext });
}

function withOpenClawRuntimeConfig(api) {
  const runtimeConfig = resolveParleyRuntimeConfig({
    surface: "openclaw-adapter",
    pluginConfig: api.pluginConfig ?? {},
    env: api.env ?? process.env
  });
  return {
    ...api,
    pluginConfig: {
      ...(api.pluginConfig ?? {}),
      __parleySurface: "openclaw-adapter",
      __parleyRuntimeConfig: runtimeConfig
    }
  };
}

export function registerParleyTools(api) {
  const runtimeApi = withOpenClawRuntimeConfig(api);
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createDescribeTool));
  runtimeApi.registerTool(createOpenThreadTool(runtimeApi));
  runtimeApi.registerTool(createClaimTurnTool(runtimeApi));
  runtimeApi.registerTool(createReplyThreadTool(runtimeApi));
  runtimeApi.registerTool(createProbeThreadTool(runtimeApi));
  runtimeApi.registerTool(createSettleTurnTool(runtimeApi));
  runtimeApi.registerTool(createConcludeThreadTool(runtimeApi));
  runtimeApi.registerTool(createRecordTransportResultTool(runtimeApi));
  runtimeApi.registerTool(createDispatchTransportRequestTool(runtimeApi));
  runtimeApi.registerTool(createRecordHumanSummaryAnchorTool(runtimeApi));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createRegisterArtifactTool));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createCreateObjectTool));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createRecordEffectTool));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createCreateObligationTool));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createCreateTriggerTool));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createResolveObligationTool));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createWhereAmITool));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createMyBoardsTool));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createBoardProjectionTool));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createRecordRelationshipTool));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createRemoveRelationshipTool));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createCheckpointProjectionTool));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createValidatePlanAction));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createValidateStateAction));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createCreatePlanAction));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createWritePlanOverviewAction));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createAddPlanPhaseAction));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createAddPlanCheckpointAction));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createGetPlanSetupStatusAction));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createRequestPlanReviewAction));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createMarkPlanReadyAction));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createRecordReviewDecisionAction));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createActivatePlanAction));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createPausePlanAction));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createResumePlanAction));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createRecordPlanDispositionAction));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createRecordPhaseOutcomeAction));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createRuntimeObligationsQueryAction));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createBoardObligationsQueryAction));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createNamespaceSearchAction));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createQueryTool));
  runtimeApi.registerTool(withRuntimeContext(runtimeApi, createMutateTool));
}
