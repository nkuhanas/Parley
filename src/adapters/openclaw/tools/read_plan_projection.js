import { renderPlanSetupMarkdown } from "../../../core/plan/plan_state.js";
import { planProjectionPayload } from "../../../core/plan/projection.js";
import { validateParleyPlanV1Document } from "../../../core/schema/index.js";
import { loadPlanOrThrow } from "./plan_common.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

function planSummary(plan, validation) {
  return {
    plan_id: plan.plan_id,
    title: plan.title,
    status: plan.status,
    version: plan.version,
    owner: plan.owner,
    path: plan.landing?.resolved_path,
    uri: plan.landing?.uri,
    projection_validation: validation
  };
}

export function createReadPlanProjectionAction(api) {
  return {
    name: "parley_read_plan_projection",
    label: "Parley Read Plan Projection",
    description: "Read the service-rendered Markdown projection for a tracked Parley plan.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId", "planId"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Board id for the plan." },
        planId: { type: "string", description: "Tracked plan id whose rendered Markdown projection should be read." }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const planId = params.planId ?? params.plan_id;
      const plan = await loadPlanOrThrow(api, identity, planId);
      const markdown = renderPlanSetupMarkdown(plan);
      const validation = validateParleyPlanV1Document(markdown);
      const projection = planProjectionPayload({ plan, markdown });
      return boardResult({
        tool: "parley_read_plan_projection",
        identity,
        plan: planSummary(plan, validation),
        projection
      });
    }
  };
}
