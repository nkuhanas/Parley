import { explicitPlanStatus } from "./plan_status_common.js";
import { loadPlanOrThrow } from "./plan_common.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

export function createGetPlanStatusAction(api) {
  return {
    name: "parley_get_plan_status",
    label: "Parley Get Plan Status",
    description: "Return compact explicit lifecycle status for a tracked Parley plan, including current phase and HITL gate readiness.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId", "planId"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Board id for the plan." },
        planId: { type: "string", description: "Tracked plan id whose explicit lifecycle status should be read." }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const plan = await loadPlanOrThrow(api, identity, params.planId ?? params.plan_id);
      return boardResult({
        tool: "parley_get_plan_status",
        identity,
        ...(await explicitPlanStatus(api, identity, plan))
      });
    }
  };
}
