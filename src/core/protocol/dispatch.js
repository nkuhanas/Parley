import { listThreadMessages, loadMessageRecord, loadThreadRecord, saveThreadRecord, updateMessageTransport } from "../storage/store.js";
import { buildTransportRequest } from "./transport.js";
import { nowIso } from "../time.js";
import { getOpenClawGatewayCaller } from "../../adapters/openclaw/gateway.js";

const DEFAULT_SEND_TIMEOUT_MS = 30000;

export function normalizeDispatchTimeoutMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SEND_TIMEOUT_MS;
  }
  return Math.max(1000, Math.floor(value));
}

async function assertLatestDispatchableMessage(pluginConfig, threadId, message) {
  if (message.transport_state !== "pending_dispatch") {
    throw new Error(`message transport is not dispatchable from state ${message.transport_state}`);
  }

  const threadMessages = await listThreadMessages(pluginConfig, threadId);
  const latestMessage = threadMessages.at(-1) ?? null;
  if (!latestMessage) {
    throw new Error(`thread has no messages: ${threadId}`);
  }

  if (latestMessage.message_id !== message.message_id) {
    throw new Error("only the latest thread message may be dispatched");
  }
}

function extractTransportMessageRef(result) {
  if (!result || typeof result !== "object") return null;
  if (typeof result.runId === "string" && result.runId.trim()) return result.runId.trim();
  if (typeof result.messageId === "string" && result.messageId.trim()) return result.messageId.trim();
  if (typeof result.id === "string" && result.id.trim()) return result.id.trim();
  return null;
}

function normalizeTransportError(error) {
  const code = typeof error?.code === "string" && error.code.trim() ? error.code.trim() : "SESSIONS_SEND_FAILED";
  const message = typeof error?.message === "string" && error.message.trim()
    ? error.message.trim()
    : typeof error === "string" && error.trim()
      ? error.trim()
      : "sessions.send failed";
  return { code, message };
}

export async function prepareTransportDispatchRequest(pluginConfig, { threadId, messageId, notePrefix = null }) {
  const normalizedThreadId = typeof threadId === "string" && threadId.trim() ? threadId.trim() : null;
  const normalizedMessageId = typeof messageId === "string" && messageId.trim() ? messageId.trim() : null;
  if (!normalizedThreadId) throw new Error("threadId required");
  if (!normalizedMessageId) throw new Error("messageId required");

  const thread = await loadThreadRecord(pluginConfig, normalizedThreadId);
  if (!thread) {
    throw new Error(`thread not found: ${normalizedThreadId}`);
  }

  const message = await loadMessageRecord(pluginConfig, normalizedThreadId, normalizedMessageId);
  if (!message) {
    throw new Error(`message not found: ${normalizedMessageId}`);
  }

  if (message.transport_state === "accepted") {
    return {
      thread,
      message,
      transport_required: false,
      dispatch_status: "already_accepted",
      note: notePrefix == null
        ? "Parley transport was already accepted in canonical state."
        : `${notePrefix} Transport was already accepted in canonical state.`
    };
  }

  await assertLatestDispatchableMessage(pluginConfig, normalizedThreadId, message);
  return {
    thread,
    message,
    transport_required: true,
    transport_request: buildTransportRequest({ thread, message }),
    note: notePrefix == null
      ? "Parley transport handoff is ready for caller-managed dispatch."
      : `${notePrefix} Transport handoff is ready for caller-managed dispatch.`
  };
}

export async function dispatchTransportRequest(api, { threadId, messageId, timeoutMs, notePrefix = null }) {
  const normalizedThreadId = typeof threadId === "string" && threadId.trim() ? threadId.trim() : null;
  const normalizedMessageId = typeof messageId === "string" && messageId.trim() ? messageId.trim() : null;
  if (!normalizedThreadId) throw new Error("threadId required");
  if (!normalizedMessageId) throw new Error("messageId required");

  const normalizedTimeoutMs = normalizeDispatchTimeoutMs(timeoutMs);
  const prepared = await prepareTransportDispatchRequest(api.pluginConfig, {
    threadId: normalizedThreadId,
    messageId: normalizedMessageId,
    notePrefix
  });
  const { thread, message } = prepared;

  if (prepared.transport_required === false) {
    return prepared;
  }

  const expectedRequest = prepared.transport_request;

  const attemptedAt = nowIso();
  await updateMessageTransport(api.pluginConfig, normalizedThreadId, normalizedMessageId, {
    transport_state: "pending_dispatch",
    transport_target_session_key: expectedRequest.target_session_key,
    transport_idempotency_key: expectedRequest.idempotency_key,
    transport_message_ref: null,
    transport_error: null,
    transport_attempted_at: attemptedAt,
    transport_accepted_at: null
  });

  const gatewayCall = await getOpenClawGatewayCaller(api.callGateway);

  try {
    const dispatchResult = await gatewayCall({
      method: "sessions.send",
      params: {
        key: expectedRequest.target_session_key,
        message: expectedRequest.outbound_text,
        idempotencyKey: expectedRequest.idempotency_key,
        timeoutMs: normalizedTimeoutMs
      },
      timeoutMs: normalizedTimeoutMs
    });

    const acceptedAt = nowIso();
    const updatedThread = await saveThreadRecord(api.pluginConfig, {
      ...thread,
      updated_at: acceptedAt
    });
    const updatedMessage = await updateMessageTransport(api.pluginConfig, normalizedThreadId, normalizedMessageId, {
      transport_state: "accepted",
      transport_target_session_key: expectedRequest.target_session_key,
      transport_idempotency_key: expectedRequest.idempotency_key,
      transport_message_ref: extractTransportMessageRef(dispatchResult),
      transport_error: null,
      transport_attempted_at: attemptedAt,
      transport_accepted_at: acceptedAt
    });

    return {
      thread: updatedThread,
      message: updatedMessage,
      transport_required: false,
      dispatch_status: "accepted",
      dispatch_result: dispatchResult ?? null,
      note: notePrefix == null
        ? "Parley transport dispatched through sessions.send and canonical state was updated."
        : `${notePrefix} Transport dispatched through sessions.send and canonical state was updated.`
    };
  } catch (error) {
    const normalizedError = normalizeTransportError(error);
    const failedAt = nowIso();
    const updatedThread = await saveThreadRecord(api.pluginConfig, {
      ...thread,
      updated_at: failedAt
    });
    const updatedMessage = await updateMessageTransport(api.pluginConfig, normalizedThreadId, normalizedMessageId, {
      transport_state: "failed",
      transport_target_session_key: expectedRequest.target_session_key,
      transport_idempotency_key: expectedRequest.idempotency_key,
      transport_message_ref: null,
      transport_error: normalizedError,
      transport_attempted_at: attemptedAt,
      transport_accepted_at: null
    });

    return {
      thread: updatedThread,
      message: updatedMessage,
      transport_required: false,
      dispatch_status: "failed",
      error: normalizedError,
      note: notePrefix == null
        ? "Parley transport dispatch failed and canonical state was updated."
        : `${notePrefix} Transport dispatch failed and canonical state was updated.`
    };
  }
}
