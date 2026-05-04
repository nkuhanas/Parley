import { loadPlanOrThrow, saveAndExportPlan, withOverview, withPlanMutationLock } from "./plan_common.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

export function createWritePlanOverviewAction(api) {
  return {
    name: "parley_write_plan_overview",
    label: "Parley Write Plan Overview",
    description: "Write or replace the structured overview band for a tracked Parley plan.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId", "planId", "purpose"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string" },
        planId: { type: "string" },
        purpose: { type: "string" },
        background: { type: "string" },
        scopeSummary: { type: "string" },
        inScope: { type: "array", items: { type: "string" } },
        outOfScope: { type: "array", items: { type: "string" } },
        currentState: { type: "string" },
        targetState: { type: "string" },
        approach: { type: "string" },
        assumptions: { type: "array", items: { type: "string" } },
        nonGoals: { type: "array", items: { type: "string" } },
        openQuestions: { type: "array", items: { type: "string" } },
        acceptanceCriteria: { type: "array", items: { type: "string" } },
        risksAndConstraints: { type: "array", items: { type: "string" } }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const planId = params.planId ?? params.plan_id;
      return await withPlanMutationLock(api, identity, planId, async () => {
        const plan = await loadPlanOrThrow(api, identity, planId);
        const result = await saveAndExportPlan(api, identity, withOverview(plan, params));
        return boardResult({
          tool: "parley_write_plan_overview",
          identity,
          plan: { plan_id: result.plan.plan_id, path: result.plan.landing.resolved_path, uri: result.plan.landing.uri, projection_validation: result.validation },
          accepted: { overview: true },
          artifact: result.artifact,
          setupState: result.setupState,
          plan_lifecycle: { obligations: result.lifecycleObligations ?? [] }
        });
      });
    }
  };
}
