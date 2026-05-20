import { loadPlanOrThrow, saveAndExportPlan, withAddedCheckpoint, withPlanMutationLock } from "./plan_common.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

export function createAddPlanCheckpointAction(api) {
  return {
    name: "parley_add_plan_checkpoint",
    label: "Parley Add Plan Checkpoint",
    description: "Compatibility helper that adds a human_checkpoint or human_approval_gate phase to a tracked Parley plan. Owner is the shepherd.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId", "planId", "title", "requiredFrom"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string" },
        planId: { type: "string" },
        checkpointId: { type: "string" },
        title: { type: "string" },
        kind: { type: "string", description: "Gate phase kind. Use human_checkpoint or human_approval_gate." },
        requiredFrom: { type: "string" },
        shepherd: { type: "string", description: "Board-local shepherd; stored as phase owner." },
        trigger: { type: "string" },
        status: { type: "string" },
        requestedDecision: { type: "string" },
        dueAt: { type: "string" },
        relatedPhaseId: { type: "string" }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const planId = params.planId ?? params.plan_id;
      return await withPlanMutationLock(api, identity, planId, async () => {
        const plan = await loadPlanOrThrow(api, identity, planId);
        const { plan: nextPlan, checkpoint } = withAddedCheckpoint(plan, params, identity.board);
        const result = await saveAndExportPlan(api, identity, nextPlan, { checkpointForObligation: checkpoint });
        return boardResult({
          tool: "parley_add_plan_checkpoint",
          identity,
          plan: { plan_id: result.plan.plan_id, path: result.plan.landing.resolved_path, uri: result.plan.landing.uri, projection_validation: result.validation },
          projection: result.projection,
          accepted: { phase: checkpoint, checkpoint },
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
