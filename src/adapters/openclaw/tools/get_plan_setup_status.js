import { getPlanSetupStatus } from "../../../service/index.js";
import { boardResult, callerRuntimeRefParameter } from "./v2_common.js";
import { serviceRequestFromTool } from "./service_request.js";

export function createGetPlanSetupStatusAction(api) {
  return {
    name: "parley_get_plan_setup_status",
    label: "Parley Get Plan Setup Status",
    description: "Return state-derived completion status and next-action guidance for a tracked Parley plan.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId", "planId"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string" },
        planId: { type: "string" }
      }
    },
    async execute(_toolCallId, params) {
      const response = await getPlanSetupStatus(serviceRequestFromTool(api, params, params), { pluginConfig: api.pluginConfig });
      return boardResult({
        tool: "parley_get_plan_setup_status",
        identity: response.data.identity,
        plan: response.data.plan,
        setupState: response.data.setupState
      });
    }
  };
}
