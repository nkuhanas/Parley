import { assertBoardAgentId, assertRecordId } from "../board/board_schema.js";

export const PLAN_LIFECYCLE_SYSTEM = "plan_lifecycle";
export const PLAN_LIFECYCLE_STATUSES = Object.freeze([
  "draft",
  "review",
  "needs_changes",
  "ready",
  "active",
  "paused",
  "blocked",
  "complete",
  "cancelled",
  "superseded",
  "failed",
  "archived"
]);

export const PLAN_LIFECYCLE_TERMINAL_STATUSES = Object.freeze(["complete", "cancelled", "superseded", "failed", "archived"]);
export const PLAN_ACTIVATION_POLICY_MODES = Object.freeze(["manual", "owner_decision", "human_gate", "auto"]);
export const PLAN_LIFECYCLE_OBLIGATION_ROLES = Object.freeze([
  "setup_decision",
  "review_decision",
  "activation_decision",
  "phase_work",
  "phase_outcome_decision",
  "blocker_resolution",
  "change_response",
  "terminal_disposition"
]);

function optionalString(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.trim();
}

function stringArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((item) => optionalString(item)).filter(Boolean);
  const single = optionalString(value);
  return single == null ? [] : [single];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function actorRef(boardAgentId) {
  return { type: "agent", id: assertBoardAgentId(boardAgentId, "actor.id") };
}

export function normalizePlanAuthority(rawAuthority, fallbackOwner, fallbackCreatedBy = fallbackOwner) {
  if (rawAuthority && typeof rawAuthority === "object" && !Array.isArray(rawAuthority)) {
    const owner = rawAuthority.owner ?? {};
    const createdBy = rawAuthority.createdBy ?? rawAuthority.created_by ?? {};
    return {
      owner: {
        type: owner.type ?? "agent",
        id: assertBoardAgentId(owner.id ?? fallbackOwner, "authority.owner.id")
      },
      createdBy: {
        type: createdBy.type ?? "agent",
        id: assertBoardAgentId(createdBy.id ?? fallbackCreatedBy ?? fallbackOwner, "authority.createdBy.id")
      }
    };
  }
  return {
    owner: actorRef(fallbackOwner),
    createdBy: actorRef(fallbackCreatedBy ?? fallbackOwner)
  };
}

export function normalizeActivationPolicy(rawPolicy = {}) {
  const mode = optionalString(rawPolicy?.mode, "owner_decision");
  if (!PLAN_ACTIVATION_POLICY_MODES.includes(mode)) {
    return { mode: "owner_decision" };
  }
  if (mode === "human_gate" && !optionalString(rawPolicy?.gate_id ?? rawPolicy?.gateId)) {
    return { mode: "owner_decision", deferred_reason: "human_gate activation policy is not active in MVP without an explicit reusable gate" };
  }
  return { ...rawPolicy, mode };
}

function normalizeResumePoint(rawResumePoint) {
  if (rawResumePoint == null) return null;
  if (typeof rawResumePoint !== "object" || Array.isArray(rawResumePoint)) return null;
  const phaseId = optionalString(rawResumePoint.phase_id ?? rawResumePoint.phaseId);
  if (phaseId == null) return null;
  return {
    phase_id: assertRecordId(phaseId, "managed.resumePoint.phase_id"),
    checkpoint_id: optionalString(rawResumePoint.checkpoint_id ?? rawResumePoint.checkpointId),
    activeObligationIds: unique(stringArray(rawResumePoint.activeObligationIds ?? rawResumePoint.active_obligation_ids)),
    suspended_at: optionalString(rawResumePoint.suspended_at ?? rawResumePoint.suspendedAt),
    reason: optionalString(rawResumePoint.reason, "No reason recorded.")
  };
}

export function normalizePlanManaged(rawManaged = {}) {
  const revision = Number.isInteger(rawManaged?.lifecycle_revision) && rawManaged.lifecycle_revision >= 0 ? rawManaged.lifecycle_revision : 0;
  return {
    system: PLAN_LIFECYCLE_SYSTEM,
    lifecycle_revision: revision,
    generatedObligationIds: unique(stringArray(rawManaged?.generatedObligationIds ?? rawManaged?.generated_obligation_ids)),
    activeLifecycleObligationIds: unique(stringArray(rawManaged?.activeLifecycleObligationIds ?? rawManaged?.active_lifecycle_obligation_ids)),
    current_phase_id: optionalString(rawManaged?.current_phase_id ?? rawManaged?.currentPhaseId),
    resumePoint: normalizeResumePoint(rawManaged?.resumePoint ?? rawManaged?.resume_point),
    lifecycle_updated_at: rawManaged?.lifecycle_updated_at ?? null
  };
}

