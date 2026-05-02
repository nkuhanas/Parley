function toCompactJson(value) {
  return JSON.stringify(value, null, 2);
}

export function buildHumanSummaryAnchorRequestText({ threadId, kind, initiator, recipient, nextActionOwner, threadState }) {
  return [
    "PARLEY THREAD",
    `thread: ${threadId}`,
    `kind: ${kind}`,
    `participants: ${initiator} -> ${recipient}`,
    `status: ${threadState}`,
    `next: ${nextActionOwner}`,
    "report: final update will follow in reply to this message after settlement"
  ].join("\n");
}

export function buildHumanSummaryUpdateText({ thread, message }) {
  const lines = [
    "PARLEY UPDATE",
    `thread: ${thread.thread_id}`,
    `status: ${thread.thread_state}`
  ];

  if (thread.next_action_owner != null) {
    lines.push(`next: ${thread.next_action_owner}`);
  }

  if (message?.control_marker) {
    lines.push(`latest: ${message.control_marker} by ${message.sender}`);
  } else if (message?.message_class && message?.sender) {
    lines.push(`latest: ${message.message_class} by ${message.sender}`);
  }

  lines.push("report: final update remains pending until the thread is concluded");
  return lines.join("\n");
}

export function buildParleyProtocolEnvelope({ thread, message }) {
  return {
    protocol: "parley_mvp_draft",
    thread_id: thread.thread_id,
    message_id: message.message_id,
    kind: thread.kind,
    control_mode: thread.control_mode,
    thread_state: thread.thread_state,
    sender: message.sender,
    message_class: message.message_class,
    control_marker: message.control_marker,
    next_action_owner: thread.next_action_owner,
    created_at: message.created_at
  };
}

export function renderParleyProtocolBlock({ thread, message }) {
  return [
    "<<<PARLEY_PROTOCOL_JSON>>>",
    toCompactJson(buildParleyProtocolEnvelope({ thread, message })),
    "<<<END_PARLEY_PROTOCOL_JSON>>>"
  ].join("\n");
}

export function renderParleyOutboundText({ thread, message }) {
  const protocolBlock = renderParleyProtocolBlock({ thread, message });
  if (typeof message.body_text === "string" && message.body_text.trim()) {
    return `${protocolBlock}\n\n${message.body_text.trim()}`;
  }
  return protocolBlock;
}
