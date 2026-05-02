import { buildParleyProtocolEnvelope, renderParleyOutboundText, renderParleyProtocolBlock } from "./render.js";

function normalizeTransportLabel(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "agent_sessions_send";
}

function normalizeTransportCorrelation(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function readLegacyTargetSessionKey(correlation) {
  return typeof correlation?.targetSessionKey === "string" && correlation.targetSessionKey.trim()
    ? correlation.targetSessionKey.trim()
    : null;
}

function readParticipantSessionKeys(correlation) {
  const value = correlation?.participantSessionKeys;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const normalized = {};
  for (const [participant, sessionKey] of Object.entries(value)) {
    if (typeof participant !== "string" || !participant.trim()) continue;
    if (typeof sessionKey !== "string" || !sessionKey.trim()) continue;
    normalized[participant.trim()] = sessionKey.trim();
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function readInitiatorSessionKey(correlation) {
  return typeof correlation?.initiatorSessionKey === "string" && correlation.initiatorSessionKey.trim()
    ? correlation.initiatorSessionKey.trim()
    : null;
}

function resolveCounterpartyParticipant(thread, message) {
  if (message.sender === thread.initiator) return thread.recipient;
  if (message.sender === thread.recipient) return thread.initiator;
  throw new Error("message sender must be one of the two active thread participants");
}

function resolveTargetSessionKey({ thread, message, correlation }) {
  const participantSessionKeys = readParticipantSessionKeys(correlation);
  const counterparty = resolveCounterpartyParticipant(thread, message);
  const mappedSessionKey = participantSessionKeys?.[counterparty] ?? null;
  if (mappedSessionKey) return mappedSessionKey;

  if (message.sender === thread.initiator) {
    return readLegacyTargetSessionKey(correlation);
  }

  return readInitiatorSessionKey(correlation);
}

export function buildTransportIdempotencyKey({ threadId, messageId }) {
  return `parley:${threadId}:${messageId}`;
}

export function buildTransportPreview({ thread, message }) {
  const correlation = normalizeTransportCorrelation(thread.transport_correlation);
  const targetSessionKey = resolveTargetSessionKey({ thread, message, correlation });
  return {
    mode: "preview_only",
    native_send_supported: false,
    transport: normalizeTransportLabel(thread.transport),
    correlation,
    targetSessionKey,
    protocol_envelope: buildParleyProtocolEnvelope({ thread, message }),
    protocol_block: renderParleyProtocolBlock({ thread, message }),
    outbound_text: renderParleyOutboundText({ thread, message })
  };
}

export function buildPendingTransportMetadata({ thread, message }) {
  const preview = buildTransportPreview({ thread, message });
  const targetSessionKey = preview.targetSessionKey;
  if (!targetSessionKey) {
    throw new Error("Parley transport target session key is required for the message counterparty");
  }

  return {
    transport_state: "pending_dispatch",
    transport_target_session_key: targetSessionKey,
    transport_idempotency_key: buildTransportIdempotencyKey({
      threadId: thread.thread_id,
      messageId: message.message_id
    }),
    transport_message_ref: null,
    transport_error: null,
    transport_attempted_at: null,
    transport_accepted_at: null
  };
}

export function buildTransportRequest({ thread, message }) {
  const preview = buildTransportPreview({ thread, message });
  const targetSessionKey = preview.targetSessionKey;
  if (!targetSessionKey) {
    throw new Error("Parley transport target session key is required for the message counterparty");
  }

  return {
    mode: "agent_sessions_send",
    target_session_key: targetSessionKey,
    outbound_text: preview.outbound_text,
    idempotency_key: buildTransportIdempotencyKey({
      threadId: thread.thread_id,
      messageId: message.message_id
    }),
    canonical_thread_id: thread.thread_id,
    canonical_message_id: message.message_id
  };
}
