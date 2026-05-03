import { GUIDANCE_TEXT } from "./catalog.js";
import { obligationPriorityRank } from "../tools/obligation_priority.js";

function clean(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = clean(value);
    if (normalized != null) return normalized;
  }
  return null;
}

function countAt(path, source) {
  let current = source;
  for (const key of path) current = current?.[key];
  return typeof current === "number" && Number.isFinite(current) ? current : 0;
}

function pushNext(next, entry) {
  if (!entry?.tool) return;
  next.push({
    tool: entry.tool,
    args: entry.args ?? {},
    reason: entry.reason
  });
}

function toolSummaryKey(details) {
  if (details?.tool === "parley_where_am_i") {
    return details?.scope === "runtime_and_board"
      ? "parley_where_am_i.runtime_and_board"
      : "parley_where_am_i.runtime";
  }
  return details?.tool;
}

export function guidanceSummary(details) {
  const key = toolSummaryKey(details);
  const base = GUIDANCE_TEXT.summaries[key] ?? GUIDANCE_TEXT.summaries.default;
  if (details?.tool === "parley_query" && details?.action) return `${base} (${details.action}).`;
  if (details?.tool === "parley_mutate" && details?.action) return `${base} (${details.action}).`;
  return base;
}

function boardIdFrom(details) {
  return firstNonEmpty(
    details?.boardId,
    details?.board_id,
    details?.identity?.board_id,
    details?.board?.identity?.board_id,
    details?.artifact?.board_id,
    details?.object?.board_id,
    details?.effect?.board_id,
    details?.obligation?.board_id,
    details?.relationship?.board_id,
    details?.validation?.frontmatter?.board_id,
    details?.result?.identity?.board_id,
    details?.result?.validation?.frontmatter?.board_id,
    details?.result?.board_id
  );
}

function boardAgentIdFrom(details) {
  return firstNonEmpty(
    details?.identity?.board_agent_id,
    details?.board?.identity?.board_agent_id,
    details?.effect?.actor?.board_agent_id,
    details?.result?.identity?.board_agent_id
  );
}

function defaultBoardFrom(details) {
  return firstNonEmpty(
    details?.boards?.default_board,
    details?.runtime?.identity?.default_board,
    details?.default_board,
    details?.result?.boards?.default_board,
    details?.result?.runtime?.identity?.default_board
  );
}

function guidanceMeaning(details) {
  if (details?.tool === "parley_query" || details?.tool === "parley_mutate") return GUIDANCE_TEXT.meanings.facade;
  if (details?.tool === "parley_where_am_i" && details?.scope === "runtime") return GUIDANCE_TEXT.meanings.runtime_recovery;
  if (details?.tool === "parley_where_am_i") return GUIDANCE_TEXT.meanings.board_recovery;
  if (details?.tool === "parley_validate_plan" || details?.action === "validate_plan" || details?.tool === "parley_validate_state") return GUIDANCE_TEXT.meanings.validation;
  if (details?.tool === "parley_board_projection" || details?.tool === "parley_checkpoint_projection" || details?.action === "board") return GUIDANCE_TEXT.meanings.projection;
  if (details?.tool === "parley_query_search" || details?.action === "search") return GUIDANCE_TEXT.meanings.search;
  if (details?.thread || details?.message || String(details?.tool ?? "").includes("thread") || String(details?.tool ?? "").includes("transport")) return GUIDANCE_TEXT.meanings.thread;
  if (details?.artifact || details?.object || details?.effect || details?.obligation || details?.relationship || details?.action) return GUIDANCE_TEXT.meanings.mutation_recorded;
  return undefined;
}

function boardNeedsActionCount(details) {
  return countAt(["projection", "counts", "blocking"], details)
    + countAt(["projection", "counts", "active"], details)
    + countAt(["board", "projection", "counts", "blocking"], details)
    + countAt(["board", "projection", "counts", "active"], details)
    + countAt(["result", "projection", "counts", "blocking"], details)
    + countAt(["result", "projection", "counts", "active"], details)
    + countAt(["counts", "blocking"], details)
    + countAt(["counts", "active"], details);
}

function runtimeNeedsActionCount(details) {
  return countAt(["runtime", "counts", "blocking"], details)
    + countAt(["runtime", "counts", "active"], details)
    + countAt(["result", "runtime", "counts", "blocking"], details)
    + countAt(["result", "runtime", "counts", "active"], details);
}

function threadNext(details) {
  const next = [];
  const threadId = details?.thread?.thread_id;
  const messageId = details?.message?.message_id;
  const steps = details?.status?.workflow?.next_steps;
  if (!Array.isArray(steps)) return next;

  if (steps.includes("dispatch_transport_request") && threadId && messageId) {
    pushNext(next, {
      tool: "parley_dispatch_transport_request",
      args: { threadId, messageId },
      reason: GUIDANCE_TEXT.nextReasons.dispatch_transport
    });
  }

  if (steps.includes("send_and_record_human_summary_anchor") && threadId) {
    pushNext(next, {
      tool: "parley_record_human_summary_anchor",
      args: { threadId, messageId: "<sent-anchor-message-id>" },
      reason: GUIDANCE_TEXT.nextReasons.record_human_anchor
    });
  }

  if (steps.includes("continue_current_turn_or_settle") && threadId && details?.thread?.next_action_owner) {
    pushNext(next, {
      tool: "parley_settle_turn",
      args: { threadId, actor: details.thread.next_action_owner, controlMarker: "turn_complete", nextActionOwner: "<counterparty>" },
      reason: GUIDANCE_TEXT.nextReasons.settle_turn
    });
  }

  return next;
}

