import { createThreadRecord } from "../../../core/storage/store.js";
import { nowIso } from "../../../core/time.js";
import { assertDistinctParticipants } from "../../../core/protocol/schema.js";
import { buildHumanSummaryAnchorRequestText } from "../../../core/protocol/render.js";
import { buildParleyActionResult, nonEmptyString, persistThreadAndMessage } from "./common.js";

function deriveOpeningThreadState() {
  return "awaiting_next_action";
}

function normalizeHumanSummaryAnchor(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("humanSummaryAnchor must be an object");
  }

  return {
    message_id: nonEmptyString(value.messageId, "humanSummaryAnchor.messageId"),
    channel: typeof value.channel === "string" && value.channel.trim() ? value.channel.trim() : null,
    channel_id: typeof value.channelId === "string" && value.channelId.trim() ? value.channelId.trim() : null,
    target: typeof value.target === "string" && value.target.trim() ? value.target.trim() : null,
    account_id: typeof value.accountId === "string" && value.accountId.trim() ? value.accountId.trim() : null,
    transport_message_ref: typeof value.transportMessageRef === "string" && value.transportMessageRef.trim() ? value.transportMessageRef.trim() : null,
    created_at: typeof value.createdAt === "string" && value.createdAt.trim() ? value.createdAt.trim() : null
  };
}

function normalizeTransportCorrelation(value) {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("transportCorrelation must be an object");
  }
  const allowedKeys = new Set(["targetSessionKey", "initiatorSessionKey", "participantSessionKeys"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new Error(`transportCorrelation.${key} is not allowed`);
  }
  return value;
}

