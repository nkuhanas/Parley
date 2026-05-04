import { createEffectRecord, loadObligationRecord, saveEffectRecord, saveObligationRecord } from "../../../core/storage/board_store.js";
import { nowIso } from "../../../core/time.js";
import { activePhase, assertPlanOwner, isCurrentLifecycleObligation, makeResumePoint, nextIncompletePhase, withLifecycleTransition } from "../../../core/plan/lifecycle.js";
import { derivePlanSetupState } from "../../../core/plan/plan_state.js";
import { loadPlanOrThrow, saveAndExportPlan } from "./plan_common.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null));
}

function stringArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  const single = String(value).trim();
  return single ? [single] : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function recordLifecycleEffect(api, identity, plan, payload) {
  const effect = createEffectRecord({
    board_id: identity.board_id,
    type: "plan_lifecycle_transitioned",
    actor: identity.actor,
    target: compactObject({ plan_id: plan.plan_id, artifact_id: plan.artifact_id, phase_id: payload.phase_id }),
    payload: compactObject(payload)
  });
  return saveEffectRecord(api.pluginConfig, identity.board, effect);
}

async function resolveManagedDecisionObligation(api, identity, plan, obligationId, role, resolution, note) {
  const obligation = await loadObligationRecord(api.pluginConfig, identity.board, obligationId);
  if (obligation == null) throw new Error(`obligation not found: ${obligationId}`);
  if (obligation.agent !== identity.board_agent_id) throw new Error(`obligation is assigned to ${obligation.agent}, not ${identity.board_agent_id}`);
  if (!isCurrentLifecycleObligation(plan, obligation, role)) {
    throw new Error(`obligation is not the current plan lifecycle ${role} obligation for ${plan.plan_id}`);
  }
  if (obligation.status === "resolved") throw new Error(`obligation already resolved: ${obligation.obligation_id}`);
  const timestamp = nowIso();
  return saveObligationRecord(api.pluginConfig, identity.board, {
    ...obligation,
    status: "resolved",
    resolution,
    resolution_note: note ?? null,
    resolved_at: timestamp,
    updated_at: timestamp
  });
}

function lifecycleToolParams(extraProperties, required = ["boardId", "planId"]) {
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties: {
      callerRuntimeRef: callerRuntimeRefParameter(),
      boardId: { type: "string" },
      planId: { type: "string" },
      ...extraProperties
    }
  };
}

export function createRequestPlanReviewAction(api) {
  return {
    name: "parley_request_plan_review",
    label: "Parley Request Plan Review",
    description: "Owner-only lifecycle command: move a setup-complete plan into review and let Parley create managed reviewer obligations.",
    parameters: lifecycleToolParams({
      requiredReviewers: { type: "array", items: { type: "string" } },
      reason: { type: "string" }
    }),
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const plan = await loadPlanOrThrow(api, identity, params.planId);
      assertPlanOwner(plan, identity.actor);
      if (!["draft", "needs_changes", "ready"].includes(plan.status)) throw new Error(`plan status ${plan.status} cannot enter review`);
      const reviewers = unique(stringArray(params.requiredReviewers ?? plan.review?.required_reviewers));
      if (reviewers.length === 0) throw new Error("requiredReviewers must contain at least one board-local reviewer");
      const boardAgents = new Set(identity.board.agent_registry.map((agent) => agent.board_agent_id));
      for (const reviewer of reviewers) {
        if (!boardAgents.has(reviewer)) throw new Error(`required reviewer must be a board agent: ${reviewer}`);
      }
      const timestamp = nowIso();
      const transitioned = withLifecycleTransition({
        ...plan,
        review: { required_reviewers: reviewers, approvals: [], objections: [] }
      }, { status: "review", timestamp });
      const effect = await recordLifecycleEffect(api, identity, transitioned, {
        action: "request_review",
        from_status: plan.status,
        to_status: "review",
        reason: params.reason ?? "Owner requested plan review."
      });
      const result = await saveAndExportPlan(api, identity, transitioned);
      return boardResult({
        tool: "parley_request_plan_review",
        identity,
        plan: result.plan,
        effect,
        artifact: result.artifact,
        plan_lifecycle: { obligations: result.lifecycleObligations ?? [] }
      });
    }
  };
}

