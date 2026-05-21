import { isIsoTimestamp } from "../time.js";

export const ARTIFACT_KINDS = Object.freeze([
  "plan",
  "invariant_spec",
  "decision_record",
  "documentation",
  "review_request",
  "handoff_packet",
  "execution_report",
  "phase",
  "activation_candidate"
]);
export const ARTIFACT_STORAGE_MODES = Object.freeze(["reference_only", "managed_local", "explicit_landing"]);
export const COORDINATION_OBJECT_KINDS = Object.freeze([
  "plan",
  "invariant_spec",
  "decision_record",
  "review_request",
  "handoff_packet",
  "execution_report",
  "phase",
  "activation_candidate"
]);
export const COORDINATION_STATUSES = Object.freeze([
  "draft",
  "review",
  "needs_changes",
  "ready",
  "ratified",
  "active",
  "paused",
  "deferred",
  "blocked",
  "complete",
  "superseded",
  "failed",
  "archived",
  "cancelled"
]);
export const EFFECT_TYPES = Object.freeze([
  "artifact_linked",
  "review_requested",
  "approval_recorded",
  "approval_withdrawn",
  "objection_raised",
  "objection_resolved",
  "constraint_added",
  "non_goal_added",
  "decision_recorded",
  "obligation_created",
  "obligation_resolved",
  "trigger_fired",
  "artifact_superseded",
  "relationship_added",
  "relationship_removed",
  "artifact_unlinked",
  "phase_deferred",
  "activation_proposed",
  "activation_candidate_dismissed",
  "handoff_created",
  "effect_corrected",
  "hitl_input_recorded",
  "plan_lifecycle_transitioned"
]);
export const OBLIGATION_TYPES = Object.freeze([
  "review",
  "approve_or_object",
  "resolve_objection",
  "implement_phase",
  "report_status",
  "record_hitl_input",
  "validate_activation",
  "notify_human",
  "preserve_awareness"
]);
export const OBLIGATION_STATUSES = Object.freeze([
  "active",
  "blocking",
  "waiting",
  "deferred",
  "resolved",
  "stale",
  "cancelled",
  "superseded"
]);
export const OBLIGATION_RESOLUTIONS = Object.freeze([
  "completed",
  "failed",
  "blocked",
  "rejected",
  "superseded",
  "cancelled"
]);
export const OBLIGATION_EXECUTION_AUTONOMY = Object.freeze([
  "inform",
  "recommend",
  "act_if_low_risk",
  "requires_human"
]);
export const TRIGGER_STATUSES = Object.freeze(["active", "disabled", "retired"]);
export const TRIGGER_FIRE_POLICIES = Object.freeze(["once", "once_per_source_obligation", "many"]);
export const TRIGGER_EVENT_TYPES = Object.freeze(["obligation.resolved"]);
export const TRIGGER_ACTION_TYPES = Object.freeze(["create_obligation", "record_effect"]);
export const RELATIONSHIP_TYPES = Object.freeze([
  "supersedes",
  "superseded_by",
  "constrains",
  "constrained_by",
  "depends_on",
  "blocks",
  "blocked_by",
  "implements",
  "implemented_by",
  "refines",
  "refined_by",
  "absorbed_by",
  "extracts_from",
  "related_to"
]);
export const RELATIONSHIP_REF_KINDS = Object.freeze(["artifact", "object"]);
export const RELATIONSHIP_STATUSES = Object.freeze(["active", "removed", "superseded"]);
export const PROJECTION_TYPES = Object.freeze(["minimal_board", "where_am_i"]);

const ID_PATTERN = /^[a-z0-9_]+$/;
const BOARD_AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const BOARD_ID_PATTERN = /^[a-z0-9][a-z0-9_]*$/;

