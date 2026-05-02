import { isIsoTimestamp } from "./time.js";

export const THREAD_KINDS = Object.freeze(["coordination", "decision", "incident", "status"]);
export const CONTROL_MODES = Object.freeze(["peer", "directed"]);
export const ORIGIN_KINDS = Object.freeze(["human", "agent", "system"]);
export const REPORT_BACK_POLICIES = Object.freeze(["none", "summary_to_human"]);
export const HUMAN_SUMMARY_ANCHOR_STATUSES = Object.freeze(["not_required", "pending_send", "recorded", "failed"]);
export const SETTLING_MARKERS = Object.freeze(["turn_complete", "turn_pass", "decision_escalate", "thread_conclude"]);
export const CONTROL_MARKERS = Object.freeze(["claim_turn", "probe", ...SETTLING_MARKERS]);
export const MESSAGE_CLASSES = Object.freeze(["control", "substantive", "settling"]);
export const THREAD_STATES = Object.freeze([
  "active",
  "awaiting_next_action",
  "awaiting_decision",
  "concluded",
  "failed"
]);
export const TRANSPORT_STATES = Object.freeze(["not_required", "pending_dispatch", "accepted", "failed"]);

const TERMINAL_THREAD_STATES = new Set(["concluded", "failed"]);

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} required`);
  }
  return value.trim();
}

function assertOptionalString(value, fieldName) {
  if (value == null) return value;
  return assertNonEmptyString(value, fieldName);
}

function assertEnum(value, allowedValues, fieldName) {
  const normalized = assertNonEmptyString(value, fieldName);
  if (!allowedValues.includes(normalized)) {
    throw new Error(`${fieldName} must be one of: ${allowedValues.join(", ")}`);
  }
  return normalized;
}

function assertIsoTimestamp(value, fieldName) {
  const normalized = assertNonEmptyString(value, fieldName);
  if (!isIsoTimestamp(normalized)) {
    throw new Error(`${fieldName} must be an ISO timestamp`);
  }
  return normalized;
}

function assertOptionalIsoTimestamp(value, fieldName) {
  if (value == null) return null;
  return assertIsoTimestamp(value, fieldName);
}

function assertBoolean(value, fieldName) {
  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean`);
  }
  return value;
}

function assertTransportError(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  return {
    code: assertNonEmptyString(value.code, `${fieldName}.code`),
    message: assertNonEmptyString(value.message, `${fieldName}.message`)
  };
}

function assertOptionalTransportError(value, fieldName) {
  if (value == null) return null;
  return assertTransportError(value, fieldName);
}

function assertHumanSummaryAnchor(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  return {
    message_id: assertNonEmptyString(value.message_id, `${fieldName}.message_id`),
    channel: assertOptionalString(value.channel, `${fieldName}.channel`) ?? null,
    channel_id: assertOptionalString(value.channel_id, `${fieldName}.channel_id`) ?? null,
    target: assertOptionalString(value.target, `${fieldName}.target`) ?? null,
    account_id: assertOptionalString(value.account_id, `${fieldName}.account_id`) ?? null,
    transport_message_ref: assertOptionalString(value.transport_message_ref, `${fieldName}.transport_message_ref`) ?? null,
    created_at: assertOptionalIsoTimestamp(value.created_at, `${fieldName}.created_at`)
  };
}

function assertOptionalHumanSummaryAnchor(value, fieldName) {
  if (value == null) return null;
  return assertHumanSummaryAnchor(value, fieldName);
}

