import { saveMessageRecord, saveThreadRecord, loadMessageRecord } from "../../../core/storage/store.js";
import { nowIso } from "../../../core/time.js";
import { buildParleyActionResult, nonEmptyString, requireThread } from "./common.js";

function assertTransportStatus(value) {
  if (value !== "accepted" && value !== "failed") {
    throw new Error("status must be one of: accepted, failed");
  }
  return value;
}

function normalizeTransportError(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("error must be an object when provided");
  }
  return {
    code: nonEmptyString(value.code, "error.code"),
    message: nonEmptyString(value.message, "error.message")
  };
}

export function createRecordTransportResultTool(api) {
  return {
    name: "parley_record_transport_result",
    label: "Parley Record Transport Result",
    description: "Record the accepted or failed outcome of caller-managed Parley transport dispatch.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["threadId", "messageId", "status"],
      properties: {
        threadId: { type: "string", description: "Canonical Parley thread id." },
        messageId: { type: "string", description: "Canonical Parley message id." },
        status: { type: "string", description: "Transport outcome. Allowed values are accepted and failed." },
        transportMessageRef: {
          type: "string",
          description: "Best available accepted transport handle returned by the caller's dispatch path."
        },
        error: {
          type: "object",
          description: "Normalized transport failure data. Required when status is failed."
        }
      }
    },
    async execute(_toolCallId, params) {
      const threadId = nonEmptyString(params?.threadId, "threadId");
      const messageId = nonEmptyString(params?.messageId, "messageId");
      const status = assertTransportStatus(params?.status);
      const thread = await requireThread(api.pluginConfig, threadId);
      const message = await loadMessageRecord(api.pluginConfig, threadId, messageId);
      if (!message) {
        throw new Error(`message not found: ${messageId}`);
      }
      if (message.thread_id !== thread.thread_id) {
        throw new Error("message must belong to the provided thread");
      }

      const timestamp = nowIso();
      const updatedThread = await saveThreadRecord(api.pluginConfig, {
        ...thread,
        updated_at: timestamp
      });

      if (status === "accepted") {
        const transportMessageRef = typeof params?.transportMessageRef === "string" && params.transportMessageRef.trim()
          ? params.transportMessageRef.trim()
          : message.transport_message_ref;

        const updatedMessage = await saveMessageRecord(api.pluginConfig, {
          ...message,
          transport_state: "accepted",
          transport_message_ref: transportMessageRef ?? null,
          transport_error: null,
          transport_attempted_at: message.transport_attempted_at ?? timestamp,
          transport_accepted_at: message.transport_accepted_at ?? timestamp
        });

        return await buildParleyActionResult(api, {
          tool: "parley_record_transport_result",
          thread: updatedThread,
          message: updatedMessage,
          transportRequired: false,
          note: "Caller-managed Parley transport acceptance recorded in canonical state."
        });
      }

      const error = normalizeTransportError(params?.error);
      if (!error) {
        throw new Error("error required when status is failed");
      }

      const updatedMessage = await saveMessageRecord(api.pluginConfig, {
        ...message,
        transport_state: "failed",
        transport_message_ref: null,
        transport_error: error,
        transport_attempted_at: message.transport_attempted_at ?? timestamp,
        transport_accepted_at: null
      });

      return await buildParleyActionResult(api, {
        tool: "parley_record_transport_result",
        thread: updatedThread,
        message: updatedMessage,
        transportRequired: false,
        note: "Caller-managed Parley transport failure recorded in canonical state."
      });
    }
  };
}