export function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} required`);
  }
  return value.trim();
}

export function assertOptionalString(value, fieldName) {
  if (value == null) return null;
  return assertNonEmptyString(value, fieldName);
}

export function assertRecordId(value, fieldName) {
  const normalized = assertNonEmptyString(value, fieldName);
  if (!ID_PATTERN.test(normalized)) {
    throw new Error(`${fieldName} must match ${ID_PATTERN}`);
  }
  return normalized;
}

export function assertBoardAgentId(value, fieldName = "board_agent_id") {
  const normalized = assertNonEmptyString(value, fieldName);
  if (!BOARD_AGENT_ID_PATTERN.test(normalized)) {
    throw new Error(`${fieldName} must match ${BOARD_AGENT_ID_PATTERN}`);
  }
  return normalized;
}

export function assertBoardId(value, fieldName = "board_id") {
  const normalized = assertNonEmptyString(value, fieldName);
  if (!BOARD_ID_PATTERN.test(normalized)) {
    throw new Error(`${fieldName} must match ${BOARD_ID_PATTERN}`);
  }
  return normalized;
}

export function assertEnum(value, allowedValues, fieldName) {
  const normalized = assertNonEmptyString(value, fieldName);
  if (!allowedValues.includes(normalized)) {
    throw new Error(`${fieldName} must be one of: ${allowedValues.join(", ")}`);
  }
  return normalized;
}

export function assertIsoTimestamp(value, fieldName) {
  const normalized = assertNonEmptyString(value, fieldName);
  if (!isIsoTimestamp(normalized)) {
    throw new Error(`${fieldName} must be an ISO timestamp`);
  }
  return normalized;
}

export function assertObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  return value;
}

export function assertRuntimeRef(value, fieldName = "runtime_ref") {
  const raw = assertObject(value, fieldName);
  return {
    scheme: assertNonEmptyString(raw.scheme, `${fieldName}.scheme`),
    type: assertNonEmptyString(raw.type, `${fieldName}.type`),
    id: assertNonEmptyString(raw.id, `${fieldName}.id`)
  };
}

export function assertRuntimeRefs(value, fieldName = "runtime_refs") {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  return value.map((runtimeRef, index) => assertRuntimeRef(runtimeRef, `${fieldName}[${index}]`));
}

function assertPlainOptionalObject(value, fieldName) {
  if (value == null) return {};
  return assertObject(value, fieldName);
}

function assertAllowedKeys(raw, fieldName, allowedKeys) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error(`${fieldName}.${key} is not allowed`);
  }
}

function assertNonEmptyObject(value, fieldName) {
  const raw = assertObject(value, fieldName);
  if (Object.keys(raw).length === 0) throw new Error(`${fieldName} must not be empty`);
  return raw;
}

function assertPositiveInteger(value, fieldName, { allowNull = false } = {}) {
  if (value == null && allowNull) return null;
  if (!Number.isInteger(value) || value < 1) throw new Error(`${fieldName} must be a positive integer`);
  return value;
}

function assertNonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${fieldName} must be a non-negative integer`);
  return value;
}

function assertBoardScopedRefId(raw, key, fieldName, { required = false } = {}) {
  if (raw[key] == null) {
    if (required) throw new Error(`${fieldName}.${key} required`);
    return null;
  }
  return assertRecordId(raw[key], `${fieldName}.${key}`);
}

function assertFlexibleParticipant(value, fieldName) {
  return assertNonEmptyString(value, fieldName);
}

function assertFlexibleParticipantArray(value, fieldName) {
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);
  return value.map((item, index) => assertFlexibleParticipant(item, `${fieldName}[${index}]`));
}

function assertRecordIdArray(value, fieldName, { defaultValue = [] } = {}) {
  if (value == null) return defaultValue;
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);
  return value.map((item, index) => assertRecordId(item, `${fieldName}[${index}]`));
}

function assertOptionalEnumArray(value, allowedValues, fieldName) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);
  return value.map((item, index) => assertEnum(item, allowedValues, `${fieldName}[${index}]`));
}

export function assertActorRecord(value, fieldName = "actor") {
  const raw = assertObject(value, fieldName);
  const validated = {
    board_agent_id: assertBoardAgentId(raw.board_agent_id, `${fieldName}.board_agent_id`),
    runtime_ref: assertRuntimeRef(raw.runtime_ref, `${fieldName}.runtime_ref`),
    runtime_aliases: raw.runtime_aliases == null ? [] : assertRuntimeRefs(raw.runtime_aliases, `${fieldName}.runtime_aliases`)
  };
  if (raw.identity_resolution != null) {
    validated.identity_resolution = assertObject(raw.identity_resolution, `${fieldName}.identity_resolution`);
  }
  return validated;
}

export function assertArtifactRecordRef(value, fieldName = "artifact_ref") {
  const raw = assertObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["artifact_id", "version"]);
  return {
    artifact_id: assertRecordId(raw.artifact_id, `${fieldName}.artifact_id`),
    version: assertPositiveInteger(raw.version, `${fieldName}.version`)
  };
}

function assertRelationshipEffectTarget(value, fieldName) {
  const raw = assertObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["relationship_id", "relationship_type", "from", "to"]);
  return {
    relationship_id: assertRecordId(raw.relationship_id, `${fieldName}.relationship_id`),
    relationship_type: assertEnum(raw.relationship_type, RELATIONSHIP_TYPES, `${fieldName}.relationship_type`),
    from: assertRelationshipRef(raw.from, `${fieldName}.from`),
    to: assertRelationshipRef(raw.to, `${fieldName}.to`)
  };
}