function assertTransportCorrelation(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  const allowedKeys = new Set(["targetSessionKey", "initiatorSessionKey", "participantSessionKeys"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new Error(`${fieldName}.${key} is not allowed`);
  }
  const validated = {};
  for (const key of ["targetSessionKey", "initiatorSessionKey"]) {
    if (value[key] != null) validated[key] = assertNonEmptyString(value[key], `${fieldName}.${key}`);
  }
  if (value.participantSessionKeys != null) {
    if (!value.participantSessionKeys || typeof value.participantSessionKeys !== "object" || Array.isArray(value.participantSessionKeys)) {
      throw new Error(`${fieldName}.participantSessionKeys must be an object`);
    }
    validated.participantSessionKeys = Object.fromEntries(
      Object.entries(value.participantSessionKeys).map(([participant, sessionKey]) => [
        assertNonEmptyString(participant, `${fieldName}.participantSessionKeys participant`),
        assertNonEmptyString(sessionKey, `${fieldName}.participantSessionKeys.${participant}`)
      ])
    );
  }
  return validated;
}

function assertOptionalTransportCorrelation(value, fieldName) {
  if (value == null) return null;
  return assertTransportCorrelation(value, fieldName);
}

export function assertThreadKind(value) {
  return assertEnum(value, THREAD_KINDS, "kind");
}

export function assertControlMode(value) {
  return assertEnum(value, CONTROL_MODES, "control_mode");
}

export function assertThreadState(value) {
  const normalized = assertNonEmptyString(value, "thread_state");
  if (!THREAD_STATES.includes(normalized)) {
    throw new Error(`thread_state must be one of: ${THREAD_STATES.join(", ")}`);
  }
  return normalized;
}

export function assertOriginKind(value) {
  return assertEnum(value, ORIGIN_KINDS, "origin_kind");
}

export function assertReportBackPolicy(value) {
  return assertEnum(value, REPORT_BACK_POLICIES, "report_back_policy");
}

export function assertHumanSummaryAnchorStatus(value) {
  return assertEnum(value, HUMAN_SUMMARY_ANCHOR_STATUSES, "human_summary_anchor_status");
}

export function assertSettlingMarker(value) {
  return assertEnum(value, SETTLING_MARKERS, "control_marker");
}

export function assertControlMarker(value) {
  return assertEnum(value, CONTROL_MARKERS, "control_marker");
}

export function assertMessageClass(value) {
  return assertEnum(value, MESSAGE_CLASSES, "message_class");
}

export function assertTransportState(value) {
  return assertEnum(value, TRANSPORT_STATES, "transport_state");
}

export function assertDistinctParticipants(initiator, recipient) {
  const initiatorId = assertNonEmptyString(initiator, "initiator");
  const recipientId = assertNonEmptyString(recipient, "recipient");
  if (initiatorId === recipientId) {
    throw new Error("initiator and recipient must be distinct participants");
  }
  return { initiator: initiatorId, recipient: recipientId };
}

export function assertThreadRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("thread record must be an object");
  }

  const { initiator, recipient } = assertDistinctParticipants(record.initiator, record.recipient);
  const validated = {
    thread_id: assertNonEmptyString(record.thread_id, "thread_id"),
    kind: assertThreadKind(record.kind),
    control_mode: assertControlMode(record.control_mode),
    initiator,
    recipient,
    origin_kind: record.origin_kind == null ? "agent" : assertOriginKind(record.origin_kind),
    report_back_policy: record.report_back_policy == null ? "none" : assertReportBackPolicy(record.report_back_policy),
    meaningful_turn_pending: assertBoolean(record.meaningful_turn_pending, "meaningful_turn_pending"),
    thread_state: assertThreadState(record.thread_state),
    created_at: assertIsoTimestamp(record.created_at, "created_at"),
    updated_at: assertIsoTimestamp(record.updated_at, "updated_at")
  };

  if (record.next_action_owner == null) {
    validated.next_action_owner = null;
  } else {
    validated.next_action_owner = assertNonEmptyString(record.next_action_owner, "next_action_owner");
  }

  if (TERMINAL_THREAD_STATES.has(validated.thread_state)) {
    if (validated.next_action_owner != null) {
      throw new Error("next_action_owner must be null for terminal thread_state values");
    }
    if (validated.meaningful_turn_pending !== false) {
      throw new Error("meaningful_turn_pending must be false for terminal thread_state values");
    }
  } else {
    if (validated.next_action_owner == null) {
      throw new Error("next_action_owner required for non-terminal thread_state values");
    }
    if (![initiator, recipient].includes(validated.next_action_owner)) {
      throw new Error("next_action_owner must be one of the two active participants");
    }
  }

  const lastSpeaker = record.last_speaker == null ? null : assertNonEmptyString(record.last_speaker, "last_speaker");
  if (lastSpeaker != null && ![initiator, recipient].includes(lastSpeaker)) {
    throw new Error("last_speaker must be one of the two active participants when present");
  }
  validated.last_speaker = lastSpeaker;

  validated.opened_by_action = assertOptionalString(record.opened_by_action, "opened_by_action");
  validated.transport = assertOptionalString(record.transport, "transport");
  validated.transport_correlation = assertOptionalTransportCorrelation(record.transport_correlation, "transport_correlation");
  validated.human_summary_anchor = assertOptionalHumanSummaryAnchor(record.human_summary_anchor, "human_summary_anchor");
  validated.human_summary_anchor_status = record.human_summary_anchor_status == null
    ? (validated.origin_kind === "human" && validated.report_back_policy === "summary_to_human"
      ? (validated.human_summary_anchor != null ? "recorded" : "pending_send")
      : "not_required")
    : assertHumanSummaryAnchorStatus(record.human_summary_anchor_status);
  validated.human_summary_anchor_request_text = record.human_summary_anchor_request_text == null
    ? null
    : assertNonEmptyString(record.human_summary_anchor_request_text, "human_summary_anchor_request_text");
  validated.probe_count = record.probe_count == null ? 0 : record.probe_count;
  validated.last_claimed_at = record.last_claimed_at == null ? null : assertIsoTimestamp(record.last_claimed_at, "last_claimed_at");
  validated.last_probe_at = record.last_probe_at == null ? null : assertIsoTimestamp(record.last_probe_at, "last_probe_at");
  validated.concluded_at = record.concluded_at == null ? null : assertIsoTimestamp(record.concluded_at, "concluded_at");
  validated.failure_reason = record.failure_reason == null ? null : assertNonEmptyString(record.failure_reason, "failure_reason");

  if (!Number.isInteger(validated.probe_count) || validated.probe_count < 0) {
    throw new Error("probe_count must be a non-negative integer");
  }

  if (validated.human_summary_anchor != null) {
    if (validated.origin_kind !== "human") {
      throw new Error("human_summary_anchor is only allowed for origin_kind = human");
    }
    if (validated.report_back_policy !== "summary_to_human") {
      throw new Error("human_summary_anchor is only allowed for report_back_policy = summary_to_human");
    }
  }

  const requiresHumanSummaryAnchor = validated.origin_kind === "human" && validated.report_back_policy === "summary_to_human";

  if (!requiresHumanSummaryAnchor) {
    if (validated.human_summary_anchor_status !== "not_required") {
      throw new Error("human_summary_anchor_status must be not_required unless origin_kind = human with report_back_policy = summary_to_human");
    }
    if (validated.human_summary_anchor_request_text != null) {
      throw new Error("human_summary_anchor_request_text is only allowed when origin_kind = human with report_back_policy = summary_to_human");
    }
  } else {
    if (validated.human_summary_anchor_status === "not_required") {
      throw new Error("human_summary_anchor_status must not be not_required for origin_kind = human with report_back_policy = summary_to_human");
    }

    if (validated.human_summary_anchor_status === "recorded" && validated.human_summary_anchor == null) {
      throw new Error("human_summary_anchor required when human_summary_anchor_status = recorded");
    }

    if (["pending_send", "failed"].includes(validated.human_summary_anchor_status) && validated.human_summary_anchor != null) {
      throw new Error(`human_summary_anchor must be null when human_summary_anchor_status = ${validated.human_summary_anchor_status}`);
    }

    if (validated.human_summary_anchor_status === "pending_send" && validated.human_summary_anchor_request_text == null) {
      throw new Error("human_summary_anchor_request_text required when human_summary_anchor_status = pending_send");
    }
  }

  return validated;
}