export function createRecordReviewDecisionAction(api) {
  return {
    name: "parley_record_review_decision",
    label: "Parley Record Review Decision",
    description: "Reviewer lifecycle command: record a decision for an assigned active review obligation. Resolves that obligation internally.",
    parameters: lifecycleToolParams({
      obligationId: { type: "string" },
      decision: { type: "string", description: "approve, request_changes, or reject." },
      note: { type: "string" }
    }, ["boardId", "planId", "obligationId", "decision"]),
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const plan = await loadPlanOrThrow(api, identity, params.planId);
      if (plan.status !== "review") throw new Error(`plan is not in review: ${plan.status}`);
      const decision = String(params.decision).trim();
      if (!["approve", "request_changes", "reject"].includes(decision)) throw new Error("decision must be approve, request_changes, or reject");
      const resolvedObligation = await resolveManagedDecisionObligation(api, identity, plan, params.obligationId, "review_decision", decision === "approve" ? "completed" : "rejected", params.note);
      const approvals = unique([...(plan.review?.approvals ?? []), ...(decision === "approve" ? [identity.board_agent_id] : [])]);
      const objections = unique([...(plan.review?.objections ?? []), ...(["request_changes", "reject"].includes(decision) ? [identity.board_agent_id] : [])]);
      const required = plan.review?.required_reviewers ?? [];
      const allApproved = required.length > 0 && required.every((reviewer) => approvals.includes(reviewer));
      const toStatus = decision === "approve" ? (allApproved ? "ready" : "review") : "needs_changes";
      const timestamp = nowIso();
      const transitioned = withLifecycleTransition({
        ...plan,
        review: { required_reviewers: required, approvals, objections }
      }, { status: toStatus, timestamp });
      const effect = await recordLifecycleEffect(api, identity, transitioned, {
        action: "record_review_decision",
        from_status: plan.status,
        to_status: toStatus,
        decision,
        note: params.note,
        obligation_id: resolvedObligation.obligation_id
      });
      const result = await saveAndExportPlan(api, identity, transitioned);
      return boardResult({
        tool: "parley_record_review_decision",
        identity,
        decision,
        obligation: resolvedObligation,
        effect,
        plan: result.plan,
        artifact: result.artifact,
        plan_lifecycle: { obligations: result.lifecycleObligations ?? [] }
      });
    }
  };
}


function requireReason(value, fieldName = "reason") {
  const reason = String(value ?? "").trim();
  if (!reason) throw new Error(`${fieldName} is required`);
  return reason;
}

function assertSetupComplete(plan, board) {
  const setupState = derivePlanSetupState(plan, board);
  if (!setupState.setupComplete) {
    throw new Error(`plan setup is incomplete: ${setupState.missingRequired.join(", ")}`);
  }
  return setupState;
}

export function createMarkPlanReadyAction(api) {
  return {
    name: "parley_mark_plan_ready",
    label: "Parley Mark Plan Ready",
    description: "Owner-only lifecycle command: mark a setup-complete plan ready without review, with an explicit no-review reason.",
    parameters: lifecycleToolParams({
      noReviewReason: { type: "string" },
      reason: { type: "string" }
    }),
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const plan = await loadPlanOrThrow(api, identity, params.planId);
      assertPlanOwner(plan, identity.actor);
      if (!["draft", "needs_changes"].includes(plan.status)) throw new Error(`only draft or needs_changes plans can be marked ready without review; current status is ${plan.status}`);
      assertSetupComplete(plan, identity.board);
      const reason = requireReason(params.noReviewReason ?? params.reason, "noReviewReason");
      const timestamp = nowIso();
      const transitioned = withLifecycleTransition(plan, { status: "ready", currentPhaseId: null, resumePoint: null, timestamp });
      const effect = await recordLifecycleEffect(api, identity, transitioned, {
        action: "mark_ready_no_review",
        from_status: plan.status,
        to_status: "ready",
        reason
      });
      const result = await saveAndExportPlan(api, identity, transitioned);
      return boardResult({
        tool: "parley_mark_plan_ready",
        identity,
        plan: result.plan,
        effect,
        artifact: result.artifact,
        plan_lifecycle: { obligations: result.lifecycleObligations ?? [] }
      });
    }
  };
}