function assertPlanPhaseTarget(value, fieldName) {
  const raw = assertObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["artifact_id", "artifact_version", "plan_id", "phase_id"]);
  return {
    artifact_id: assertRecordId(raw.artifact_id, `${fieldName}.artifact_id`),
    artifact_version: assertPositiveInteger(raw.artifact_version, `${fieldName}.artifact_version`),
    plan_id: assertRecordId(raw.plan_id, `${fieldName}.plan_id`),
    phase_id: assertRecordId(raw.phase_id, `${fieldName}.phase_id`)
  };
}

function assertApprovalTarget(value, fieldName) {
  const raw = assertObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["artifact_id", "artifact_version", "version", "scope", "authority_scope"]);
  const artifactVersion = raw.artifact_version ?? raw.version;
  const scope = raw.scope ?? raw.authority_scope;
  return {
    artifact_id: assertRecordId(raw.artifact_id, `${fieldName}.artifact_id`),
    artifact_version: assertPositiveInteger(artifactVersion, `${fieldName}.artifact_version`),
    scope: assertNonEmptyString(scope, `${fieldName}.scope`)
  };
}

function assertReviewTarget(value, fieldName) {
  const raw = assertObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["object_id", "artifact_id", "artifact_version", "checkpoint_id", "phase_id", "plan_id", "review_required_from", "scope"]);
  const validated = {};
  for (const key of ["object_id", "artifact_id", "checkpoint_id", "phase_id", "plan_id"]) {
    const normalized = assertBoardScopedRefId(raw, key, fieldName);
    if (normalized != null) validated[key] = normalized;
  }
  if (raw.artifact_version != null) validated.artifact_version = assertPositiveInteger(raw.artifact_version, `${fieldName}.artifact_version`);
  if (raw.review_required_from != null) validated.review_required_from = assertFlexibleParticipant(raw.review_required_from, `${fieldName}.review_required_from`);
  if (raw.scope != null) validated.scope = assertNonEmptyString(raw.scope, `${fieldName}.scope`);
  if (Object.keys(validated).length === 0) return validated;
  if (validated.object_id == null && validated.artifact_id == null && validated.checkpoint_id == null && validated.phase_id == null) {
    throw new Error(`${fieldName} requires object_id, artifact_id, checkpoint_id, or phase_id`);
  }
  if (validated.checkpoint_id != null || validated.phase_id != null) {
    for (const required of ["plan_id", "artifact_id", "artifact_version", "review_required_from"]) {
      if (validated[required] == null) throw new Error(`${fieldName}.${required} required for phase/checkpoint review target`);
    }
  }
  return validated;
}

function assertGenericBoardTarget(value, fieldName) {
  const raw = assertNonEmptyObject(value, fieldName);
  const allowedKeys = ["object_id", "artifact_id", "artifact_version", "plan_id", "phase_id", "checkpoint_id", "relationship_id", "obligation_id", "trigger_id", "thread_id", "message_id", "scope"];
  assertAllowedKeys(raw, fieldName, allowedKeys);
  const validated = {};
  for (const key of ["object_id", "artifact_id", "plan_id", "phase_id", "checkpoint_id", "relationship_id", "obligation_id", "trigger_id"]) {
    const normalized = assertBoardScopedRefId(raw, key, fieldName);
    if (normalized != null) validated[key] = normalized;
  }
  if (raw.artifact_version != null) validated.artifact_version = assertPositiveInteger(raw.artifact_version, `${fieldName}.artifact_version`);
  if (raw.thread_id != null) validated.thread_id = assertRecordId(raw.thread_id, `${fieldName}.thread_id`);
  if (raw.message_id != null) validated.message_id = assertRecordId(raw.message_id, `${fieldName}.message_id`);
  if (raw.scope != null) validated.scope = assertNonEmptyString(raw.scope, `${fieldName}.scope`);
  return validated;
}

function assertKnownPayload(value, fieldName, allowedKeys) {
  const raw = assertPlainOptionalObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, allowedKeys);
  return { ...raw };
}

function assertRelationshipRemovedPayload(value, fieldName) {
  const raw = assertPlainOptionalObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["reason", "removal_mode", "relationship_status", "superseded_by_relationship_id"]);
  return {
    reason: assertNonEmptyString(raw.reason, `${fieldName}.reason`),
    removal_mode: assertNonEmptyString(raw.removal_mode, `${fieldName}.removal_mode`),
    relationship_status: assertEnum(raw.relationship_status, RELATIONSHIP_STATUSES, `${fieldName}.relationship_status`),
    ...(raw.superseded_by_relationship_id != null
      ? { superseded_by_relationship_id: assertRecordId(raw.superseded_by_relationship_id, `${fieldName}.superseded_by_relationship_id`) }
      : {})
  };
}

