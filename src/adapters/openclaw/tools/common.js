import { dispatchTransportRequest } from "../../../core/protocol/dispatch.js";
import { buildPendingTransportMetadata, buildTransportRequest } from "../../../core/protocol/transport.js";
import { buildHumanSummaryUpdateText } from "../../../core/protocol/render.js";
import { createMessageRecord, loadThreadRecord, saveMessageRecord, saveThreadRecord } from "../../../core/storage/store.js";
import { enrichToolDetails } from "../guidance/envelope.js";

function buildTransportStatus(details) {
  const message = details?.message ?? null;
  const transportRequired = details?.transport_required === true;
  const dispatchStatus = typeof details?.dispatch_status === "string" ? details.dispatch_status : null;

  if (!message) {
    return {
      required: transportRequired,
      state: transportRequired ? "pending_dispatch" : "not_required",
      ready_for_dispatch: transportRequired,
      accepted: dispatchStatus === "accepted",
      failed: dispatchStatus === "failed",
      target_session_key: null,
      idempotency_key: null,
      attempted_at: null,
      accepted_at: null,
      error: details?.error ?? null
    };
  }

  return {
    required: transportRequired,
    state: message.transport_state ?? (transportRequired ? "pending_dispatch" : "not_required"),
    ready_for_dispatch: transportRequired && message.transport_state === "pending_dispatch",
    accepted: message.transport_state === "accepted",
    failed: message.transport_state === "failed",
    target_session_key: message.transport_target_session_key ?? null,
    idempotency_key: message.transport_idempotency_key ?? null,
    attempted_at: message.transport_attempted_at ?? null,
    accepted_at: message.transport_accepted_at ?? null,
    error: message.transport_error ?? details?.error ?? null
  };
}

function buildHumanSummaryStatus(details) {
  const thread = details?.thread ?? null;
  if (!thread) {
    return {
      policy: "none",
      anchor_required: false,
      anchor_status: "not_required",
      anchor_message_id: null,
      final_reply_should_target_anchor: false,
      update_available: false,
      update_target_message_id: null
    };
  }

  return {
    policy: thread.report_back_policy ?? "none",
    anchor_required: thread.origin_kind === "human" && thread.report_back_policy === "summary_to_human",
    anchor_status: thread.human_summary_anchor_status ?? "not_required",
    anchor_message_id: thread.human_summary_anchor?.message_id ?? null,
    final_reply_should_target_anchor: thread.human_summary_anchor != null,
    update_available: details?.human_summary_update_available === true,
    update_target_message_id: details?.human_summary_update_request?.target_message_id ?? null
  };
}

