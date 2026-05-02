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
import { createWhereAmITool } from "./tools/where_am_i.js";
import { createMyBoardsTool } from "./tools/my_boards.js";
import { createBoardProjectionTool } from "./tools/board_projection.js";
import { createRecordRelationshipTool } from "./tools/record_relationship.js";
import { createRemoveRelationshipTool } from "./tools/remove_relationship.js";
import { createCheckpointProjectionTool } from "./tools/checkpoint_projection.js";
import { createValidateStateAction } from "./tools/validate_state.js";
import { createQueryTool } from "./tools/query.js";
import { createMutateTool } from "./tools/mutate.js";

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
  api.registerTool(withRuntimeContext(api, createMyBoardsTool));
  api.registerTool(withRuntimeContext(api, createBoardProjectionTool));
  api.registerTool(withRuntimeContext(api, createRecordRelationshipTool));
  api.registerTool(withRuntimeContext(api, createRemoveRelationshipTool));
  api.registerTool(withRuntimeContext(api, createCheckpointProjectionTool));
  api.registerTool(withRuntimeContext(api, createValidateStateAction));
  api.registerTool(withRuntimeContext(api, createQueryTool));
  api.registerTool(withRuntimeContext(api, createMutateTool));
}
