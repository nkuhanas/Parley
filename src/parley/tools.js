import { createOpenThreadTool } from "./actions/open_thread.js";
import { createProbeThreadTool } from "./actions/probe.js";
import { createClaimTurnTool } from "./actions/claim_turn.js";
import { createReplyThreadTool } from "./actions/reply.js";
import { createSettleTurnTool } from "./actions/settle_turn.js";
import { createConcludeThreadTool } from "./actions/conclude_thread.js";
import { createRecordTransportResultTool } from "./actions/record_transport_result.js";
import { createDispatchTransportRequestTool } from "./actions/dispatch_transport_request.js";
import { createRecordHumanSummaryAnchorTool } from "./actions/record_human_summary_anchor.js";
import { createRegisterArtifactTool } from "./actions/register_artifact.js";
import { createCreateObjectTool } from "./actions/create_object.js";
import { createRecordEffectTool } from "./actions/record_effect.js";
import { createCreateObligationTool } from "./actions/create_obligation.js";
import { createWhereAmITool } from "./actions/where_am_i.js";
import { createBoardProjectionTool } from "./actions/board_projection.js";
import { createRecordRelationshipTool } from "./actions/record_relationship.js";
import { createRemoveRelationshipTool } from "./actions/remove_relationship.js";
import { createCheckpointProjectionTool } from "./actions/checkpoint_projection.js";
import { createValidateStateAction } from "./actions/validate_state.js";
import { createQueryTool } from "./actions/query.js";
import { createMutateTool } from "./actions/mutate.js";

function withRuntimeContext(api, createTool) {
  return (toolContext) => createTool({ ...api, toolContext });
}

export function registerParleyTools(api) {
  api.registerTool(createOpenThreadTool(api));
  api.registerTool(createClaimTurnTool(api));
  api.registerTool(createReplyThreadTool(api));
  api.registerTool(createProbeThreadTool(api));
  api.registerTool(createSettleTurnTool(api));
  api.registerTool(createConcludeThreadTool(api));
  api.registerTool(createRecordTransportResultTool(api));
  api.registerTool(createDispatchTransportRequestTool(api));
  api.registerTool(createRecordHumanSummaryAnchorTool(api));
  api.registerTool(withRuntimeContext(api, createRegisterArtifactTool));
  api.registerTool(withRuntimeContext(api, createCreateObjectTool));
  api.registerTool(withRuntimeContext(api, createRecordEffectTool));
  api.registerTool(withRuntimeContext(api, createCreateObligationTool));
  api.registerTool(withRuntimeContext(api, createWhereAmITool));
  api.registerTool(withRuntimeContext(api, createBoardProjectionTool));
  api.registerTool(withRuntimeContext(api, createRecordRelationshipTool));
  api.registerTool(withRuntimeContext(api, createRemoveRelationshipTool));
  api.registerTool(withRuntimeContext(api, createCheckpointProjectionTool));
  api.registerTool(withRuntimeContext(api, createValidateStateAction));
  api.registerTool(withRuntimeContext(api, createQueryTool));
  api.registerTool(withRuntimeContext(api, createMutateTool));
}
