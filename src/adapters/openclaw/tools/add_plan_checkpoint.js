import { loadPlanOrThrow, saveAndExportPlan, withAddedCheckpoint } from "./plan_common.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

export function createAddPlanCheckpointAction(api) {
  return {
    name: "parley_add_plan_checkpoint",
    label: "Parley Add Plan Checkpoint",
    description: "Add one human/agent checkpoint to a tracked Parley plan and create the shepherd obligation when pending.",
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
        kind: { type: "string" },
        requiredFrom: { type: "string" },
        shepherd: { type: "string" },
        trigger: { type: "string" },
        status: { type: "string" },
        requestedDecision: { type: "string" },
        dueAt: { type: "string" },
        relatedPhaseId: { type: "string" }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const plan = await loadPlanOrThrow(api, identity, params.planId ?? params.plan_id);
      const { plan: nextPlan, checkpoint } = withAddedCheckpoint(plan, params, identity.board);
      const result = await saveAndExportPlan(api, identity, nextPlan, { checkpointForObligation: checkpoint });
      return boardResult({
        tool: "parley_add_plan_checkpoint",
        identity,
        plan: { plan_id: result.plan.plan_id, path: result.plan.landing.resolved_path, uri: result.plan.landing.uri, projection_validation: result.validation },
        accepted: { checkpoint },
        artifact: result.artifact,
        human_checkpoints: {
          created_obligations: result.createdCheckpointObligation == null ? [] : [result.createdCheckpointObligation]
        },
        setupState: result.setupState
      });
    }
  };
}