export function createRecordPlanDispositionAction(api) {
  return {
    name: "parley_record_plan_disposition",
    label: "Parley Record Plan Disposition",
    description: "Owner-only lifecycle command: terminally disposition a plan or archive an already non-active plan, with a reason.",
    parameters: lifecycleToolParams({
      disposition: { type: "string", description: "complete, cancelled, superseded, failed, or archived." },
      reason: { type: "string" }
    }, ["boardId", "planId", "disposition", "reason"]),
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const plan = await loadPlanOrThrow(api, identity, params.planId);
      assertPlanOwner(plan, identity.actor);
      const disposition = String(params.disposition ?? "").trim();
      if (!["complete", "cancelled", "superseded", "failed", "archived"].includes(disposition)) {
        throw new Error("disposition must be complete, cancelled, superseded, failed, or archived");
      }
      if (plan.status === "active" && disposition === "archived") throw new Error("active plans cannot be archived directly; record a terminal disposition first");
      const reason = requireReason(params.reason);
      const timestamp = nowIso();
      const transitioned = withLifecycleTransition(plan, { status: disposition, currentPhaseId: null, resumePoint: null, timestamp });
      const effect = await recordLifecycleEffect(api, identity, transitioned, {
        action: "record_plan_disposition",
        from_status: plan.status,
        to_status: disposition,
        disposition,
        reason
      });
      const result = await saveAndExportPlan(api, identity, transitioned);
      return boardResult({
        tool: "parley_record_plan_disposition",
        identity,
        disposition,
        plan: result.plan,
        effect,
        artifact: result.artifact,
        plan_lifecycle: { obligations: result.lifecycleObligations ?? [] }
      });
    }
  };
}

export function createPausePlanAction(api) {
  return {
    name: "parley_pause_plan",
    label: "Parley Pause Plan",
    description: "Owner-only lifecycle command: pause an active plan, suspend current lifecycle obligations, and store a resume point.",
    parameters: lifecycleToolParams({ reason: { type: "string" } }, ["boardId", "planId", "reason"]),
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const plan = await loadPlanOrThrow(api, identity, params.planId);
      assertPlanOwner(plan, identity.actor);
      if (plan.status !== "active") throw new Error(`only active plans can be paused; current status is ${plan.status}`);
      const phase = activePhase(plan);
      if (phase == null) throw new Error("cannot pause an active plan without a current phase");
      const reason = requireReason(params.reason);
      const timestamp = nowIso();
      const resumePoint = makeResumePoint(plan, { phaseId: phase.phase_id, timestamp, reason });
      const transitioned = withLifecycleTransition(plan, { status: "paused", currentPhaseId: phase.phase_id, resumePoint, timestamp });
      const effect = await recordLifecycleEffect(api, identity, transitioned, {
        action: "pause_plan",
        from_status: plan.status,
        to_status: "paused",
        phase_id: phase.phase_id,
        reason
      });
      const result = await saveAndExportPlan(api, identity, transitioned);
      return boardResult({
        tool: "parley_pause_plan",
        identity,
        plan: result.plan,
        effect,
        artifact: result.artifact,
        resume_point: result.plan.managed?.resumePoint ?? null,
        plan_lifecycle: { obligations: result.lifecycleObligations ?? [] }
      });
    }
  };
}

export function createResumePlanAction(api) {
  return {
    name: "parley_resume_plan",
    label: "Parley Resume Plan",
    description: "Owner-only lifecycle command: resume a paused or blocked plan from its stored resume point.",
    parameters: lifecycleToolParams({ reason: { type: "string" } }, ["boardId", "planId", "reason"]),
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const plan = await loadPlanOrThrow(api, identity, params.planId);
      assertPlanOwner(plan, identity.actor);
      if (!["paused", "blocked"].includes(plan.status)) throw new Error(`only paused or blocked plans can be resumed; current status is ${plan.status}`);
      const resumePoint = plan.managed?.resumePoint;
      const phaseId = resumePoint?.phase_id ?? plan.managed?.current_phase_id;
      if (phaseId == null) throw new Error("cannot resume plan without a resume point phase");
      if (!plan.phases.some((phase) => phase.phase_id === phaseId)) throw new Error(`resume point phase is missing: ${phaseId}`);
      const reason = requireReason(params.reason);
      const timestamp = nowIso();
      const phases = plan.phases.map((phase) => phase.phase_id === phaseId ? { ...phase, status: "active" } : phase);
      const transitioned = withLifecycleTransition({ ...plan, phases }, { status: "active", currentPhaseId: phaseId, resumePoint: null, timestamp });
      const effect = await recordLifecycleEffect(api, identity, transitioned, {
        action: "resume_plan",
        from_status: plan.status,
        to_status: "active",
        phase_id: phaseId,
        reason
      });
      const result = await saveAndExportPlan(api, identity, transitioned);
      return boardResult({
        tool: "parley_resume_plan",
        identity,
        plan: result.plan,
        effect,
        artifact: result.artifact,
        plan_lifecycle: { obligations: result.lifecycleObligations ?? [] }
      });
    }
  };
}