export function createOpenThreadTool(api) {
  return {
    name: "parley_open_thread",
    label: "Parley Open Thread",
    description: "Open a new Parley thread and persist the canonical opening thread/message records.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["initiator", "recipient", "bodyText", "targetSessionKey"],
      properties: {
        kind: { type: "string", description: "Optional Parley thread kind. Defaults to coordination for the bounded normal path." },
        controlMode: { type: "string", description: "Optional Parley thread control mode. Defaults to peer for the bounded normal path." },
        initiator: { type: "string", description: "Initiating participant identifier." },
        recipient: { type: "string", description: "Recipient participant identifier." },
        originKind: { type: "string", description: "Optional thread origin classification. Defaults to agent." },
        suppressHumanSummary: { type: "boolean", description: "Rare override. When true on a human-origin thread, suppresses the default final human-summary obligation." },
        humanSummaryAnchor: {
          type: "object",
          description: "Optional canonical reference for the human-visible anchor/sendoff message. When omitted for human-origin threads without suppressHumanSummary = true, Parley generates an anchor request for the caller to send and record.",
          additionalProperties: false,
          properties: {
            messageId: { type: "string", description: "Human-visible anchor message id that the final summary should reply to." },
            channel: { type: "string", description: "Optional channel plugin name for the anchor message." },
            channelId: { type: "string", description: "Optional provider channel id for the anchor message." },
            target: { type: "string", description: "Optional channel/user target for follow-up delivery." },
            accountId: { type: "string", description: "Optional account id that sent the anchor message." },
            transportMessageRef: { type: "string", description: "Optional opaque provider transport ref for the anchor message." },
            createdAt: { type: "string", description: "Optional ISO timestamp for when the anchor message was created." }
          }
        },
        nextActionOwner: { type: "string", description: "Optional participant expected to take the next meaningful action. Defaults to the recipient for the bounded normal path." },
        bodyText: { type: "string", description: "Opening substantive message body." },
        targetSessionKey: { type: "string", description: "Recipient-side OpenClaw session key for caller-managed Parley transport dispatch." },
        initiatorSessionKey: { type: "string", description: "Optional initiator-side OpenClaw session key so recipient replies can route back to the origin session." },
        transport: { type: "string", description: "Optional transport label captured in canonical state. Defaults to agent_sessions_send for this branch." },
        openedByAction: { type: "string", description: "Optional recorded origin action. Defaults to parley_open_thread." },
        transportCorrelation: { type: "object", description: "Optional transport correlation payload to persist with the thread." }
      }
    },
    async execute(_toolCallId, params) {
      const bodyText = nonEmptyString(params?.bodyText, "bodyText");
      const { initiator, recipient } = assertDistinctParticipants(params?.initiator, params?.recipient);
      const kind = typeof params?.kind === "string" && params.kind.trim() ? params.kind.trim() : "coordination";
      const controlMode = typeof params?.controlMode === "string" && params.controlMode.trim() ? params.controlMode.trim() : "peer";
      const nextActionOwner = typeof params?.nextActionOwner === "string" && params.nextActionOwner.trim()
        ? params.nextActionOwner.trim()
        : recipient;
      if (![initiator, recipient].includes(nextActionOwner)) {
        throw new Error("nextActionOwner must be one of the two active participants");
      }

      const timestamp = nowIso();
      const recipientSessionKey = nonEmptyString(params?.targetSessionKey, "targetSessionKey");
      const initiatorSessionKey = typeof params?.initiatorSessionKey === "string" && params.initiatorSessionKey.trim()
        ? params.initiatorSessionKey.trim()
        : null;
      const originKind = typeof params?.originKind === "string" && params.originKind.trim() ? params.originKind.trim() : "agent";
      if (params?.reportBackPolicy != null) {
        throw new Error("reportBackPolicy is archived and no longer accepted. Use suppressHumanSummary: true for the rare override.");
      }
      if (params?.suppressHumanSummary != null && typeof params.suppressHumanSummary !== "boolean") {
        throw new Error("suppressHumanSummary must be a boolean when provided");
      }
      const suppressHumanSummary = params?.suppressHumanSummary === true;
      const reportBackPolicy = originKind === "human" && !suppressHumanSummary
        ? "summary_to_human"
        : "none";
      const humanSummaryAnchor = normalizeHumanSummaryAnchor(params?.humanSummaryAnchor);
      const transportCorrelation = normalizeTransportCorrelation(params?.transportCorrelation);
      const requiresHumanSummaryAnchor = originKind === "human" && reportBackPolicy === "summary_to_human";

      if (humanSummaryAnchor != null && !requiresHumanSummaryAnchor) {
        throw new Error("humanSummaryAnchor is only allowed for human-origin threads that still require a final human summary");
      }

      const openingThreadState = deriveOpeningThreadState();
      const humanSummaryAnchorRequestText = requiresHumanSummaryAnchor && humanSummaryAnchor == null
        ? buildHumanSummaryAnchorRequestText({
          threadId: "pending_thread_id",
          kind,
          initiator,
          recipient,
          nextActionOwner,
          threadState: openingThreadState
        })
        : null;

      const thread = createThreadRecord({
        kind,
        control_mode: controlMode,
        initiator,
        recipient,
        origin_kind: originKind,
        report_back_policy: reportBackPolicy,
        human_summary_anchor: humanSummaryAnchor,
        human_summary_anchor_status: requiresHumanSummaryAnchor
          ? (humanSummaryAnchor != null ? "recorded" : "pending_send")
          : "not_required",
        human_summary_anchor_request_text: humanSummaryAnchorRequestText,
        next_action_owner: nextActionOwner,
        last_speaker: initiator,
        meaningful_turn_pending: true,
        thread_state: openingThreadState,
        created_at: timestamp,
        updated_at: timestamp,
        opened_by_action: typeof params?.openedByAction === "string" && params.openedByAction.trim() ? params.openedByAction.trim() : "parley_open_thread",
        transport: typeof params?.transport === "string" && params.transport.trim() ? params.transport.trim() : "agent_sessions_send",
        transport_correlation: {
          ...transportCorrelation,
          targetSessionKey: recipientSessionKey,
          ...(initiatorSessionKey ? { initiatorSessionKey } : {}),
          participantSessionKeys: {
            ...(transportCorrelation.participantSessionKeys ?? {}),
            ...(initiatorSessionKey ? { [initiator]: initiatorSessionKey } : {}),
            [recipient]: recipientSessionKey
          }
        }
      });

      const resolvedHumanSummaryAnchorRequestText = requiresHumanSummaryAnchor && humanSummaryAnchor == null
        ? buildHumanSummaryAnchorRequestText({
          threadId: thread.thread_id,
          kind: thread.kind,
          initiator,
          recipient,
          nextActionOwner,
          threadState: thread.thread_state
        })
        : null;

      if (resolvedHumanSummaryAnchorRequestText != null) {
        thread.human_summary_anchor_request_text = resolvedHumanSummaryAnchorRequestText;
      }

      const persisted = await persistThreadAndMessage(api.pluginConfig, thread, {
        thread_id: thread.thread_id,
        sender: initiator,
        message_class: "substantive",
        body_text: bodyText,
        next_action_owner: nextActionOwner,
        created_at: timestamp,
        transport_message_ref: null
      });

      return await buildParleyActionResult(api, {
        tool: "parley_open_thread",
        thread: persisted.thread,
        message: persisted.message,
        note: "Canonical Parley records created and transport handoff generated for caller-managed dispatch.",
        extraDetails: requiresHumanSummaryAnchor && humanSummaryAnchor == null
          ? {
            human_summary_anchor_required: true,
            human_summary_anchor_request: {
              mode: "caller_send",
              anchor_text: resolvedHumanSummaryAnchorRequestText,
              style: "sendoff",
              canonical_thread_id: persisted.thread.thread_id
            }
          }
          : {
            human_summary_anchor_required: false
          }
      });
    }
  };
}
