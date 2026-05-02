import { saveThreadRecord } from "../store.js";
import { nowIso } from "../time.js";
import { buildParleyActionResult, assertCurrentOwner, persistThreadAndMessage, requireLiveThread } from "./common.js";

export function createClaimTurnTool(api) {
  return {
    name: "parley_claim_turn",
    label: "Parley Claim Turn",
    description: "Claim the current Parley turn as a control event without settling the turn.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["threadId", "actor"],
      properties: {
        threadId: { type: "string", description: "Canonical Parley thread id." },
        actor: { type: "string", description: "Participant claiming the current turn." }
      }
    },
    async execute(_toolCallId, params) {
      const thread = await requireLiveThread(api.pluginConfig, params?.threadId, "claim_turn");
      const actor = assertCurrentOwner(thread, params?.actor);
      const timestamp = nowIso();
      const updatedThread = await saveThreadRecord(api.pluginConfig, {
        ...thread,
        last_speaker: actor,
        meaningful_turn_pending: true,
        thread_state: "active",
        updated_at: timestamp,
        last_claimed_at: timestamp
      });

      const persisted = await persistThreadAndMessage(api.pluginConfig, updatedThread, {
        thread_id: thread.thread_id,
        sender: actor,
        message_class: "control",
        control_marker: "claim_turn",
        body_text: null,
        next_action_owner: actor,
        created_at: timestamp,
        transport_message_ref: null
      }, {
        transportRequired: false
      });

      return await buildParleyActionResult(api, {
        tool: "parley_claim_turn",
        thread: persisted.thread,
        message: persisted.message,
        transportRequired: false,
        note: "Turn claimed in canonical state without outbound dispatch. Follow with a substantive reply or settling action when ready."
      });
    }
  };
}
