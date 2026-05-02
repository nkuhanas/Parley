import { saveThreadRecord } from "../store.js";
import { nowIso } from "../time.js";
import { buildParleyActionResult, assertCurrentOwner, persistThreadAndMessage, requireLiveThread, nonEmptyString } from "./common.js";

export function createReplyThreadTool(api) {
  return {
    name: "parley_reply_thread",
    label: "Parley Reply Thread",
    description: "Append a substantive Parley message without settling the current turn.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["threadId", "sender", "bodyText"],
      properties: {
        threadId: { type: "string", description: "Canonical Parley thread id." },
        sender: { type: "string", description: "Participant sending the substantive reply." },
        bodyText: { type: "string", description: "Substantive reply text." }
      }
    },
    async execute(_toolCallId, params) {
      const thread = await requireLiveThread(api.pluginConfig, params?.threadId, "reply_thread");
      const sender = assertCurrentOwner(thread, params?.sender);
      const bodyText = nonEmptyString(params?.bodyText, "bodyText");
      const timestamp = nowIso();
      const updatedThread = await saveThreadRecord(api.pluginConfig, {
        ...thread,
        last_speaker: sender,
        meaningful_turn_pending: true,
        thread_state: "active",
        updated_at: timestamp
      });

      const persisted = await persistThreadAndMessage(api.pluginConfig, updatedThread, {
        thread_id: thread.thread_id,
        sender,
        message_class: "substantive",
        body_text: bodyText,
        next_action_owner: thread.next_action_owner,
        created_at: timestamp,
        transport_message_ref: null
      });

      return await buildParleyActionResult(api, {
        tool: "parley_reply_thread",
        thread: persisted.thread,
        message: persisted.message,
        autoDispatch: true,
        note: "Substantive reply recorded in canonical state and dispatched automatically."
      });
    }
  };
}
