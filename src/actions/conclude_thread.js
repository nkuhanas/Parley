import { saveThreadRecord } from "../store.js";
import { nowIso } from "../time.js";
import { buildParleyActionResult, assertParticipant, persistThreadAndMessage, requireLiveThread } from "./common.js";

function normalizeOptionalBodyText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function createConcludeThreadTool(api) {
  return {
    name: "parley_conclude_thread",
    label: "Parley Conclude Thread",
    description: "Conclude a Parley thread. Only the initiator may perform this action.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["threadId", "actor"],
      properties: {
        threadId: { type: "string", description: "Canonical Parley thread id." },
        actor: { type: "string", description: "Participant concluding the thread. Must be the initiator." },
        bodyText: { type: "string", description: "Optional final body text accompanying thread conclusion." }
      }
    },
    async execute(_toolCallId, params) {
      const thread = await requireLiveThread(api.pluginConfig, params?.threadId, "conclude_thread");
      const actor = assertParticipant(thread, params?.actor);
      if (actor !== thread.initiator) {
        throw new Error("only the initiator may conclude the thread");
      }
      if (thread.next_action_owner !== actor) {
        throw new Error("the initiator may only conclude the thread when they currently own the next action");
      }
      const timestamp = nowIso();
      const updatedThread = await saveThreadRecord(api.pluginConfig, {
        ...thread,
        next_action_owner: null,
        last_speaker: actor,
        meaningful_turn_pending: false,
        thread_state: "concluded",
        updated_at: timestamp,
        concluded_at: timestamp
      });

      const persisted = await persistThreadAndMessage(api.pluginConfig, updatedThread, {
        thread_id: thread.thread_id,
        sender: actor,
        message_class: "settling",
        control_marker: "thread_conclude",
        body_text: normalizeOptionalBodyText(params?.bodyText),
        next_action_owner: null,
        created_at: timestamp,
        transport_message_ref: null
      });

      return await buildParleyActionResult(api, {
        tool: "parley_conclude_thread",
        thread: persisted.thread,
        message: persisted.message,
        autoDispatch: true,
        note: "Thread concluded in canonical state and dispatched automatically."
      });
    }
  };
}