function whereAmIObligationNext(details, boardId) {
  const summary = details?.obligation_summary ?? details?.result?.obligation_summary ?? null;
  if (summary == null) return [];
  const runtimePriority = summary.runtime?.highest_priority ?? null;
  const boardPriority = summary.board?.highest_priority ?? null;
  const runtimeCount = summary.runtime?.needs_action ?? 0;
  const boardCount = summary.board?.needs_action ?? 0;
  const runtimeWins = runtimePriority != null && runtimeCount > 0 && (boardPriority == null || obligationPriorityRank(runtimePriority) <= obligationPriorityRank(boardPriority));
  const boardWins = boardPriority != null && boardCount > 0;
  const next = [];
  if (runtimeWins) {
    pushNext(next, {
      tool: "parley_query_runtime_obligations",
      args: { filter: "needs_my_action" },
      reason: GUIDANCE_TEXT.nextReasons.inspect_runtime_obligations
    });
    return next;
  }
  if (boardWins && boardId) {
    pushNext(next, {
      tool: "parley_query_board_obligations",
      args: { boardId, filter: "needs_my_action" },
      reason: GUIDANCE_TEXT.nextReasons.inspect_board_obligations
    });
  }
  return next;
}

function boardNext(details, boardId) {
  const next = [];
  if (!boardId) return next;

  if (details?.tool === "parley_where_am_i" || details?.action === "where_am_i") {
    const obligationNext = whereAmIObligationNext(details, boardId);
    if (obligationNext.length > 0) return obligationNext;
  }

  if (runtimeNeedsActionCount(details) > 0) {
    pushNext(next, {
      tool: "parley_query_runtime_obligations",
      args: { filter: "needs_my_action" },
      reason: GUIDANCE_TEXT.nextReasons.inspect_runtime_obligations
    });
  }

  if (boardNeedsActionCount(details) > 0 || details?.tool === "parley_where_am_i" || details?.action === "where_am_i") {
    pushNext(next, {
      tool: "parley_query_board_obligations",
      args: { boardId, filter: "needs_my_action" },
      reason: GUIDANCE_TEXT.nextReasons.inspect_board_obligations
    });
  }

  if (details?.artifact || details?.object || details?.effect || details?.obligation || details?.relationship || details?.tool === "parley_create_plan" || details?.tool === "parley_mutate") {
    pushNext(next, {
      tool: "parley_where_am_i",
      args: { boardId },
      reason: GUIDANCE_TEXT.nextReasons.recover_board_after_mutation
    });
  }

  if (details?.tool === "parley_validate_plan" || details?.action === "validate_plan") {
    pushNext(next, {
      tool: "parley_query_board_obligations",
      args: { boardId, filter: "needs_my_action", targetKinds: ["plans"] },
      reason: GUIDANCE_TEXT.nextReasons.validate_plan_state
    });
  }

  return next;
}

function runtimeNext(details) {
  const next = [];
  const boardId = defaultBoardFrom(details);
  if (((details?.tool === "parley_where_am_i" && details?.scope === "runtime") || (details?.action === "where_am_i" && details?.result?.scope === "runtime")) && boardId) {
    pushNext(next, {
      tool: "parley_where_am_i",
      args: { boardId },
      reason: GUIDANCE_TEXT.nextReasons.recover_default_board
    });
  }
  return next;
}

function avoidGuidance(details, boardId) {
  const avoid = [];
  if (boardId == null && (details?.boards?.default_board || details?.runtime?.identity?.default_board)) {
    avoid.push({ action: "implicit_board_selection", reason: GUIDANCE_TEXT.avoid.implicit_board });
  }
  if (details?.tool === "parley_validate_plan" || details?.action === "validate_plan") {
    avoid.push({ action: "activation_without_authority", reason: GUIDANCE_TEXT.avoid.activation_without_authority });
  }
  if (details?.thread?.next_action_owner && details?.status?.workflow?.phase === "awaiting_next_action") {
    avoid.push({ action: "acting_for_other_owner", reason: GUIDANCE_TEXT.avoid.acting_for_other_owner });
  }
  return avoid;
}

export function buildGuidance(details) {
  const boardId = boardIdFrom(details);
  const next = [
    ...runtimeNext(details),
    ...boardNext(details, boardId),
    ...threadNext(details)
  ];
  const avoid = avoidGuidance(details, boardId);
  return Object.fromEntries(Object.entries({
    meaning: guidanceMeaning(details),
    next: next.length > 0 ? next : undefined,
    avoid: avoid.length > 0 ? avoid : undefined
  }).filter(([, value]) => value !== undefined));
}

export function buildDiagnostics(details) {
  return Object.fromEntries(Object.entries({
    tool: details?.tool,
    action: details?.action,
    board_id: boardIdFrom(details),
    board_agent_id: boardAgentIdFrom(details),
    verbosity: details?.verbosity
  }).filter(([, value]) => value !== undefined));
}
