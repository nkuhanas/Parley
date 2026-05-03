import { loadPlanOrThrow } from "./plan_common.js";
import { derivePlanSetupState } from "../../../core/plan/plan_state.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

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
      const identity = resolveToolCaller(api, params);
      const plan = await loadPlanOrThrow(api, identity, params.planId ?? params.plan_id);
      return boardResult({
        tool: "parley_get_plan_setup_status",
        identity,
        plan: {
          plan_id: plan.plan_id,
          title: plan.title,
          status: plan.status,
          phase_count: plan.phases.length,
          checkpoint_count: plan.human_checkpoints.length,
          generatedMarkdownPath: plan.landing.resolved_path,
          generatedMarkdownUri: plan.landing.uri
        },
        setupState: derivePlanSetupState(plan, identity.board)
      });
    }
  };
}
