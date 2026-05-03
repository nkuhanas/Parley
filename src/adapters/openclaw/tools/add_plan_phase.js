import { loadPlanOrThrow, saveAndExportPlan, withAddedPhase } from "./plan_common.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

export function createAddPlanPhaseAction(api) {
  return {
    name: "parley_add_plan_phase",
    label: "Parley Add Plan Phase",
    description: "Add one structured phase to a tracked Parley plan and return updated setup guidance.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId", "planId", "title", "owner", "status"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string" },
        planId: { type: "string" },
        phaseId: { type: "string" },
        title: { type: "string" },
        owner: { type: "string" },
        status: { type: "string" },
        trigger: { type: "string" },
        entryCriteria: { type: "array", items: { type: "string" } },
        work: { type: "array", items: { type: "string" } },
        exitCriteria: { type: "array", items: { type: "string" } },
        activationConditions: { type: "array", items: { type: "string" } },
        reviewTrigger: { type: "array", items: { type: "string" } },
        deferralReason: { type: "array", items: { type: "string" } },
        nonGoalsBeforeActivation: { type: "array", items: { type: "string" } },
        supportingAgents: { type: "array", items: { type: "string" } }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const plan = await loadPlanOrThrow(api, identity, params.planId ?? params.plan_id);
      const nextPlan = withAddedPhase(plan, params, identity.board);
      const addedPhase = nextPlan.phases[nextPlan.phases.length - 1];
      const result = await saveAndExportPlan(api, identity, nextPlan);
      return boardResult({
        tool: "parley_add_plan_phase",
        identity,
        plan: { plan_id: result.plan.plan_id, path: result.plan.landing.resolved_path, uri: result.plan.landing.uri, projection_validation: result.validation },
        accepted: { phase: addedPhase },
        artifact: result.artifact,
        setupState: result.setupState
      });
    }
  };
}