export function assertMessageRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("message record must be an object");
  }

  const transportState = record.transport_state == null
    ? record.transport_message_ref != null
      ? "accepted"
      : "not_required"
    : assertTransportState(record.transport_state);

  const validated = {
    message_id: assertNonEmptyString(record.message_id, "message_id"),
    thread_id: assertNonEmptyString(record.thread_id, "thread_id"),
    sender: assertNonEmptyString(record.sender, "sender"),
    message_class: assertMessageClass(record.message_class),
    body_text: assertOptionalString(record.body_text, "body_text") ?? null,
    next_action_owner: assertOptionalString(record.next_action_owner, "next_action_owner") ?? null,
    created_at: assertIsoTimestamp(record.created_at, "created_at"),
    transport_state: transportState,
    transport_target_session_key: assertOptionalString(record.transport_target_session_key, "transport_target_session_key") ?? null,
    transport_idempotency_key: assertOptionalString(record.transport_idempotency_key, "transport_idempotency_key") ?? null,
    transport_message_ref: record.transport_message_ref == null ? null : assertNonEmptyString(record.transport_message_ref, "transport_message_ref"),
    transport_error: assertOptionalTransportError(record.transport_error, "transport_error"),
    transport_attempted_at: assertOptionalIsoTimestamp(record.transport_attempted_at, "transport_attempted_at"),
    transport_accepted_at: assertOptionalIsoTimestamp(record.transport_accepted_at, "transport_accepted_at")
  };

  if (record.control_marker != null) {
    validated.control_marker = assertControlMarker(record.control_marker);
  } else {
    validated.control_marker = null;
  }

  if (validated.message_class === "settling" && validated.control_marker == null) {
    throw new Error("settling messages require a control_marker");
  }

  if (validated.message_class === "settling") {
    assertSettlingMarker(validated.control_marker);
  }

  if (validated.transport_state === "failed" && validated.transport_error == null) {
    throw new Error("failed transport_state requires transport_error");
  }

  if (validated.transport_state !== "failed" && validated.transport_error != null) {
    throw new Error("transport_error is only allowed for failed transport_state");
  }

  if (validated.transport_state === "pending_dispatch" && validated.transport_accepted_at != null) {
    throw new Error("pending_dispatch transport_state must not set transport_accepted_at");
  }

  if (validated.transport_state === "not_required") {
    if (validated.transport_target_session_key != null || validated.transport_idempotency_key != null) {
      throw new Error("not_required transport_state must not set transport target or idempotency fields");
    }
    if (validated.transport_attempted_at != null || validated.transport_accepted_at != null) {
      throw new Error("not_required transport_state must not set transport timestamps");
    }
  }

  if (["pending_dispatch", "accepted", "failed"].includes(validated.transport_state)) {
    if (validated.transport_target_session_key == null) {
      throw new Error(`${validated.transport_state} transport_state requires transport_target_session_key`);
    }
    if (validated.transport_idempotency_key == null) {
      throw new Error(`${validated.transport_state} transport_state requires transport_idempotency_key`);
    }
  }

  if (validated.transport_state === "accepted" && validated.transport_accepted_at == null && record.transport_state != null) {
    throw new Error("accepted transport_state requires transport_accepted_at");
  }

  return validated;
}

export function assertThreadStateTransition(currentState, nextState) {
  const current = assertThreadState(currentState);
  const next = assertThreadState(nextState);

  if (current === next) return next;
  if (TERMINAL_THREAD_STATES.has(current)) {
    throw new Error(`thread_state cannot transition from terminal state ${current} to ${next}`);
  }

  const allowedTransitions = {
    active: new Set(["awaiting_next_action", "awaiting_decision", "concluded", "failed"]),
    awaiting_next_action: new Set(["active", "awaiting_decision", "concluded", "failed"]),
    awaiting_decision: new Set(["active", "awaiting_next_action", "concluded", "failed"])
  };

  if (!allowedTransitions[current]?.has(next)) {
    throw new Error(`thread_state cannot transition from ${current} to ${next}`);
  }

  return next;
}
