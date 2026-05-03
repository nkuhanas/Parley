import { createObligationResolvedEvent, evaluateBoundObligationResolvedTriggers } from "../../../core/board/trigger_engine.js";
import { createEffectRecord, loadObligationRecord, loadPlanSetupRecord, saveEffectRecord, saveObligationRecord, savePlanSetupRecord } from "../../../core/storage/board_store.js";
import { nowIso } from "../../../core/time.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

export function createResolveObligationTool(api) {
  return {
    name: "parley_resolve_obligation",
    label: "Parley Resolve Obligation",
    description: "Resolve a board-scoped obligation, emit an obligation_resolved effect, and evaluate obligation-bound trigger side effects.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId", "obligationId", "resolution"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Required board id for this board-scoped operation." },
        obligationId: { type: "string" },
        resolution: { type: "string", description: "completed, failed, blocked, rejected, superseded, or cancelled." },
        note: { type: "string", description: "Optional resolution note." },
        subjectRef: { type: "object", additionalProperties: true, description: "Optional explicit subject ref for trigger condition checks. Defaults from obligation target." },
        triggerIds: { type: "array", items: { type: "string" }, description: "Rare override for trigger ids to evaluate. Defaults to the obligation's on_resolve_trigger_ids." }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const existing = await loadObligationRecord(api.pluginConfig, identity.board, params?.obligationId);
      if (existing == null) throw new Error(`obligation not found: ${params?.obligationId}`);
      if (existing.managedBinding?.system === "plan_lifecycle" && existing.managedBinding.role !== "phase_work") {
        throw new Error(`plan lifecycle ${existing.managedBinding.role} obligations must be resolved through the explicit lifecycle command`);
      }
      if (existing.status === "resolved") throw new Error(`obligation already resolved: ${existing.obligation_id}`);

      const resolvedAt = nowIso();
      const resolved = {
        ...existing,
        status: "resolved",
        resolution: params?.resolution,
        resolution_note: params?.note ?? null,
        resolved_at: resolvedAt,
        updated_at: resolvedAt
      };
      const savedObligation = await saveObligationRecord(api.pluginConfig, identity.board, resolved);
      if (savedObligation.managedBinding?.system === "plan_lifecycle" && savedObligation.managedBinding.role === "phase_work") {
        const plan = await loadPlanSetupRecord(api.pluginConfig, identity.board, savedObligation.managedBinding.plan_id);
        if (plan != null && (plan.managed?.activeLifecycleObligationIds ?? []).includes(savedObligation.obligation_id)) {
          await savePlanSetupRecord(api.pluginConfig, identity.board, {
            ...plan,
            managed: {
              ...plan.managed,
              activeLifecycleObligationIds: plan.managed.activeLifecycleObligationIds.filter((id) => id !== savedObligation.obligation_id),
              lifecycle_updated_at: resolvedAt
            },
            updated_at: resolvedAt
          });
        }
      }
      const resolvedEffect = createEffectRecord({
        board_id: identity.board_id,
        type: "obligation_resolved",
        actor: identity.actor,
        target: compactObject({
          obligation_id: savedObligation.obligation_id,
          plan_id: savedObligation.target?.plan_id,
          phase_id: savedObligation.target?.phase_id,
          checkpoint_id: savedObligation.target?.checkpoint_id,
          artifact_id: savedObligation.target?.artifact_id,
          artifact_version: savedObligation.target?.artifact_version
        }),
        payload: {
          resolution: savedObligation.resolution,
          note: savedObligation.resolution_note,
          template_id: savedObligation.template_id,
          evaluated_trigger_ids: params?.triggerIds ?? savedObligation.on_resolve_trigger_ids ?? []
        }
      });
      const savedEffect = await saveEffectRecord(api.pluginConfig, identity.board, resolvedEffect);

      const event = createObligationResolvedEvent(savedObligation, savedObligation.resolution, {
        subject_ref: params?.subjectRef,
        trigger_ids: params?.triggerIds,
        resolved_effect: savedEffect
      });
      const sideEffects = await evaluateBoundObligationResolvedTriggers(api.pluginConfig, identity.board, identity, event);

      return boardResult({
        tool: "parley_resolve_obligation",
        identity,
        obligation: savedObligation,
        effect: savedEffect,
        trigger_evaluation: {
          mode: "obligation_bound",
          evaluated_trigger_ids: event.trigger_ids,
          fired_count: sideEffects.fired.length,
          skipped_count: sideEffects.skipped.length
        },
        fired_triggers: sideEffects.fired,
        skipped_triggers: sideEffects.skipped,
        created_obligations: sideEffects.fired.map((item) => item.action_result.created_obligation).filter(Boolean),
        created_effects: [
          ...sideEffects.fired.map((item) => item.action_result.created_effect).filter(Boolean),
          ...sideEffects.fired.map((item) => item.trigger_fired_effect).filter(Boolean),
          ...sideEffects.skipped.map((item) => item.trigger_fired_effect).filter(Boolean)
        ],
        next_expected_actions: sideEffects.fired
          .map((item) => item.action_result.created_obligation)
          .filter(Boolean)
          .map((obligation) => ({ actor: obligation.agent, obligation_id: obligation.obligation_id, type: obligation.type, target: obligation.target }))
      });
    }
  };
}
