import { createEffectId } from "../ids.js";
import {
  createEffectRecord,
  createObligationRecord,
  loadArtifactRecord,
  loadCoordinationObjectRecord,
  loadEffectRecord,
  loadObligationRecord,
  loadPlanSetupRecord,
  loadTriggerRecord,
  saveEffectRecord,
  saveObligationRecord
} from "../storage/board_store.js";

function actorFromIdentity(identity) {
  return {
    board_agent_id: identity.board_agent_id,
    runtime_ref: identity.runtime_ref,
    runtime_aliases: identity.runtime_aliases ?? [],
    identity_resolution: identity.identity_resolution ?? undefined
  };
}

function boardHasAgent(board, boardAgentId) {
  return (board.agent_registry ?? board.members ?? []).some((member) => member.board_agent_id === boardAgentId);
}

function deterministicFireEffectId(trigger, sourceObligationId) {
  if (trigger.fire_policy === "once") return `effect_${trigger.trigger_id}_fired`;
  return `effect_${trigger.trigger_id}_${sourceObligationId}_fired`;
}

async function deterministicFireAlreadyRecorded(pluginConfig, board, trigger, sourceObligationId) {
  if (trigger.fire_policy !== "once" && trigger.fire_policy !== "once_per_source_obligation") return false;
  return await loadEffectRecord(pluginConfig, board, deterministicFireEffectId(trigger, sourceObligationId)) != null;
}

