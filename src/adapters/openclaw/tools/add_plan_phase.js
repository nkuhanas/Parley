import { loadPlanOrThrow, maybeGateForObligation, saveAndExportPlan, withAddedPhase, withPlanMutationLock } from "./plan_common.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

export function createAddPlanPhaseAction(api) {
  return {
    name: "parley_add_plan_phase",
    label: "Parley Add Plan Phase",
    description: "Add one structured phase to a tracked Parley plan. Human gates are phases with kind human_checkpoint or human_approval_gate and owner as shepherd.",
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
        kind: { type: "string", description: "Phase kind, e.g. implementation, human_checkpoint, or human_approval_gate." },
        owner: { type: "string", description: "Board-local phase owner. For human gates this is the shepherd." },
        status: { type: "string", description: "Phase status. Human gates support deferred, blocked, and failed for non-passing outcomes." },
        trigger: { type: "string" },
        requiredFrom: { type: "string", description: "Human or party required for human gate review/approval." },
        requestedDecision: { type: "string" },
        dueAt: { type: "string" },
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
      const planId = params.planId ?? params.plan_id;
      return await withPlanMutationLock(api, identity, planId, async () => {
        const plan = await loadPlanOrThrow(api, identity, planId);
        const nextPlan = withAddedPhase(plan, params, identity.board);
        const addedPhase = nextPlan.phases[nextPlan.phases.length - 1];
        const result = await saveAndExportPlan(api, identity, nextPlan, { checkpointForObligation: maybeGateForObligation(addedPhase) });
        return boardResult({
          tool: "parley_add_plan_phase",
          identity,
          plan: { plan_id: result.plan.plan_id, path: result.plan.landing.resolved_path, uri: result.plan.landing.uri, projection_validation: result.validation },
          projection: result.projection,
          accepted: { phase: addedPhase },
          artifact: result.artifact,
          human_checkpoints: {
            created_obligations: result.createdCheckpointObligation == null ? [] : [result.createdCheckpointObligation]
          },
          setupState: result.setupState,
          plan_lifecycle: { obligations: result.lifecycleObligations ?? [] }
        });
      });
    }
  };
}