function buildWorkflowStatus({ thread, message, transportStatus, humanSummaryStatus }) {
  if (!thread) {
    return {
      phase: "unknown",
      settled_to_initiator: false,
      report_back_due: false,
      ready_for_human_report: false,
      blocked_on_anchor: false,
      next_steps: []
    };
  }

  const anchorPending = humanSummaryStatus.anchor_required && humanSummaryStatus.anchor_status === "pending_send";
  const anchorRecorded = humanSummaryStatus.anchor_required && humanSummaryStatus.anchor_status === "recorded";
  const settledToInitiator = thread.thread_state === "awaiting_next_action"
    && thread.next_action_owner === thread.initiator
    && message?.message_class === "settling";
  const reportBackDue = humanSummaryStatus.policy === "summary_to_human" && settledToInitiator;
  const readyForHumanReport = reportBackDue && anchorRecorded;
  const blockedOnAnchor = reportBackDue && !anchorRecorded;

  let phase = thread.thread_state;
  if (thread.thread_state === "concluded") {
    phase = "concluded";
  } else if (transportStatus.failed) {
    phase = "transport_failed";
  } else if (anchorPending && transportStatus.ready_for_dispatch) {
    phase = "ready_for_anchor_and_dispatch";
  } else if (anchorPending) {
    phase = "ready_for_anchor";
  } else if (transportStatus.ready_for_dispatch) {
    phase = "ready_for_dispatch";
  } else if (settledToInitiator) {
    phase = "settled_to_initiator";
  } else if (thread.thread_state === "active") {
    phase = "in_active_turn";
  }

  const nextSteps = [];
  if (transportStatus.failed) {
    nextSteps.push("repair_or_record_transport_failure");
  } else {
    if (humanSummaryStatus.update_available) {
      nextSteps.push("send_human_summary_state_update");
    }
    if (anchorPending) {
      nextSteps.push("send_and_record_human_summary_anchor");
    }
    if (transportStatus.ready_for_dispatch) {
      nextSteps.push("dispatch_transport_request");
    }
    if (thread.thread_state === "active") {
      nextSteps.push("continue_current_turn_or_settle");
    } else if (thread.thread_state === "awaiting_decision") {
      nextSteps.push("wait_for_decision_owner");
    } else if (settledToInitiator) {
      if (readyForHumanReport) {
        nextSteps.push("send_final_human_summary");
        nextSteps.push("conclude_thread_when_done");
      } else if (blockedOnAnchor) {
        nextSteps.push("record_missing_anchor_before_report_back");
      } else {
        nextSteps.push("continue_or_conclude");
      }
    } else if (
      thread.thread_state === "awaiting_next_action"
      && thread.next_action_owner != null
      && !anchorPending
      && !transportStatus.ready_for_dispatch
    ) {
      nextSteps.push("wait_for_next_action_owner");
    }
  }

  return {
    phase,
    settled_to_initiator: settledToInitiator,
    report_back_due: reportBackDue,
    ready_for_human_report: readyForHumanReport,
    blocked_on_anchor: blockedOnAnchor,
    next_steps: [...new Set(nextSteps)]
  };
}

function buildStatusHeadline({ thread, message, transportStatus, humanSummaryStatus, workflowStatus }) {
  if (!thread) return "Parley result recorded.";

  const parts = [];
  if (thread.thread_state === "concluded") {
    parts.push("Thread concluded.");
  } else if (thread.thread_state === "failed") {
    parts.push("Thread failed.");
  } else if (thread.thread_state === "active") {
    parts.push(`Thread active under ${thread.next_action_owner}.`);
  } else {
    parts.push(`Thread ${thread.thread_state} for ${thread.next_action_owner}.`);
  }

  if (message) {
    if (message.message_class === "settling") {
      parts.push(`Latest message is a settling event${message.control_marker ? ` (${message.control_marker})` : ""}.`);
    } else if (message.message_class === "control") {
      parts.push(`Latest message is a control event${message.control_marker ? ` (${message.control_marker})` : ""}.`);
    } else {
      parts.push("Latest message is substantive.");
    }
  }

  if (transportStatus.accepted) {
    parts.push("Transport accepted.");
  } else if (transportStatus.failed) {
    parts.push("Transport failed.");
  } else if (transportStatus.ready_for_dispatch) {
    parts.push("Transport handoff is ready for dispatch.");
  } else {
    parts.push("No transport dispatch is pending.");
  }

  if (humanSummaryStatus.anchor_required) {
    if (humanSummaryStatus.anchor_status === "recorded") {
      parts.push("Human-summary anchor recorded.");
    } else if (humanSummaryStatus.anchor_status === "pending_send") {
      parts.push("Human-summary anchor still needs to be sent and recorded.");
    }
  }

  if (workflowStatus.ready_for_human_report) {
    parts.push("Final human report can be sent now.");
  }

  return parts.join(" ");
}

function buildParleyStatus(details) {
  const thread = details?.thread ?? null;
  const message = details?.message ?? null;
  const transportStatus = buildTransportStatus(details);
  const humanSummaryStatus = buildHumanSummaryStatus(details);
  const workflowStatus = buildWorkflowStatus({ thread, message, transportStatus, humanSummaryStatus });

  return {
    headline: buildStatusHeadline({ thread, message, transportStatus, humanSummaryStatus, workflowStatus }),
    bounded_thread: true,
    thread: thread == null
      ? null
      : {
        state: thread.thread_state,
        next_action_owner: thread.next_action_owner ?? null,
        last_speaker: thread.last_speaker ?? null,
        meaningful_turn_pending: thread.meaningful_turn_pending,
        terminal: thread.thread_state === "concluded" || thread.thread_state === "failed"
      },
    message: message == null
      ? null
      : {
        class: message.message_class,
        control_marker: message.control_marker ?? null,
        created_at: message.created_at
      },
    transport: transportStatus,
    human_summary: humanSummaryStatus,
    workflow: workflowStatus
  };
}