function deriveSubjectRefFromObligation(obligation) {
  const target = obligation?.target ?? {};
  if (target.plan_id != null && target.phase_id != null) {
    return {
      kind: "plan_phase",
      plan_id: target.plan_id,
      phase_id: target.phase_id,
      artifact_id: target.artifact_id ?? undefined,
      artifact_version: target.artifact_version ?? undefined
    };
  }
  if (target.checkpoint_id != null) {
    return {
      kind: "checkpoint",
      checkpoint_id: target.checkpoint_id,
      phase_id: target.phase_id ?? target.checkpoint_id,
      plan_id: target.plan_id ?? undefined,
      artifact_id: target.artifact_id ?? undefined,
      artifact_version: target.artifact_version ?? undefined
    };
  }
  if (target.artifact_id != null) return { kind: "artifact", artifact_id: target.artifact_id, artifact_version: target.artifact_version ?? undefined };
  if (target.object_id != null) return { kind: "object", object_id: target.object_id };
  return { kind: "obligation", obligation_id: obligation.obligation_id };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function subjectMatches(expected, actual) {
  if (expected == null) return true;
  if (actual == null) return false;
  if (expected.kind !== actual.kind) return false;
  for (const key of ["id", "object_id", "artifact_id", "artifact_version", "plan_id", "phase_id", "checkpoint_id", "obligation_id", "thread_id", "message_id"]) {
    if (expected[key] != null && expected[key] !== actual[key]) return false;
  }
  return true;
}

function sourceMatches(trigger, event) {
  const source = trigger.source;
  if (source.event_type !== event.event_type) return false;
  if (source.obligation_id != null && source.obligation_id !== event.obligation.obligation_id) return false;
  if (source.obligation_template_id != null && source.obligation_template_id !== event.obligation.template_id) return false;
  if (!subjectMatches(source.subject_ref, event.subject_ref)) return false;
  return true;
}

async function subjectStatus(pluginConfig, board, subjectRef) {
  if (subjectRef == null) return null;
  if ((subjectRef.kind === "plan_phase" || subjectRef.kind === "phase") && subjectRef.plan_id != null && subjectRef.phase_id != null) {
    const plan = await loadPlanSetupRecord(pluginConfig, board, subjectRef.plan_id);
    const phase = (plan?.phases ?? []).find((candidate) => candidate.phase_id === subjectRef.phase_id);
    return phase?.status ?? null;
  }
  if (subjectRef.kind === "artifact" && subjectRef.artifact_id != null) {
    const artifact = await loadArtifactRecord(pluginConfig, board, subjectRef.artifact_id);
    return artifact?.status ?? null;
  }
  if (subjectRef.kind === "object" && subjectRef.object_id != null) {
    const object = await loadCoordinationObjectRecord(pluginConfig, board, subjectRef.object_id);
    return object?.status ?? null;
  }
  if (subjectRef.kind === "obligation" && subjectRef.obligation_id != null) {
    const obligation = await loadObligationRecord(pluginConfig, board, subjectRef.obligation_id);
    return obligation?.status ?? null;
  }
  return null;
}

async function conditionMatches(pluginConfig, board, trigger, event) {
  const condition = trigger.condition ?? {};
  if (condition.required_subject_kind != null && event.subject_ref?.kind !== condition.required_subject_kind) return false;
  if ((condition.obligation_resolution_in ?? []).length > 0 && !condition.obligation_resolution_in.includes(event.resolution)) return false;
  if ((condition.subject_status_in ?? []).length > 0) {
    const status = await subjectStatus(pluginConfig, board, event.subject_ref);
    if (!condition.subject_status_in.includes(status)) return false;
  }
  return true;
}

async function executeAction(pluginConfig, board, identity, trigger, event) {
  const actor = actorFromIdentity(identity);
  if (trigger.action.type === "create_obligation") {
    const input = trigger.action.obligation;
    if (!boardHasAgent(board, input.agent)) throw new Error(`trigger action references unknown board agent: ${input.agent}`);
    const obligation = createObligationRecord({
      board_id: board.board_id,
      obligation_id: input.obligation_id ?? undefined,
      template_id: input.template_id ?? null,
      agent: input.agent,
      type: input.type,
      status: input.status ?? "active",
      target: input.target,
      scope: input.scope,
      reason: input.reason,
      on_resolve_trigger_ids: input.on_resolve_trigger_ids ?? [],
      source_effect_id: event.resolved_effect?.effect_id ?? null
    });
    const saved = await saveObligationRecord(pluginConfig, board, obligation);
    return { action_type: "create_obligation", created_obligation: saved };
  }

  const effectInput = trigger.action.effect;
  const effect = createEffectRecord({
    board_id: board.board_id,
    effect_id: effectInput.effect_id ?? createEffectId(),
    type: effectInput.type,
    actor,
    target: effectInput.target,
    payload: effectInput.payload
  });
  const saved = await saveEffectRecord(pluginConfig, board, effect);
  return { action_type: "record_effect", created_effect: saved };
}

async function recordTriggerFired(pluginConfig, board, identity, trigger, event, actionResult, { skipped = false, reason = null } = {}) {
  const deterministic = trigger.fire_policy === "once" || trigger.fire_policy === "once_per_source_obligation";
  const effectId = deterministic ? deterministicFireEffectId(trigger, event.obligation.obligation_id) : createEffectId();
  if (deterministic && await loadEffectRecord(pluginConfig, board, effectId) != null) {
    return { duplicate: true, effect: null };
  }
  const effect = createEffectRecord({
    board_id: board.board_id,
    effect_id: effectId,
    type: "trigger_fired",
    actor: actorFromIdentity(identity),
    target: compactObject({
      trigger_id: trigger.trigger_id,
      obligation_id: event.obligation.obligation_id,
      plan_id: event.subject_ref?.plan_id,
      phase_id: event.subject_ref?.phase_id,
      artifact_id: event.subject_ref?.artifact_id,
      artifact_version: event.subject_ref?.artifact_version
    }),
    payload: compactObject({
      trigger_id: trigger.trigger_id,
      source_event_type: event.event_type,
      source_obligation_id: event.obligation.obligation_id,
      action_type: trigger.action.type,
      created_obligation_id: actionResult?.created_obligation?.obligation_id,
      created_effect_id: actionResult?.created_effect?.effect_id,
      result: skipped ? "skipped" : "success",
      skipped,
      reason
    })
  });
  return { duplicate: false, effect: await saveEffectRecord(pluginConfig, board, effect) };
}

export async function evaluateBoundObligationResolvedTriggers(pluginConfig, board, identity, event) {
  const triggerIds = event.trigger_ids ?? [];
  const fired = [];
  const skipped = [];
  for (const triggerId of triggerIds) {
    const trigger = await loadTriggerRecord(pluginConfig, board, triggerId);
    if (trigger == null) {
      skipped.push({ trigger_id: triggerId, reason: "trigger_not_found" });
      continue;
    }
    if (trigger.status !== "active") {
      skipped.push({ trigger, reason: `trigger_${trigger.status}` });
      continue;
    }
    if (!sourceMatches(trigger, event)) {
      skipped.push({ trigger, reason: "source_mismatch" });
      continue;
    }
    if (!await conditionMatches(pluginConfig, board, trigger, event)) {
      skipped.push({ trigger, reason: "condition_not_met" });
      continue;
    }
    if (await deterministicFireAlreadyRecorded(pluginConfig, board, trigger, event.obligation.obligation_id)) {
      skipped.push({ trigger, reason: "fire_policy_already_satisfied" });
      continue;
    }
    const action_result = await executeAction(pluginConfig, board, identity, trigger, event);
    const fireRecord = await recordTriggerFired(pluginConfig, board, identity, trigger, event, action_result);
    if (fireRecord.duplicate) {
      skipped.push({ trigger, reason: "fire_policy_already_satisfied" });
      continue;
    }
    fired.push({ trigger, action_result, trigger_fired_effect: fireRecord.effect });
  }
  return { fired, skipped };
}

export function createObligationResolvedEvent(obligation, resolution, options = {}) {
  return {
    event_type: "obligation.resolved",
    obligation,
    resolution,
    subject_ref: options.subject_ref ?? deriveSubjectRefFromObligation(obligation),
    trigger_ids: options.trigger_ids ?? obligation.on_resolve_trigger_ids ?? [],
    resolved_effect: options.resolved_effect ?? null
  };
}
