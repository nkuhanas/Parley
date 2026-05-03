export const OBLIGATION_PRIORITIES = Object.freeze(["critical", "high", "normal", "low"]);

export const OBLIGATION_PRIORITY_RANK = Object.freeze({
  critical: 0,
  high: 1,
  normal: 2,
  low: 3
});

const HIGH_BOARD_TYPES = new Set(["review", "approve_or_object", "resolve_objection", "validate_activation", "notify_human"]);
const LOW_BOARD_TYPES = new Set(["preserve_awareness"]);
const LOW_STATUSES = new Set(["waiting", "deferred", "stale", "resolved", "cancelled", "superseded"]);

export function normalizeObligationPriority(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim();
  return OBLIGATION_PRIORITIES.includes(normalized) ? normalized : null;
}

export function obligationPriorityRank(priority) {
  return OBLIGATION_PRIORITY_RANK[normalizeObligationPriority(priority) ?? "normal"];
}

function createdAtMillis(value) {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function idForObligation(value) {
  return value?.obligation_id ?? value?.thread?.thread_id ?? "";
}

function byPriorityThenAge(left, right) {
  const priorityDelta = obligationPriorityRank(left?.priority) - obligationPriorityRank(right?.priority);
  if (priorityDelta !== 0) return priorityDelta;
  const ageDelta = createdAtMillis(left?.created_at) - createdAtMillis(right?.created_at);
  if (ageDelta !== 0) return ageDelta;
  return idForObligation(left).localeCompare(idForObligation(right));
}

export function sortObligationsByPriority(obligations) {
  return [...obligations].sort(byPriorityThenAge);
}

export function deriveRuntimeObligationPriority(obligation) {
  const explicit = normalizeObligationPriority(obligation?.priority);
  if (explicit != null) return explicit;
  if (obligation?.type === "thread_turn") return obligation?.status === "blocking" ? "critical" : "high";
  if (obligation?.type === "human_summary_anchor") return "high";
  if (obligation?.status === "blocking") return "high";
  return "normal";
}

export function decorateRuntimeObligation(obligation) {
  if (obligation == null || typeof obligation !== "object" || Array.isArray(obligation)) return obligation;
  return {
    ...obligation,
    priority: deriveRuntimeObligationPriority(obligation)
  };
}

export function deriveBoardObligationPriority(obligation) {
  const explicit = normalizeObligationPriority(obligation?.priority);
  if (explicit != null) return explicit;
  if (obligation?.status === "blocking") return "high";
  if (LOW_STATUSES.has(obligation?.status)) return "low";
  if (HIGH_BOARD_TYPES.has(obligation?.type)) return "high";
  if (LOW_BOARD_TYPES.has(obligation?.type)) return "low";
  return "normal";
}

export function decorateBoardObligationItem(item) {
  if (item == null || typeof item !== "object" || Array.isArray(item)) return item;
  const priority = deriveBoardObligationPriority(item.obligation);
  return {
    ...item,
    priority,
    obligation: {
      ...item.obligation,
      priority
    }
  };
}

export function sortBoardObligationItemsByPriority(items) {
  return [...items].sort((left, right) => byPriorityThenAge(left?.obligation, right?.obligation));
}

export function obligationPrioritySummary(obligations) {
  const byPriority = Object.fromEntries(OBLIGATION_PRIORITIES.map((priority) => [priority, 0]));
  let highestPriority = null;
  for (const obligation of obligations ?? []) {
    const priority = normalizeObligationPriority(obligation?.priority) ?? "normal";
    byPriority[priority] = (byPriority[priority] ?? 0) + 1;
    if (highestPriority == null || obligationPriorityRank(priority) < obligationPriorityRank(highestPriority)) highestPriority = priority;
  }
  return {
    highest_priority: highestPriority,
    by_priority: byPriority
  };
}