function assertActivationProposedPayload(value, fieldName) {
  const raw = assertPlainOptionalObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["requested_action", "non_executing", "review_required_from", "evidence"]);
  if (raw.non_executing !== true) throw new Error(`${fieldName}.non_executing must be true`);
  return {
    requested_action: assertNonEmptyString(raw.requested_action, `${fieldName}.requested_action`),
    non_executing: true,
    review_required_from: assertFlexibleParticipantArray(raw.review_required_from, `${fieldName}.review_required_from`),
    evidence: Array.isArray(raw.evidence) ? raw.evidence.map((item, index) => assertObject(item, `${fieldName}.evidence[${index}]`)) : []
  };
}

function assertActivationDismissedPayload(value, fieldName) {
  const raw = assertPlainOptionalObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["reason", "suppress_until"]);
  return {
    reason: assertNonEmptyString(raw.reason, `${fieldName}.reason`),
    suppress_until: raw.suppress_until == null ? {} : assertObject(raw.suppress_until, `${fieldName}.suppress_until`)
  };
}

export function assertEffectTarget(type, value, fieldName = "target") {
  switch (type) {
    case "relationship_added":
    case "relationship_removed":
      return assertRelationshipEffectTarget(value, fieldName);
    case "activation_proposed":
    case "activation_candidate_dismissed":
    case "phase_deferred":
      return assertPlanPhaseTarget(value, fieldName);
    case "approval_recorded":
    case "approval_withdrawn":
    case "objection_raised":
      return assertApprovalTarget(value, fieldName);
    case "review_requested":
      return assertReviewTarget(value, fieldName);
    case "obligation_created":
    case "obligation_resolved":
    case "trigger_fired":
      return assertGenericBoardTarget(value, fieldName);
    default:
      return assertGenericBoardTarget(value, fieldName);
  }
}

export function assertEffectPayload(type, value, fieldName = "payload") {
  switch (type) {
    case "relationship_added":
      return assertKnownPayload(value, fieldName, ["reason", "correction_of", "replaces_relationship_id"]);
    case "relationship_removed":
      return assertRelationshipRemovedPayload(value, fieldName);
    case "activation_proposed":
      return assertActivationProposedPayload(value, fieldName);
    case "activation_candidate_dismissed":
      return assertActivationDismissedPayload(value, fieldName);
    case "review_requested":
      return assertKnownPayload(value, fieldName, ["title", "kind", "requested_decision", "due_at", "shepherd", "trigger", "source", "reason", "expected_disposition"]);
    case "approval_recorded":
    case "approval_withdrawn":
    case "objection_raised":
      return assertKnownPayload(value, fieldName, ["note", "reason", "carry_forward_from_version"]);
    case "decision_recorded":
      return assertKnownPayload(value, fieldName, ["decision", "note", "reason"]);
    case "trigger_fired":
      return assertKnownPayload(value, fieldName, ["trigger_id", "source_event_type", "source_obligation_id", "action_type", "created_obligation_id", "created_effect_id", "result", "skipped", "reason"]);
    case "phase_deferred":
      return assertKnownPayload(value, fieldName, ["reason", "activation_conditions", "review_trigger", "non_executing"]);
    case "hitl_input_recorded":
      return assertKnownPayload(value, fieldName, ["decision", "summary", "required_from", "requested_decision", "source", "resolved_obligation_id"]);
    case "plan_lifecycle_transitioned":
      return assertKnownPayload(value, fieldName, ["action", "from_status", "to_status", "reason", "note", "decision", "disposition", "phase_id", "obligation_id", "hitl_input_effect_id", "previous_required_reviewers", "required_reviewers", "human_reviewer", "attested_by", "summary", "source"]);
    default:
      return assertPlainOptionalObject(value, fieldName);
  }
}