export function createActivatePlanAction(api) {
  return {
    name: "parley_activate_plan",
    label: "Parley Activate Plan",
    description: "Owner-only lifecycle command: activate a ready plan and let Parley create managed phase work/outcome obligations.",
    parameters: lifecycleToolParams({ reason: { type: "string" } }),
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const plan = await loadPlanOrThrow(api, identity, params.planId);
      assertPlanOwner(plan, identity.actor);
      if (plan.status !== "ready") throw new Error(`only ready plans can be activated; current status is ${plan.status}`);
      const phase = nextIncompletePhase(plan);
      if (phase == null) throw new Error("cannot activate a plan with no incomplete phases");
      const timestamp = nowIso();
      const transitioned = withLifecycleTransition({
        ...plan,
        phases: plan.phases.map((item) => item.phase_id === phase.phase_id ? { ...item, status: "active" } : item)
      }, { status: "active", currentPhaseId: phase.phase_id, timestamp });
      const effect = await recordLifecycleEffect(api, identity, transitioned, {
        action: "activate_plan",
        from_status: plan.status,
        to_status: "active",
        phase_id: phase.phase_id,
        reason: params.reason ?? "Owner activated ready plan."
      });
      const result = await saveAndExportPlan(api, identity, transitioned);
      return boardResult({
        tool: "parley_activate_plan",
        identity,
        plan: result.plan,
        effect,
        artifact: result.artifact,
        plan_lifecycle: { obligations: result.lifecycleObligations ?? [] }
      });
    }
  };
}

export function createRecordPhaseOutcomeAction(api) {
  return {
    name: "parley_record_phase_outcome",
    label: "Parley Record Phase Outcome",
    description: "Owner-only lifecycle command: record the outcome for the current active phase and move the lifecycle cursor.",
    parameters: lifecycleToolParams({
      phaseId: { type: "string" },
      outcome: { type: "string", description: "complete, blocked, or failed." },
      note: { type: "string" }
    }, ["boardId", "planId", "phaseId", "outcome"]),
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const plan = await loadPlanOrThrow(api, identity, params.planId);
      assertPlanOwner(plan, identity.actor);
      if (plan.status !== "active") throw new Error(`plan is not active: ${plan.status}`);
      if (plan.managed?.current_phase_id !== params.phaseId) throw new Error(`phase is not current: ${params.phaseId}`);
      const outcome = String(params.outcome).trim();
      if (!["complete", "blocked", "failed"].includes(outcome)) throw new Error("outcome must be complete, blocked, or failed");
      const nextPhase = outcome === "complete" ? nextIncompletePhase(plan, params.phaseId) : null;
      const toStatus = outcome === "complete" ? (nextPhase == null ? "complete" : "active") : outcome;
      const timestamp = nowIso();
      const phases = plan.phases.map((phase) => {
        if (phase.phase_id === params.phaseId) return { ...phase, status: outcome };
        if (nextPhase != null && phase.phase_id === nextPhase.phase_id) return { ...phase, status: "active" };
        return phase;
      });
      const resumePoint = ["blocked", "failed"].includes(toStatus) ? makeResumePoint(plan, { phaseId: params.phaseId, timestamp, reason: params.note }) : null;
      const transitioned = withLifecycleTransition({ ...plan, phases }, {
        status: toStatus,
        currentPhaseId: nextPhase?.phase_id ?? (["blocked", "failed"].includes(toStatus) ? params.phaseId : null),
        resumePoint,
        timestamp
      });
      const effect = await recordLifecycleEffect(api, identity, transitioned, {
        action: "record_phase_outcome",
        from_status: plan.status,
        to_status: toStatus,
        decision: outcome,
        note: params.note,
        phase_id: params.phaseId
      });
      const result = await saveAndExportPlan(api, identity, transitioned);
      return boardResult({
        tool: "parley_record_phase_outcome",
        identity,
        outcome,
        plan: result.plan,
        effect,
        artifact: result.artifact,
        plan_lifecycle: { obligations: result.lifecycleObligations ?? [] }
      });
    }
  };
}
