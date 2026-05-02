import { saveThreadRecord } from "../store.js";
import { nowIso } from "../time.js";
import { assertSettlingMarker } from "../schema.js";
import { buildHumanSummaryUpdateRequest, buildParleyActionResult, assertCurrentOwner, persistThreadAndMessage, requireLiveThread } from "./common.js";

function normalizeOptionalBodyText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function assertAllowedSettlingMarker(value) {
  const marker = assertSettlingMarker(value);
  if (marker === "thread_conclude") {
    throw new Error("thread_conclude must use parley_conclude_thread");
  }
  return marker;
}

function assertNextActionOwner(thread, value, controlMarker) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("nextActionOwner required");
  }
  const nextActionOwner = value.trim();
  if (![thread.initiator, thread.recipient].includes(nextActionOwner)) {
    throw new Error("nextActionOwner must be one of the two active participants");
  }
  if (controlMarker === "turn_pass" && thread.control_mode === "directed" && nextActionOwner !== thread.initiator) {
    throw new Error("directed turn_pass must return control to the initiator");
  }
  if (controlMarker === "decision_escalate" && nextActionOwner !== thread.initiator) {
    throw new Error("decision_escalate must assign the next action to the initiator in the two-party MVP");
  }
  return nextActionOwner;
}

function deriveThreadState(controlMarker) {
  if (controlMarker === "decision_escalate") return "awaiting_decision";
  return "awaiting_next_action";
}

export function createSettleTurnTool(api) {
  return {
    name: "parley_settle_turn",
    label: "Parley Settle Turn",
    description: "Settle the current Parley turn with an explicit settling marker and next action owner.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["threadId", "actor", "controlMarker", "nextActionOwner"],
      properties: {
        threadId: { type: "string", description: "Canonical Parley thread id." },
        actor: { type: "string", description: "Participant settling the current turn." },
        controlMarker: {
          type: "string",
          description: "Settling marker. Allowed values here are turn_complete, turn_pass, and decision_escalate."
        },
        nextActionOwner: { type: "string", description: "Explicit resulting next action owner." },
        bodyText: { type: "string", description: "Optional substantive body accompanying the settling event." }
      }
    },
    async execute(_toolCallId, params) {
      const thread = await requireLiveThread(api.pluginConfig, params?.threadId, "settle_turn");
      const actor = assertCurrentOwner(thread, params?.actor);
      const controlMarker = assertAllowedSettlingMarker(params?.controlMarker);
      const nextActionOwner = assertNextActionOwner(thread, params?.nextActionOwner, controlMarker);
      const timestamp = nowIso();
      const updatedThread = await saveThreadRecord(api.pluginConfig, {
        ...thread,
        next_action_owner: nextActionOwner,
        last_speaker: actor,
        meaningful_turn_pending: true,
        thread_state: deriveThreadState(controlMarker),
        updated_at: timestamp
      });

      const persisted = await persistThreadAndMessage(api.pluginConfig, updatedThread, {
        thread_id: thread.thread_id,
        sender: actor,
        message_class: "settling",
        control_marker: controlMarker,
        body_text: normalizeOptionalBodyText(params?.bodyText),
        next_action_owner: nextActionOwner,
        created_at: timestamp,
        transport_message_ref: null
      });

      const humanSummaryUpdateRequest = buildHumanSummaryUpdateRequest({
        thread: persisted.thread,
        message: persisted.message
      });

      return await buildParleyActionResult(api, {
        tool: "parley_settle_turn",
        thread: persisted.thread,
        message: persisted.message,
        autoDispatch: true,
        note: "Turn settled in canonical state and dispatched automatically.",
        extraDetails: humanSummaryUpdateRequest == null
          ? {
            human_summary_update_available: false
          }
          : {
            human_summary_update_available: true,
            human_summary_update_request: humanSummaryUpdateRequest
          }
      });
    }
  };
}