export function assertObligationTarget(type, value, fieldName = "target") {
  const raw = assertObject(value, fieldName);
  if (type === "notify_human") {
    assertAllowedKeys(raw, fieldName, ["checkpoint_id", "phase_id", "plan_id", "artifact_id", "artifact_version", "review_required_from", "requested_decision", "due_at"]);
    return {
      checkpoint_id: assertRecordId(raw.checkpoint_id, `${fieldName}.checkpoint_id`),
      phase_id: raw.phase_id == null ? assertRecordId(raw.checkpoint_id, `${fieldName}.checkpoint_id`) : assertRecordId(raw.phase_id, `${fieldName}.phase_id`),
      plan_id: assertRecordId(raw.plan_id, `${fieldName}.plan_id`),
      artifact_id: assertRecordId(raw.artifact_id, `${fieldName}.artifact_id`),
      artifact_version: assertPositiveInteger(raw.artifact_version, `${fieldName}.artifact_version`),
      review_required_from: assertFlexibleParticipant(raw.review_required_from, `${fieldName}.review_required_from`),
      requested_decision: assertNonEmptyString(raw.requested_decision, `${fieldName}.requested_decision`),
      due_at: raw.due_at == null ? null : assertIsoTimestamp(raw.due_at, `${fieldName}.due_at`)
    };
  }
  if (type === "review" || type === "approve_or_object") {
    return assertReviewTarget(raw, fieldName);
  }
  if (type === "implement_phase" || type === "validate_activation") {
    return assertPlanPhaseTarget(raw, fieldName);
  }
  if (type === "record_hitl_input") {
    assertAllowedKeys(raw, fieldName, ["phase_id", "plan_id", "artifact_id", "artifact_version", "review_required_from", "requested_decision"]);
    return {
      phase_id: assertRecordId(raw.phase_id, `${fieldName}.phase_id`),
      plan_id: assertRecordId(raw.plan_id, `${fieldName}.plan_id`),
      artifact_id: assertRecordId(raw.artifact_id, `${fieldName}.artifact_id`),
      artifact_version: assertPositiveInteger(raw.artifact_version, `${fieldName}.artifact_version`),
      review_required_from: assertFlexibleParticipant(raw.review_required_from, `${fieldName}.review_required_from`),
      requested_decision: assertNonEmptyString(raw.requested_decision, `${fieldName}.requested_decision`)
    };
  }
  if (type === "resolve_objection") {
    return assertGenericBoardTarget(raw, fieldName);
  }
  if (type === "report_status") {
    assertAllowedKeys(raw, fieldName, ["note", "summary", "status", "object_id", "artifact_id", "artifact_version", "plan_id", "phase_id"]);
    return { ...raw };
  }
  return assertGenericBoardTarget(raw, fieldName);
}

export function assertSubjectRef(value, fieldName = "subject_ref") {
  if (value == null) return null;
  const raw = assertObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["kind", "id", "object_id", "artifact_id", "artifact_version", "plan_id", "phase_id", "checkpoint_id", "obligation_id", "thread_id", "message_id"]);
  const kind = assertNonEmptyString(raw.kind, `${fieldName}.kind`);
  const validated = { kind };
  if (raw.id != null) validated.id = assertRecordId(raw.id, `${fieldName}.id`);
  for (const key of ["object_id", "artifact_id", "plan_id", "phase_id", "checkpoint_id", "obligation_id"]) {
    const normalized = assertBoardScopedRefId(raw, key, fieldName);
    if (normalized != null) validated[key] = normalized;
  }
  if (raw.artifact_version != null) validated.artifact_version = assertPositiveInteger(raw.artifact_version, `${fieldName}.artifact_version`);
  if (raw.thread_id != null) validated.thread_id = assertRecordId(raw.thread_id, `${fieldName}.thread_id`);
  if (raw.message_id != null) validated.message_id = assertRecordId(raw.message_id, `${fieldName}.message_id`);
  return validated;
}

function assertTriggerSource(value, fieldName = "source") {
  const raw = assertObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["event_type", "eventType", "obligation_id", "obligationId", "obligation_template_id", "obligationTemplateId", "subject_ref", "subjectRef"]);
  return {
    event_type: assertEnum(raw.event_type ?? raw.eventType, TRIGGER_EVENT_TYPES, `${fieldName}.event_type`),
    obligation_id: (raw.obligation_id ?? raw.obligationId) == null ? null : assertRecordId(raw.obligation_id ?? raw.obligationId, `${fieldName}.obligation_id`),
    obligation_template_id: (raw.obligation_template_id ?? raw.obligationTemplateId) == null ? null : assertRecordId(raw.obligation_template_id ?? raw.obligationTemplateId, `${fieldName}.obligation_template_id`),
    subject_ref: assertSubjectRef(raw.subject_ref ?? raw.subjectRef, `${fieldName}.subject_ref`)
  };
}

function assertTriggerCondition(value, fieldName = "condition") {
  const raw = assertPlainOptionalObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["obligation_resolution_in", "obligationResolutionIn", "subject_status_in", "subjectStatusIn", "required_subject_kind", "requiredSubjectKind"]);
  return {
    obligation_resolution_in: assertOptionalEnumArray(raw.obligation_resolution_in ?? raw.obligationResolutionIn, OBLIGATION_RESOLUTIONS, `${fieldName}.obligation_resolution_in`),
    subject_status_in: (raw.subject_status_in ?? raw.subjectStatusIn) == null ? [] : assertStringArray(raw.subject_status_in ?? raw.subjectStatusIn, `${fieldName}.subject_status_in`),
    required_subject_kind: assertOptionalString(raw.required_subject_kind ?? raw.requiredSubjectKind, `${fieldName}.required_subject_kind`)
  };
}

