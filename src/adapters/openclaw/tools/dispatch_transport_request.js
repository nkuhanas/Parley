import { dispatchTransportRequest, normalizeDispatchTimeoutMs } from "../../../core/protocol/dispatch.js";
import { formatParleyResult, nonEmptyString } from "./common.js";

export function createDispatchTransportRequestTool(api) {
  return {
    name: "parley_dispatch_transport_request",
    label: "Parley Dispatch Transport Request",
    description: "Fallback/debug helper: dispatch the latest canonical pending Parley message by thread/message id through sessions.send and record the accepted or failed result in canonical state.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["threadId", "messageId"],
      properties: {
        threadId: {
          type: "string",
          description: "Canonical Parley thread id whose latest pending message should be dispatched."
        },
        messageId: {
          type: "string",
          description: "Canonical Parley message id to dispatch. Must still be the thread's latest pending_dispatch message."
        },
        timeoutMs: {
          type: "number",
          description: "Optional sessions.send timeout in milliseconds. Defaults to 30000."
        }
      }
    },
    async execute(_toolCallId, params) {
      const threadId = nonEmptyString(params?.threadId, "threadId");
      const messageId = nonEmptyString(params?.messageId, "messageId");
      const timeoutMs = normalizeDispatchTimeoutMs(params?.timeoutMs);

      return formatParleyResult({
        tool: "parley_dispatch_transport_request",
        ...(await dispatchTransportRequest(api, { threadId, messageId, timeoutMs }))
      });
    }
  };
}
