import { mutate } from "../../../service/index.js";
import { boardResult, callerRuntimeRefParameter } from "./v2_common.js";
import { serviceRequestFromTool } from "./service_request.js";

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
          description: "Write action. Supported now: register_artifact, create_object, record_effect, create_obligation, create_trigger, resolve_obligation, record_relationship, remove_relationship, create_plan, write_plan_overview, add_plan_phase, add_plan_checkpoint, request_plan_review, replace_plan_review_routing, cancel_plan_review, mark_plan_ready, record_review_decision, record_human_review_attestation, activate_plan, pause_plan, resume_plan, record_hitl_input, record_phase_outcome, record_plan_disposition."
        },
        input: {
          type: "object",
          description: "Action-specific input matching the corresponding explicit v2/dev tool parameters. Top-level callerRuntimeRef and boardId are propagated when omitted.",
          additionalProperties: true
        }
      }
    },
    async execute(_toolCallId, params) {
      const response = await mutate(serviceRequestFromTool(api, params, params), { pluginConfig: api.pluginConfig });

      return boardResult({
        tool: "parley_mutate",
        action: params.action,
        result: response.data
      });
    }
  };
}
