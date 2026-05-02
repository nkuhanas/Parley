import { saveThreadRecord } from "../../../core/storage/store.js";
import { nowIso } from "../../../core/time.js";
import { buildParleyActionResult, assertParticipant, persistThreadAndMessage, requireLiveThread } from "./common.js";

function normalizeOptionalBodyText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function assertProbeActor(thread, actor) {
  const normalizedActor = assertParticipant(thread, actor);
  if (normalizedActor === thread.next_action_owner) {
    throw new Error("probe actor must not be the current next_action_owner");
  }
  return normalizedActor;
}

function deriveProbeState(thread) {
  if (thread.thread_state === "awaiting_decision") return "awaiting_decision";
  return "awaiting_next_action";
}

export function createProbeThreadTool(api) {
  return {
    name: "parley_probe_thread",
    label: "Parley Probe Thread",
    description: "Record the first follow-up probe when a Parley thread appears stalled.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["threadId", "actor"],
      properties: {
        threadId: { type: "string", description: "Canonical Parley thread id." },
        actor: { type: "string", description: "Participant issuing the probe. Must not be the current next_action_owner." },
        bodyText: { type: "string", description: "Optional probe text to accompany the control event." }
      }
    },
    async execute(_toolCallId, params) {
      const thread = await requireLiveThread(api.pluginConfig, params?.threadId, "probe_thread");
      const actor = assertProbeActor(thread, params?.actor);
      const timestamp = nowIso();
      const updatedThread = await saveThreadRecord(api.pluginConfig, {
        ...thread,
        last_speaker: actor,
        meaningful_turn_pending: true,
        thread_state: deriveProbeState(thread),
        updated_at: timestamp,
        probe_count: thread.probe_count + 1,
        last_probe_at: timestamp
      });

      const persisted = await persistThreadAndMessage(api.pluginConfig, updatedThread, {
        thread_id: thread.thread_id,
        sender: actor,
        message_class: "control",
        control_marker: "probe",
        body_text: normalizeOptionalBodyText(params?.bodyText),
        next_action_owner: thread.next_action_owner,
        created_at: timestamp,
        transport_message_ref: null
      });

      return await buildParleyActionResult(api, {
        tool: "parley_probe_thread",
        thread: persisted.thread,
        message: persisted.message,
        note: "Probe recorded in canonical state and transport handoff generated for caller-managed dispatch."
      });
    }
  };
}
