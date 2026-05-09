import {
  listArtifactRecords,
  listCoordinationObjectRecords,
  listEffectRecords,
  listObligationRecords
} from "../../core/storage/board_store.js";
import { listThreadRecords } from "../../core/storage/store.js";
import {
  decorateBoardObligationItem,
  decorateRuntimeObligation,
  obligationPrioritySummary,
  sortBoardObligationItemsByPriority,
  sortObligationsByPriority
} from "../../core/board/obligation_priority.js";
import { explicitBoardId, normalizeServiceRequest } from "../context.js";
import { SERVICE_ERROR_CODES, serviceError } from "../errors.js";
import { resolveServiceCallerIdentity, resolveServiceCallerMemberships } from "../identity.js";
import { queryResponse } from "../responses.js";

export const OBLIGATION_FILTERS = Object.freeze(["needs_my_action", "assigned_to_me", "all"]);
export const BOARD_OBLIGATION_TARGET_KINDS = Object.freeze(["plans", "artifacts", "objects", "phases", "relationships", "checkpoints", "board_obligations"]);
export const BOARD_OBLIGATION_TARGET_KIND_ALIASES = Object.freeze({
  plan: "plans",
  plans: "plans",
  artifact: "artifacts",
  artifacts: "artifacts",
  object: "objects",
  objects: "objects",
  phase: "phases",
  phases: "phases",
  relationship: "relationships",
  relationships: "relationships",
  checkpoint: "checkpoints",
  checkpoints: "checkpoints",
  board_obligation: "board_obligations",
  board_obligations: "board_obligations",
  obligation: "board_obligations",
  obligations: "board_obligations"
});

const TERMINAL_STATUSES = new Set(["resolved", "cancelled", "superseded"]);
const NEEDS_MY_ACTION_STATUSES = new Set(["active", "blocking", "waiting", "deferred", "stale"]);
const TERMINAL_THREAD_STATES = new Set(["concluded", "failed"]);

function value(input, snakeName, camelName = snakeName) {
  return input?.[snakeName] ?? input?.[camelName];
}

function normalizeStringArray(value, fieldName) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw serviceError(SERVICE_ERROR_CODES.VALIDATION_FAILED, `${fieldName} must be an array.`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw serviceError(SERVICE_ERROR_CODES.VALIDATION_FAILED, `${fieldName}[${index}] must be a non-empty string.`);
    }
    return item.trim();
  });
}

function normalizeBoardTargetKinds(input = {}) {
  const raw = value(input, "target_kinds", "targetKinds");
  const normalized = normalizeStringArray(raw, "targetKinds").map((kind) => {
    const mapped = BOARD_OBLIGATION_TARGET_KIND_ALIASES[kind];
    if (mapped == null) {
      throw serviceError(
        SERVICE_ERROR_CODES.VALIDATION_FAILED,
        `invalid board_obligations targetKinds item: ${kind}.`,
        { diagnostics: { valid_values: Object.keys(BOARD_OBLIGATION_TARGET_KIND_ALIASES) } }
      );
    }
    return mapped;
  });
  return [...new Set(normalized)];
}

function rejectScopeAlias(input = {}) {
  if (input.scope != null) {
    throw serviceError(
      SERVICE_ERROR_CODES.VALIDATION_FAILED,
      "board_obligations no longer accepts scope; use targetKinds for board target filtering.",
      { diagnostics: { valid_values: ["targetKinds"] } }
    );
  }
}

function normalizeFilter(value, describeTopic = "query.board_obligations") {
  const filter = value == null ? "needs_my_action" : value;
  if (typeof filter !== "string" || !filter.trim()) {
    throw serviceError(SERVICE_ERROR_CODES.VALIDATION_FAILED, "filter must be a non-empty string.");
  }
  const normalized = filter.trim();
  if (!OBLIGATION_FILTERS.includes(normalized)) {
    throw serviceError(
      SERVICE_ERROR_CODES.VALIDATION_FAILED,
      `invalid obligations filter: ${normalized}.`,
      { diagnostics: { describe_topic: describeTopic, valid_values: OBLIGATION_FILTERS } }
    );
  }
  return normalized;
}

function normalizeLimit(value) {
  if (value == null) return 50;
  if (!Number.isInteger(value) || value < 0) {
    throw serviceError(SERVICE_ERROR_CODES.VALIDATION_FAILED, "limit must be a non-negative integer.");
  }
  return Math.min(value, 200);
}