function assertTriggerAction(value, fieldName = "action") {
  const raw = assertObject(value, fieldName);
  const type = assertEnum(raw.type, TRIGGER_ACTION_TYPES, `${fieldName}.type`);
  if (type === "create_obligation") {
    const obligation = assertObject(raw.obligation, `${fieldName}.obligation`);
    const obligationType = obligation.type ?? obligation.obligation_type ?? obligation.obligationType;
    return {
      type,
      obligation: {
        obligation_id: (obligation.obligation_id ?? obligation.obligationId) == null ? null : assertRecordId(obligation.obligation_id ?? obligation.obligationId, `${fieldName}.obligation.obligation_id`),
        template_id: (obligation.template_id ?? obligation.templateId) == null ? null : assertRecordId(obligation.template_id ?? obligation.templateId, `${fieldName}.obligation.template_id`),
        agent: assertBoardAgentId(obligation.agent, `${fieldName}.obligation.agent`),
        type: assertEnum(obligationType, OBLIGATION_TYPES, `${fieldName}.obligation.type`),
        status: assertEnum(obligation.status ?? "active", OBLIGATION_STATUSES, `${fieldName}.obligation.status`),
        target: assertObligationTarget(obligationType, obligation.target ?? {}, `${fieldName}.obligation.target`),
        scope: assertOptionalString(obligation.scope, `${fieldName}.obligation.scope`),
        reason: assertOptionalString(obligation.reason, `${fieldName}.obligation.reason`),
        on_resolve_trigger_ids: assertRecordIdArray(obligation.on_resolve_trigger_ids ?? obligation.onResolveTriggerIds, `${fieldName}.obligation.on_resolve_trigger_ids`)
      }
    };
  }
  const effect = assertObject(raw.effect, `${fieldName}.effect`);
  const effectType = assertEnum(effect.type, EFFECT_TYPES, `${fieldName}.effect.type`);
  return {
    type,
    effect: {
      effect_id: (effect.effect_id ?? effect.effectId) == null ? null : assertRecordId(effect.effect_id ?? effect.effectId, `${fieldName}.effect.effect_id`),
      type: effectType,
      target: assertEffectTarget(effectType, effect.target ?? {}, `${fieldName}.effect.target`),
      payload: assertEffectPayload(effectType, effect.payload ?? {}, `${fieldName}.effect.payload`)
    }
  };
}

export function assertTriggerRecord(record) {
  const raw = assertObject(record, "trigger record");
  return {
    board_id: assertBoardId(raw.board_id),
    trigger_id: assertRecordId(raw.trigger_id, "trigger_id"),
    title: assertNonEmptyString(raw.title, "title"),
    status: assertEnum(raw.status ?? "active", TRIGGER_STATUSES, "status"),
    source: assertTriggerSource(raw.source, "source"),
    condition: assertTriggerCondition(raw.condition ?? {}, "condition"),
    action: assertTriggerAction(raw.action, "action"),
    fire_policy: assertEnum(raw.fire_policy ?? raw.firePolicy ?? "once", TRIGGER_FIRE_POLICIES, "fire_policy"),
    created_at: assertIsoTimestamp(raw.created_at, "created_at"),
    updated_at: assertIsoTimestamp(raw.updated_at, "updated_at")
  };
}

function assertStringArray(value, fieldName) {
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);
  return value.map((item, index) => assertNonEmptyString(item, `${fieldName}[${index}]`));
}

function assertOptionalStringArray(value, fieldName) {
  if (value == null) return [];
  return assertStringArray(value, fieldName);
}

function assertOptionalBoolean(value, fieldName, fallback = false) {
  if (value == null) return fallback;
  if (typeof value !== "boolean") throw new Error(`${fieldName} must be a boolean`);
  return value;
}

function assertObligationExecutionPolicy(value, fieldName = "executionPolicy") {
  if (value == null) return null;
  const raw = assertObject(value, fieldName);
  return {
    autonomy: assertEnum(raw.autonomy ?? "inform", OBLIGATION_EXECUTION_AUTONOMY, `${fieldName}.autonomy`),
    allowedActions: assertOptionalStringArray(raw.allowedActions ?? raw.allowed_actions, `${fieldName}.allowedActions`),
    allowedLifecycleCommands: assertOptionalStringArray(raw.allowedLifecycleCommands ?? raw.allowed_lifecycle_commands, `${fieldName}.allowedLifecycleCommands`),
    defaultAction: assertOptionalString(raw.defaultAction ?? raw.default_action, `${fieldName}.defaultAction`),
    requiresReason: assertOptionalBoolean(raw.requiresReason ?? raw.requires_reason, `${fieldName}.requiresReason`, false),
    activationPolicyMode: assertOptionalString(raw.activationPolicyMode ?? raw.activation_policy_mode, `${fieldName}.activationPolicyMode`),
    guidance: assertOptionalString(raw.guidance, `${fieldName}.guidance`)
  };
}