export function nextLifecycleRevision(plan) {
  return (plan.managed?.lifecycle_revision ?? 0) + 1;
}

export function ownerId(plan) {
  return plan.authority?.owner?.id ?? plan.owner;
}

export function assertPlanOwner(plan, actor) {
  const actorId = typeof actor === "string" ? actor : actor?.board_agent_id;
  if (actorId !== ownerId(plan)) throw new Error(`plan owner required: ${ownerId(plan)}`);
  return actorId;
}

export function assertLifecycleStatus(status, fieldName = "status") {
  const normalized = optionalString(status);
  if (!PLAN_LIFECYCLE_STATUSES.includes(normalized)) {
    throw new Error(`${fieldName} must be one of: ${PLAN_LIFECYCLE_STATUSES.join(", ")}`);
  }
  return normalized;
}

function safeIdPart(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "agent";
}

export function lifecycleObligationId(planId, role, suffix = null) {
  assertRecordId(planId, "plan_id");
  const parts = ["obligation", planId, "lifecycle", role, suffix].filter(Boolean).map(safeIdPart);
  return parts.join("_");
}

export function managedBinding(plan, role, { phaseId = null, revision = null } = {}) {
  const binding = {
    system: PLAN_LIFECYCLE_SYSTEM,
    plan_id: plan.plan_id,
    role,
    revision: revision ?? plan.managed?.lifecycle_revision ?? 0,
    phase_id: phaseId
  };
  return binding;
}

export function isCurrentLifecycleObligation(plan, obligation, role = null) {
  if (obligation == null) return false;
  const binding = obligation.managedBinding ?? obligation.managed_binding;
  if (binding?.system !== PLAN_LIFECYCLE_SYSTEM) return false;
  if (binding.plan_id !== plan.plan_id) return false;
  if (role != null && binding.role !== role) return false;
  if (!(plan.managed?.activeLifecycleObligationIds ?? []).includes(obligation.obligation_id)) return false;
  if (binding.revision != null && binding.revision !== plan.managed?.lifecycle_revision) return false;
  return true;
}

export function withLifecycleIndexes(plan, obligations, timestamp) {
  const ids = unique(obligations.map((obligation) => obligation.obligation_id));
  const generated = unique([...(plan.managed?.generatedObligationIds ?? []), ...ids]);
  return {
    ...plan,
    managed: {
      ...normalizePlanManaged(plan.managed),
      lifecycle_revision: plan.managed?.lifecycle_revision ?? 0,
      generatedObligationIds: generated,
      activeLifecycleObligationIds: ids,
      lifecycle_updated_at: timestamp
    }
  };
}

export function withLifecycleTransition(plan, { status = plan.status, currentPhaseId = plan.managed?.current_phase_id ?? null, resumePoint = plan.managed?.resumePoint ?? null, timestamp }) {
  const nextRevision = nextLifecycleRevision(plan);
  return {
    ...plan,
    status: assertLifecycleStatus(status),
    managed: {
      ...normalizePlanManaged(plan.managed),
      lifecycle_revision: nextRevision,
      activeLifecycleObligationIds: [],
      current_phase_id: currentPhaseId,
      resumePoint,
      lifecycle_updated_at: timestamp
    }
  };
}

export function makeResumePoint(plan, { phaseId = plan.managed?.current_phase_id ?? activePhase(plan)?.phase_id, timestamp, reason }) {
  if (phaseId == null) throw new Error("resume point requires a current phase");
  return {
    phase_id: assertRecordId(phaseId, "resumePoint.phase_id"),
    checkpoint_id: null,
    activeObligationIds: unique(plan.managed?.activeLifecycleObligationIds ?? []),
    suspended_at: timestamp,
    reason: optionalString(reason, "No reason recorded.")
  };
}

export function activePhase(plan) {
  const phases = Array.isArray(plan.phases) ? plan.phases : [];
  const currentId = plan.managed?.current_phase_id;
  if (currentId != null) return phases.find((phase) => phase.phase_id === currentId) ?? null;
  return phases.find((phase) => !["complete", "cancelled", "superseded", "failed"].includes(phase.status)) ?? phases[0] ?? null;
}

export function nextIncompletePhase(plan, afterPhaseId = null) {
  const phases = Array.isArray(plan.phases) ? plan.phases : [];
  const start = afterPhaseId == null ? 0 : phases.findIndex((phase) => phase.phase_id === afterPhaseId) + 1;
  return phases.slice(Math.max(0, start)).find((phase) => !["complete", "cancelled", "superseded", "failed"].includes(phase.status)) ?? null;
}

export function terminalStatus(status) {
  return PLAN_LIFECYCLE_TERMINAL_STATUSES.includes(status);
}