function compactThread(thread) {
  if (thread == null) return null;
  return {
    thread_id: thread.thread_id,
    kind: thread.kind,
    control_mode: thread.control_mode,
    thread_state: thread.thread_state,
    initiator: thread.initiator,
    recipient: thread.recipient,
    origin_kind: thread.origin_kind,
    next_action_owner: thread.next_action_owner ?? null,
    last_speaker: thread.last_speaker ?? null,
    meaningful_turn_pending: thread.meaningful_turn_pending,
    report_back_policy: thread.report_back_policy ?? "none",
    human_summary_anchor_status: thread.human_summary_anchor_status ?? null,
    human_summary_anchor: thread.human_summary_anchor == null ? null : {
      message_id: thread.human_summary_anchor.message_id,
      channel: thread.human_summary_anchor.channel ?? null,
      channel_id: thread.human_summary_anchor.channel_id ?? null,
      target: thread.human_summary_anchor.target ?? null,
      account_id: thread.human_summary_anchor.account_id ?? null
    },
    updated_at: thread.updated_at,
    concluded_at: thread.concluded_at ?? null,
    failure_reason: thread.failure_reason ?? null
  };
}

function compactMessage(message) {
  if (message == null) return null;
  return {
    message_id: message.message_id,
    thread_id: message.thread_id,
    sender: message.sender,
    message_class: message.message_class,
    control_marker: message.control_marker ?? null,
    next_action_owner: message.next_action_owner ?? null,
    created_at: message.created_at,
    transport_state: message.transport_state ?? null,
    transport_target_session_key: message.transport_target_session_key ?? null,
    transport_message_ref: message.transport_message_ref ?? null,
    transport_idempotency_key: message.transport_idempotency_key ?? null
  };
}

function compactTransportRequest(request) {
  if (request == null || typeof request !== "object") return request;
  return {
    mode: request.mode,
    canonical_thread_id: request.canonical_thread_id ?? request.thread_id,
    canonical_message_id: request.canonical_message_id ?? request.message_id,
    target_session_key: request.target_session_key,
    idempotency_key: request.idempotency_key
  };
}

function compactHumanSummaryUpdateRequest(request) {
  if (request == null || typeof request !== "object") return request;
  return {
    mode: request.mode,
    style: request.style,
    target_message_id: request.target_message_id,
    channel: request.channel ?? null,
    channel_id: request.channel_id ?? null,
    target: request.target ?? null,
    account_id: request.account_id ?? null,
    canonical_thread_id: request.canonical_thread_id,
    canonical_message_id: request.canonical_message_id,
    anchor_text: request.anchor_text,
    update_text: request.update_text
  };
}

function compactDispatchResult(result) {
  if (result == null || typeof result !== "object") return result;
  return {
    runId: result.runId,
    status: result.status,
    messageSeq: result.messageSeq
  };
}

function compactParleyResult(details) {
  return Object.fromEntries(Object.entries({
    tool: details?.tool,
    thread: compactThread(details?.thread),
    message: compactMessage(details?.message),
    transport_required: details?.transport_required,
    dispatch_status: details?.dispatch_status,
    dispatch_result: compactDispatchResult(details?.dispatch_result),
    transport_request: compactTransportRequest(details?.transport_request),
    note: details?.note,
    human_summary_anchor_required: details?.human_summary_anchor_required,
    human_summary_anchor_request: compactHumanSummaryUpdateRequest(details?.human_summary_anchor_request),
    human_summary_update_available: details?.human_summary_update_available,
    human_summary_update_request: compactHumanSummaryUpdateRequest(details?.human_summary_update_request),
    status: details?.status ?? buildParleyStatus(details)
  }).filter(([, value]) => value !== undefined));
}