export function assertBoardAgentRecord(record, fieldName = "agent") {
  const raw = assertObject(record, fieldName);
  return {
    board_agent_id: assertBoardAgentId(raw.board_agent_id, `${fieldName}.board_agent_id`),
    global_agent_id: assertOptionalString(raw.global_agent_id ?? raw.globalAgentId, `${fieldName}.global_agent_id`),
    display_name: assertOptionalString(raw.display_name, `${fieldName}.display_name`),
    kind: assertOptionalString(raw.kind, `${fieldName}.kind`) ?? "agent",
    runtime_refs: assertRuntimeRefs(raw.runtime_refs ?? [], `${fieldName}.runtime_refs`),
    roles: assertOptionalStringArray(raw.roles, `${fieldName}.roles`),
    permissions: raw.permissions && typeof raw.permissions === "object" && !Array.isArray(raw.permissions)
      ? raw.permissions
      : { preset: "board_admin" }
  };
}

export function assertArtifactRecord(record) {
  const raw = assertObject(record, "artifact record");
  const validated = {
    board_id: assertBoardId(raw.board_id),
    artifact_id: assertRecordId(raw.artifact_id, "artifact_id"),
    kind: assertEnum(raw.kind, ARTIFACT_KINDS, "kind"),
    storage_mode: assertEnum(raw.storage_mode, ARTIFACT_STORAGE_MODES, "storage_mode"),
    uri: assertOptionalString(raw.uri, "uri"),
    version: raw.version == null ? 1 : raw.version,
    status: assertEnum(raw.status ?? "draft", COORDINATION_STATUSES, "status"),
    title: assertOptionalString(raw.title, "title"),
    content_hash: assertOptionalString(raw.content_hash, "content_hash"),
    landing_root: assertOptionalString(raw.landing_root, "landing_root"),
    resolved_path: assertOptionalString(raw.resolved_path, "resolved_path"),
    created_at: assertIsoTimestamp(raw.created_at, "created_at"),
    updated_at: assertIsoTimestamp(raw.updated_at, "updated_at")
  };
  if (!Number.isInteger(validated.version) || validated.version < 1) {
    throw new Error("version must be a positive integer");
  }
  if (validated.uri == null && validated.resolved_path == null) {
    throw new Error("artifact record requires uri or resolved_path");
  }
  return validated;
}

export function assertCoordinationObjectRecord(record) {
  const raw = assertObject(record, "coordination object record");
  return {
    board_id: assertBoardId(raw.board_id),
    object_id: assertRecordId(raw.object_id, "object_id"),
    kind: assertEnum(raw.kind, COORDINATION_OBJECT_KINDS, "kind"),
    title: assertNonEmptyString(raw.title, "title"),
    status: assertEnum(raw.status ?? "draft", COORDINATION_STATUSES, "status"),
    artifact_ref: raw.artifact_ref == null ? null : assertArtifactRecordRef(raw.artifact_ref, "artifact_ref"),
    participants: assertOptionalStringArray(raw.participants, "participants"),
    created_at: assertIsoTimestamp(raw.created_at, "created_at"),
    updated_at: assertIsoTimestamp(raw.updated_at, "updated_at")
  };
}

export function assertEffectRecord(record) {
  const raw = assertObject(record, "effect record");
  const type = assertEnum(raw.type, EFFECT_TYPES, "type");
  return {
    board_id: assertBoardId(raw.board_id),
    effect_id: assertRecordId(raw.effect_id, "effect_id"),
    type,
    actor: assertActorRecord(raw.actor, "actor"),
    target: assertEffectTarget(type, raw.target ?? {}, "target"),
    payload: assertEffectPayload(type, raw.payload ?? {}, "payload"),
    source_thread_id: assertOptionalString(raw.source_thread_id, "source_thread_id"),
    source_message_id: assertOptionalString(raw.source_message_id, "source_message_id"),
    created_at: assertIsoTimestamp(raw.created_at, "created_at")
  };
}

function assertManagedBinding(value, fieldName = "managedBinding") {
  if (value == null) return null;
  const raw = assertObject(value, fieldName);
  const system = assertNonEmptyString(raw.system, `${fieldName}.system`);
  if (system !== "plan_lifecycle") throw new Error(`${fieldName}.system must be plan_lifecycle`);
  return {
    system,
    plan_id: assertRecordId(raw.plan_id ?? raw.planId, `${fieldName}.plan_id`),
    role: assertNonEmptyString(raw.role, `${fieldName}.role`),
    revision: raw.revision == null ? null : assertNonNegativeInteger(raw.revision, `${fieldName}.revision`),
    phase_id: (raw.phase_id ?? raw.phaseId) == null ? null : assertRecordId(raw.phase_id ?? raw.phaseId, `${fieldName}.phase_id`)
  };
}