function boardTargetKindsForObligation(obligation) {
  const target = obligation?.target ?? {};
  const kinds = [];
  if (target.plan_id != null) kinds.push("plans");
  if (target.artifact_id != null) kinds.push("artifacts");
  if (target.object_id != null) kinds.push("objects");
  if (target.phase_id != null) kinds.push("phases");
  if (target.relationship_id != null) kinds.push("relationships");
  if (target.checkpoint_id != null) kinds.push("checkpoints");
  if (target.obligation_id != null) kinds.push("board_obligations");
  return kinds.length > 0 ? kinds : ["unknown"];
}

function includeBoardObligationByFilter(obligation, identity, filter) {
  if (filter === "all") return true;
  if (obligation.agent !== identity.board_agent_id) return false;
  if (filter === "assigned_to_me") return true;
  return NEEDS_MY_ACTION_STATUSES.has(obligation.status) && !TERMINAL_STATUSES.has(obligation.status);
}

function byId(records, fieldName) {
  const out = new Map();
  for (const record of records) out.set(record[fieldName], record);
  return out;
}

function countBy(records, fieldName) {
  const counts = {};
  for (const record of records) {
    const key = record[fieldName] ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function runtimeParticipantIds(runtimeIdentity) {
  const ids = new Set();
  if (runtimeIdentity.global_agent_id != null) ids.add(runtimeIdentity.global_agent_id);
  for (const board of runtimeIdentity.boards ?? []) {
    if (board.board_agent_id != null) ids.add(board.board_agent_id);
  }
  return ids;
}

function runtimeObligationsForThread(thread, participantIds) {
  const obligations = [];
  if (!TERMINAL_THREAD_STATES.has(thread.thread_state) && thread.next_action_owner != null && participantIds.has(thread.next_action_owner)) {
    obligations.push({
      obligation_id: `runtime_turn_${thread.thread_id}`,
      scope: "runtime",
      type: "thread_turn",
      status: thread.thread_state === "awaiting_decision" ? "blocking" : "active",
      agent: thread.next_action_owner,
      target: { kind: "thread", thread_id: thread.thread_id },
      reason: "caller is the thread next_action_owner",
      created_at: thread.created_at,
      updated_at: thread.updated_at,
      thread
    });
  }
  if (
    thread.origin_kind === "human"
    && thread.report_back_policy === "summary_to_human"
    && ["pending_send", "failed"].includes(thread.human_summary_anchor_status)
    && participantIds.has(thread.initiator)
  ) {
    obligations.push({
      obligation_id: `runtime_human_summary_anchor_${thread.thread_id}`,
      scope: "runtime",
      type: "human_summary_anchor",
      status: thread.human_summary_anchor_status === "failed" ? "blocking" : "active",
      agent: thread.initiator,
      target: { kind: "thread", thread_id: thread.thread_id },
      reason: "human-origin summary thread needs a human-visible summary anchor",
      created_at: thread.created_at,
      updated_at: thread.updated_at,
      thread
    });
  }
  return obligations;
}

export async function runtimeObligationsForCaller(request = {}, deps = {}) {
  const { caller } = normalizeServiceRequest(request);
  const identity = resolveServiceCallerMemberships(deps.pluginConfig, caller);
  const participantIds = runtimeParticipantIds(identity);
  const threads = await listThreadRecords(deps.pluginConfig);
  const obligations = sortObligationsByPriority(threads.flatMap((thread) => runtimeObligationsForThread(thread, participantIds)).map(decorateRuntimeObligation));
  return {
    identity,
    participant_ids: [...participantIds],
    obligations
  };
}

export async function listRuntimeObligations(request = {}, deps = {}) {
  const { input } = normalizeServiceRequest(request);
  if (explicitBoardId(input) != null) {
    throw serviceError(
      SERVICE_ERROR_CODES.VALIDATION_FAILED,
      "listRuntimeObligations is not board-affined; omit input.board_id."
    );
  }
  const filter = normalizeFilter(value(input, "filter"), "query.runtime_obligations");
  const limit = normalizeLimit(value(input, "limit"));
  const runtime = await runtimeObligationsForCaller(request, deps);
  const matched = runtime.obligations.filter((obligation) => {
    if (filter === "all" || filter === "assigned_to_me") return true;
    return NEEDS_MY_ACTION_STATUSES.has(obligation.status) && !TERMINAL_STATUSES.has(obligation.status);
  });
  const returned = matched.slice(0, limit);
  const prioritySummary = obligationPrioritySummary(matched);
  return queryResponse({
    data: {
      tool: "parley_query_runtime_obligations",
      identity: runtime.identity,
      participant_ids: runtime.participant_ids,
      query: { filter, limit },
      counts: {
        matched: matched.length,
        returned: returned.length,
        truncated: matched.length > returned.length,
        by_status: countBy(matched, "status"),
        by_type: countBy(matched, "type"),
        by_priority: prioritySummary.by_priority,
        highest_priority: prioritySummary.highest_priority
      },
      obligations: returned
    }
  });
}

export async function listBoardObligations(request = {}, deps = {}) {
  const { caller, input } = normalizeServiceRequest(request);
  rejectScopeAlias(input ?? {});
  const identity = resolveServiceCallerIdentity(deps.pluginConfig, caller, input);
  const filter = normalizeFilter(value(input, "filter"), "query.board_obligations");
  const targetKinds = normalizeBoardTargetKinds(input ?? {});
  const limit = normalizeLimit(value(input, "limit"));
  const [obligations, effects, artifacts, objects] = await Promise.all([
    listObligationRecords(deps.pluginConfig, identity.board),
    listEffectRecords(deps.pluginConfig, identity.board),
    listArtifactRecords(deps.pluginConfig, identity.board),
    listCoordinationObjectRecords(deps.pluginConfig, identity.board)
  ]);
  const effectsById = byId(effects, "effect_id");
  const artifactsById = byId(artifacts, "artifact_id");
  const objectsById = byId(objects, "object_id");
  const targetKindSet = new Set(targetKinds);
  const matched = sortBoardObligationItemsByPriority(obligations
    .filter((obligation) => includeBoardObligationByFilter(obligation, identity, filter))
    .map((obligation) => decorateBoardObligationItem({ obligation, target_kinds: boardTargetKindsForObligation(obligation) }))
    .filter((item) => targetKindSet.size === 0 || item.target_kinds.some((kind) => targetKindSet.has(kind))));
  const returned = matched.slice(0, limit).map((item) => {
    const sourceEffect = item.obligation.source_effect_id == null ? null : effectsById.get(item.obligation.source_effect_id) ?? null;
    const objectId = item.obligation.target?.object_id ?? sourceEffect?.target?.object_id ?? null;
    const artifactId = item.obligation.target?.artifact_id ?? sourceEffect?.target?.artifact_id ?? null;
    return {
      priority: item.priority,
      obligation: item.obligation,
      target_kinds: item.target_kinds,
      source_effect: sourceEffect,
      object: objectId == null ? null : objectsById.get(objectId) ?? null,
      artifact: artifactId == null ? null : artifactsById.get(artifactId) ?? null,
      source_refs: {
        source_effect_id: item.obligation.source_effect_id ?? null,
        source_thread_id: sourceEffect?.source_thread_id ?? item.obligation.target?.thread_id ?? null,
        source_message_id: sourceEffect?.source_message_id ?? item.obligation.target?.message_id ?? null,
        object_id: objectId,
        artifact_id: artifactId,
        plan_id: item.obligation.target?.plan_id ?? null,
        phase_id: item.obligation.target?.phase_id ?? null,
        relationship_id: item.obligation.target?.relationship_id ?? null,
        checkpoint_id: item.obligation.target?.checkpoint_id ?? null,
        board_obligation_id: item.obligation.target?.obligation_id ?? null
      }
    };
  });
  const prioritySummary = obligationPrioritySummary(matched.map((item) => item.obligation));
  return queryResponse({
    data: {
      tool: "parley_query_board_obligations",
      identity,
      query: {
        filter,
        target_kinds: targetKinds,
        limit
      },
      counts: {
        matched: matched.length,
        returned: returned.length,
        truncated: matched.length > returned.length,
        by_status: countBy(matched.map((item) => item.obligation), "status"),
        by_type: countBy(matched.map((item) => item.obligation), "type"),
        by_priority: prioritySummary.by_priority,
        highest_priority: prioritySummary.highest_priority
      },
      obligations: returned
    }
  });
}