export function formatParleyResult(details) {
  const compactDetails = compactParleyResult(details);
  const enrichedDetails = enrichToolDetails(compactDetails);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(enrichedDetails, null, 2)
      }
    ],
    details: enrichedDetails
  };
}

export async function requireThread(pluginConfig, threadId) {
  const thread = await loadThreadRecord(pluginConfig, threadId);
  if (!thread) {
    throw new Error(`thread not found: ${threadId}`);
  }
  return thread;
}

export async function requireLiveThread(pluginConfig, threadId, actionName) {
  const thread = await requireThread(pluginConfig, threadId);
  assertMutableThread(thread, actionName);
  return thread;
}

export function assertMutableThread(thread, actionName = "operation") {
  if (thread.thread_state === "concluded" || thread.thread_state === "failed") {
    throw new Error(`${actionName} not allowed for terminal thread_state ${thread.thread_state}`);
  }
  return thread;
}

export function assertParticipant(thread, actor) {
  if (typeof actor !== "string" || !actor.trim()) {
    throw new Error("actor required");
  }
  const normalizedActor = actor.trim();
  if (![thread.initiator, thread.recipient].includes(normalizedActor)) {
    throw new Error("actor must be one of the two active participants");
  }
  return normalizedActor;
}

export function assertCurrentOwner(thread, actor) {
  const normalizedActor = assertParticipant(thread, actor);
  if (thread.next_action_owner !== normalizedActor) {
    throw new Error("actor must be the current next_action_owner");
  }
  return normalizedActor;
}

export async function persistThreadAndMessage(pluginConfig, threadRecord, messageInput, options = {}) {
  let messageRecord = createMessageRecord(messageInput);

  if (options.transportRequired !== false) {
    messageRecord = createMessageRecord({
      ...messageRecord,
      ...buildPendingTransportMetadata({ thread: threadRecord, message: messageRecord })
    });
  }

  const savedThread = await saveThreadRecord(pluginConfig, threadRecord);
  const savedMessage = await saveMessageRecord(pluginConfig, messageRecord);
  return { thread: savedThread, message: savedMessage };
}

export async function buildParleyActionResult(api, {
  tool,
  thread,
  message,
  note,
  transportRequired = true,
  autoDispatch = false,
  extraDetails = {}
}) {
  if (!transportRequired) {
    return formatParleyResult({
      tool,
      thread,
      message,
      transport_required: false,
      note,
      ...extraDetails
    });
  }

  if (autoDispatch) {
    return formatParleyResult({
      tool,
      ...(await dispatchTransportRequest(api, {
        threadId: thread.thread_id,
        messageId: message.message_id,
        notePrefix: note
      })),
      ...extraDetails
    });
  }

  return formatParleyResult({
    tool,
    thread,
    message,
    transport_required: true,
    transport_request: buildTransportRequest({ thread, message }),
    note,
    ...extraDetails
  });
}

export function buildHumanSummaryUpdateRequest({ thread, message }) {
  if (!thread || !message) return null;
  if (!(thread.origin_kind === "human" && thread.report_back_policy === "summary_to_human")) return null;
  if (thread.human_summary_anchor_status !== "recorded" || thread.human_summary_anchor == null) return null;

  return {
    mode: "caller_reply",
    style: "state_update",
    target_message_id: thread.human_summary_anchor.message_id,
    channel: thread.human_summary_anchor.channel ?? null,
    channel_id: thread.human_summary_anchor.channel_id ?? null,
    target: thread.human_summary_anchor.target ?? null,
    account_id: thread.human_summary_anchor.account_id ?? null,
    canonical_thread_id: thread.thread_id,
    canonical_message_id: message.message_id,
    update_text: buildHumanSummaryUpdateText({ thread, message })
  };
}

export function nonEmptyString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} required`);
  }
  return value.trim();
}
