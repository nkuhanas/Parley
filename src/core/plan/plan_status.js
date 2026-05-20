import { activePhase } from "./lifecycle.js";
import { isHumanGatePhase } from "./plan_state.js";
import { listEffectRecords } from "../storage/board_store.js";

export const HITL_INPUT_EFFECT_TYPE = "hitl_input_recorded";
export const HITL_APPROVING_DECISIONS = Object.freeze(["approve", "approved", "accept", "accepted", "acknowledge", "acknowledged", "complete", "completed"]);

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => {
    if (entry == null) return false;
    if (Array.isArray(entry) && entry.length === 0) return false;
    return true;
  }));
}

export function normalizeHitlDecision(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function isApprovingHitlDecision(value) {
  return HITL_APPROVING_DECISIONS.includes(normalizeHitlDecision(value));
}

function targetValue(effect, snakeName, camelName = snakeName) {
  return effect?.target?.[snakeName] ?? effect?.target?.[camelName];
}

function compareEffectOrder(a, b) {
  return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
    || String(a.effect_id ?? "").localeCompare(String(b.effect_id ?? ""));
}

export async function listHitlInputEffects(api, identity, plan, phaseId = null) {
  const effects = await listEffectRecords(api.pluginConfig, identity.board);
  return effects
    .filter((effect) => effect?.type === HITL_INPUT_EFFECT_TYPE)
    .filter((effect) => targetValue(effect, "plan_id", "planId") === plan.plan_id)
    .filter((effect) => phaseId == null || targetValue(effect, "phase_id", "phaseId") === phaseId)
    .sort(compareEffectOrder);
}

export function summarizeHitlInputEffect(effect) {
  if (effect == null) return null;
  return compactObject({
    effect_id: effect.effect_id,
    actor: effect.actor?.board_agent_id,
    decision: effect.payload?.decision,
    summary: effect.payload?.summary,
    required_from: effect.payload?.required_from,
    source: effect.payload?.source,
    created_at: effect.created_at
  });
}

export async function latestApprovingHitlInput(api, identity, plan, phaseId) {
  const effects = await listHitlInputEffects(api, identity, plan, phaseId);
  return [...effects].reverse().find((effect) => isApprovingHitlDecision(effect.payload?.decision)) ?? null;
}

function summarizePhase(phase, { currentPhaseId, hitlEffects }) {
  const gate = isHumanGatePhase(phase);
  const phaseHitlEffects = gate ? hitlEffects.filter((effect) => targetValue(effect, "phase_id", "phaseId") === phase.phase_id) : [];
  const latestInput = phaseHitlEffects.length ? phaseHitlEffects[phaseHitlEffects.length - 1] : null;
  const approvingInput = [...phaseHitlEffects].reverse().find((effect) => isApprovingHitlDecision(effect.payload?.decision)) ?? null;
  return compactObject({
    phase_id: phase.phase_id,
    title: phase.title,
    kind: phase.kind,
    status: phase.status,
    owner: phase.owner,
    is_current: phase.phase_id === currentPhaseId,
    hitl: gate ? compactObject({
      required: true,
      required_from: phase.required_from,
      shepherd: phase.owner ?? phase.shepherd,
      requested_decision: phase.requested_decision,
      recorded_input_count: phaseHitlEffects.length,
      latest_input: summarizeHitlInputEffect(latestInput),
      approving_input_effect_id: approvingInput?.effect_id,
      completion_ready: approvingInput != null
    }) : undefined
  });
}

function nextActionFor(plan, currentPhase) {
  if (["complete", "cancelled", "superseded", "failed", "archived"].includes(plan.status)) {
    return { kind: "terminal", reason: `Plan is ${plan.status}.` };
  }
  if (plan.status === "paused" || plan.status === "blocked") {
    return { kind: "resume_or_disposition", reason: `Plan is ${plan.status}; resolve the blocker, resume, or terminally disposition it.` };
  }
  if (currentPhase?.hitl?.required && !currentPhase.hitl.completion_ready) {
    if (currentPhase.hitl.latest_input != null) {
      return {
        kind: "record_phase_outcome",
        tool: "parley_record_phase_outcome",
        reason: "Current HITL phase has non-approving human input; record a blocked/failed outcome or record new approving input before completion."
      };
    }
    return {
      kind: "record_hitl_input",
      tool: "parley_record_hitl_input",
      reason: "Current phase is HITL-gated; record explicit human input before completion can be recorded."
    };
  }
  if (plan.status === "active" && currentPhase != null) {
    return {
      kind: "record_phase_outcome",
      tool: "parley_record_phase_outcome",
      reason: "Current phase is active; record a phase outcome only after the phase exit criteria are satisfied."
    };
  }
  return { kind: "lifecycle_decision", reason: `Plan is ${plan.status}; choose the next lifecycle action.` };
}

export async function explicitPlanStatus(api, identity, plan) {
  const current = activePhase(plan);
  const hitlEffects = await listHitlInputEffects(api, identity, plan);
  const phaseSummaries = (plan.phases ?? []).map((phase) => summarizePhase(phase, {
    currentPhaseId: plan.managed?.current_phase_id ?? current?.phase_id,
    hitlEffects
  }));
  const currentPhase = phaseSummaries.find((phase) => phase.is_current) ?? null;
  return {
    plan: compactObject({
      plan_id: plan.plan_id,
      title: plan.title,
      status: plan.status,
      version: plan.version,
      owner: plan.owner,
      artifact_id: plan.artifact_id,
      artifact_uri: plan.landing?.uri,
      artifact_path: plan.landing?.resolved_path,
      lifecycle_revision: plan.managed?.lifecycle_revision,
      current_phase_id: plan.managed?.current_phase_id ?? current?.phase_id,
      resume_point: plan.managed?.resumePoint,
      phase_count: Array.isArray(plan.phases) ? plan.phases.length : 0
    }),
    current_phase: currentPhase,
    phases: phaseSummaries,
    next_action: nextActionFor(plan, currentPhase)
  };
}