export function assertObligationRecord(record) {
  const raw = assertObject(record, "obligation record");
  const type = assertEnum(raw.type, OBLIGATION_TYPES, "type");
  return {
    board_id: assertBoardId(raw.board_id),
    obligation_id: assertRecordId(raw.obligation_id, "obligation_id"),
    agent: assertBoardAgentId(raw.agent, "agent"),
    type,
    template_id: raw.template_id == null ? null : assertRecordId(raw.template_id, "template_id"),
    status: assertEnum(raw.status ?? "active", OBLIGATION_STATUSES, "status"),
    resolution: raw.resolution == null ? null : assertEnum(raw.resolution, OBLIGATION_RESOLUTIONS, "resolution"),
    resolution_note: assertOptionalString(raw.resolution_note, "resolution_note"),
    resolved_at: raw.resolved_at == null ? null : assertIsoTimestamp(raw.resolved_at, "resolved_at"),
    target: assertObligationTarget(type, raw.target ?? {}, "target"),
    scope: assertOptionalString(raw.scope, "scope"),
    reason: assertOptionalString(raw.reason, "reason"),
    source_effect_id: assertOptionalString(raw.source_effect_id, "source_effect_id"),
    managedBinding: assertManagedBinding(raw.managedBinding ?? raw.managed_binding, "managedBinding"),
    executionPolicy: assertObligationExecutionPolicy(raw.executionPolicy ?? raw.execution_policy, "executionPolicy"),
    on_resolve_trigger_ids: assertRecordIdArray(raw.on_resolve_trigger_ids, "on_resolve_trigger_ids"),
    created_at: assertIsoTimestamp(raw.created_at, "created_at"),
    updated_at: assertIsoTimestamp(raw.updated_at, "updated_at")
  };
}

export function assertRelationshipRef(value, fieldName = "relationship_ref") {
  const raw = assertObject(value, fieldName);
  const version = raw.version == null ? null : raw.version;
  if (version != null && (!Number.isInteger(version) || version < 1)) {
    throw new Error(`${fieldName}.version must be a positive integer`);
  }
  return {
    kind: assertEnum(raw.kind, RELATIONSHIP_REF_KINDS, `${fieldName}.kind`),
    id: assertRecordId(raw.id, `${fieldName}.id`),
    version
  };
}

export function assertRelationshipRecord(record) {
  const raw = assertObject(record, "relationship record");
  return {
    board_id: assertBoardId(raw.board_id),
    relationship_id: assertRecordId(raw.relationship_id, "relationship_id"),
    type: assertEnum(raw.type, RELATIONSHIP_TYPES, "type"),
    from: assertRelationshipRef(raw.from, "from"),
    to: assertRelationshipRef(raw.to, "to"),
    status: assertEnum(raw.status ?? "active", RELATIONSHIP_STATUSES, "status"),
    actor: assertActorRecord(raw.actor, "actor"),
    reason: assertOptionalString(raw.reason, "reason"),
    source_effect_id: assertOptionalString(raw.source_effect_id, "source_effect_id"),
    removed_effect_id: assertOptionalString(raw.removed_effect_id, "removed_effect_id"),
    removed_at: raw.removed_at == null ? null : assertIsoTimestamp(raw.removed_at, "removed_at"),
    correction_of: raw.correction_of == null ? null : assertRecordId(raw.correction_of, "correction_of"),
    replaces_relationship_id: raw.replaces_relationship_id == null ? null : assertRecordId(raw.replaces_relationship_id, "replaces_relationship_id"),
    created_at: assertIsoTimestamp(raw.created_at, "created_at"),
    updated_at: assertIsoTimestamp(raw.updated_at, "updated_at")
  };
}

export function assertProjectionCheckpointRecord(record) {
  const raw = assertObject(record, "projection checkpoint record");
  return {
    board_id: assertBoardId(raw.board_id),
    board_agent_id: assertBoardAgentId(raw.board_agent_id),
    projection_type: assertEnum(raw.projection_type, PROJECTION_TYPES, "projection_type"),
    cursor: assertObject(raw.cursor, "cursor"),
    last_seen_at: assertIsoTimestamp(raw.last_seen_at, "last_seen_at"),
    last_seen_by_runtime_ref: assertRuntimeRef(raw.last_seen_by_runtime_ref, "last_seen_by_runtime_ref"),
    created_at: assertIsoTimestamp(raw.created_at, "created_at"),
    updated_at: assertIsoTimestamp(raw.updated_at, "updated_at")
  };
}
