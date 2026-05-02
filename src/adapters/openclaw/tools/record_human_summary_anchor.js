import { saveThreadRecord } from "../../../core/storage/store.js";
import { nowIso } from "../../../core/time.js";
import { formatParleyResult, nonEmptyString, requireThread } from "./common.js";

function normalizeRecordedHumanSummaryAnchor(params) {
  return {
    message_id: nonEmptyString(params?.messageId, "messageId"),
    channel: typeof params?.channel === "string" && params.channel.trim() ? params.channel.trim() : null,
    channel_id: typeof params?.channelId === "string" && params.channelId.trim() ? params.channelId.trim() : null,
    target: typeof params?.target === "string" && params.target.trim() ? params.target.trim() : null,
    account_id: typeof params?.accountId === "string" && params.accountId.trim() ? params.accountId.trim() : null,
    transport_message_ref: typeof params?.transportMessageRef === "string" && params.transportMessageRef.trim() ? params.transportMessageRef.trim() : null,
    created_at: typeof params?.createdAt === "string" && params.createdAt.trim() ? params.createdAt.trim() : null
  };
}

export function createRecordHumanSummaryAnchorTool(api) {
  return {
    name: "parley_record_human_summary_anchor",
    label: "Parley Record Human Summary Anchor",
    description: "Record the delivered human-summary anchor/sendoff for a human-origin summary_to_human thread.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["threadId", "messageId"],
      properties: {
        threadId: { type: "string", description: "Canonical Parley thread id." },
        messageId: { type: "string", description: "Human-visible anchor/sendoff message id that the final completion reply should target." },
        channel: { type: "string", description: "Optional channel plugin name for the anchor message." },
        channelId: { type: "string", description: "Optional provider channel id for the anchor message." },
        target: { type: "string", description: "Optional channel or user target for follow-up delivery." },
        accountId: { type: "string", description: "Optional account id that sent the anchor message." },
        transportMessageRef: { type: "string", description: "Optional opaque provider transport ref for the anchor message." },
        createdAt: { type: "string", description: "Optional ISO timestamp for when the anchor message was created." }
      }
    },
    async execute(_toolCallId, params) {
      const threadId = nonEmptyString(params?.threadId, "threadId");
      const thread = await requireThread(api.pluginConfig, threadId);

      if (!(thread.origin_kind === "human" && thread.report_back_policy === "summary_to_human")) {
        throw new Error("parley_record_human_summary_anchor only allowed for origin_kind = human with report_back_policy = summary_to_human");
      }
      if (thread.human_summary_anchor_status === "recorded" || thread.human_summary_anchor != null) {
        throw new Error("human_summary_anchor already recorded for this thread");
      }
      if (thread.human_summary_anchor_status === "not_required") {
        throw new Error("thread does not currently require a human-summary anchor");
      }

      const timestamp = nowIso();
      const humanSummaryAnchor = normalizeRecordedHumanSummaryAnchor(params);
      const updatedThread = await saveThreadRecord(api.pluginConfig, {
        ...thread,
        human_summary_anchor: humanSummaryAnchor,
        human_summary_anchor_status: "recorded",
        updated_at: timestamp
      });

      return formatParleyResult({
        tool: "parley_record_human_summary_anchor",
        thread: updatedThread,
        human_summary_anchor: updatedThread.human_summary_anchor,
        transport_required: false,
        note: "Human-summary anchor recorded in canonical state."
      });
    }
  };
}
