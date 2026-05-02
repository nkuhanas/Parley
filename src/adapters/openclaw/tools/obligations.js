import {
  listArtifactRecords,
  listCoordinationObjectRecords,
  listEffectRecords,
  listObligationRecords
} from "../../../core/storage/board_store.js";
import { listThreadRecords } from "../../../core/storage/store.js";
import { resolveCallerBoardMemberships } from "../../../core/board/board.js";
import { createValidationError, BOARD_OBLIGATION_TARGET_KINDS, BOARD_OBLIGATION_TARGET_KIND_ALIASES, OBLIGATION_FILTERS } from "./descriptors.js";
import { boardResult, callerRuntimeAliasesFromToolContext, callerRuntimeRefFromToolContext, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

const TERMINAL_STATUSES = new Set(["resolved", "cancelled", "superseded"]);
const NEEDS_MY_ACTION_STATUSES = new Set(["active", "blocking", "waiting", "deferred", "stale"]);
const TERMINAL_THREAD_STATES = new Set(["concluded", "failed"]);

function normalizeStringArray(value, fieldName) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) throw new Error(`${fieldName}[${index}] must be a non-empty string`);
    return item.trim();
  });
}

function normalizeBoardTargetKinds(input = {}) {
  const raw = input.targetKinds ?? input.target_kinds;
  const normalized = normalizeStringArray(raw, "targetKinds").map((kind) => {
    const mapped = BOARD_OBLIGATION_TARGET_KIND_ALIASES[kind];
    if (mapped == null) {
      throw createValidationError(`invalid board_obligations targetKinds item: ${kind}`, {
        code: "INVALID_BOARD_OBLIGATIONS_TARGET_KIND",
        validValues: Object.keys(BOARD_OBLIGATION_TARGET_KIND_ALIASES),
        describeTopic: "query.board_obligations"
      });
    }
    return mapped;
  });
  return [...new Set(normalized)];
}

function rejectScopeAlias(input = {}) {
  if (input.scope != null) {
    throw createValidationError("board_obligations no longer accepts scope; use targetKinds for board target filtering", {
      code: "BOARD_OBLIGATIONS_SCOPE_REMOVED",
      validValues: ["targetKinds"],
      describeTopic: "query.board_obligations"
    });
  }
}

function normalizeFilter(value, describeTopic = "query.board_obligations") {
  const filter = value == null ? "needs_my_action" : value;
  if (typeof filter !== "string" || !filter.trim()) throw new Error("filter must be a non-empty string");
  const normalized = filter.trim();
  if (!OBLIGATION_FILTERS.includes(normalized)) {
    throw createValidationError(`invalid obligations filter: ${normalized}`, {
      code: "INVALID_OBLIGATIONS_FILTER",
      validValues: OBLIGATION_FILTERS,
      describeTopic
    });
  }
  return normalized;
}

function normalizeLimit(value) {
  if (value == null) return 50;
  if (!Number.isInteger(value) || value < 0) throw new Error("limit must be a non-negative integer");
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

function resolveRuntimeIdentity(api, params) {
  return resolveCallerBoardMemberships(api.pluginConfig, {
    callerRuntimeRef: params?.callerRuntimeRef ?? callerRuntimeRefFromToolContext(api.toolContext),
    runtimeAliases: callerRuntimeAliasesFromToolContext(api.toolContext)
  });
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
      thread
    });
  }
  return obligations;
}

export async function runtimeObligationsForCaller(api, params = {}) {
  const identity = resolveRuntimeIdentity(api, params);
  const participantIds = runtimeParticipantIds(identity);
  const threads = await listThreadRecords(api.pluginConfig);
  const obligations = threads.flatMap((thread) => runtimeObligationsForThread(thread, participantIds));
  return {
    identity,
    participant_ids: [...participantIds],
    obligations
  };
}

export function createRuntimeObligationsQueryAction(api) {
  return {
    name: "parley_query_runtime_obligations",
    label: "Parley Query Runtime Obligations",
    description: "Return runtime protocol obligations for the caller. Runtime obligations are not board-scoped and do not accept boardId.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        filter: { type: "string", description: "Filter to apply: needs_my_action, assigned_to_me, or all. Defaults to needs_my_action." },
        limit: { type: "number", description: "Maximum obligations to return. Defaults to 50; capped at 200." }
      }
    },
    async execute(_toolCallId, params) {
      const filter = normalizeFilter(params?.filter, "query.runtime_obligations");
      const limit = normalizeLimit(params?.limit);
      const runtime = await runtimeObligationsForCaller(api, params);
      const matched = runtime.obligations.filter((obligation) => {
        if (filter === "all" || filter === "assigned_to_me") return true;
        return NEEDS_MY_ACTION_STATUSES.has(obligation.status) && !TERMINAL_STATUSES.has(obligation.status);
      });
      const returned = matched.slice(0, limit);
      return boardResult({
        tool: "parley_query_runtime_obligations",
        identity: runtime.identity,
        participant_ids: runtime.participant_ids,
        query: { filter, limit },
        counts: {
          matched: matched.length,
          returned: returned.length,
          truncated: matched.length > returned.length,
          by_status: countBy(matched, "status"),
          by_type: countBy(matched, "type")
        },
        obligations: returned
      });
    }
  };
}

export function createBoardObligationsQueryAction(api) {
  return {
    name: "parley_query_board_obligations",
    label: "Parley Query Board Obligations",
    description: "Return board-scoped obligations filtered by board-local actor and board target kind.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Required board id for board-scoped obligations. Call parley_my_boards to discover accessible boards and default_board." },
        filter: { type: "string", description: "Filter to apply: needs_my_action, assigned_to_me, or all. Defaults to needs_my_action." },
        targetKinds: { type: "array", items: { type: "string" }, description: `Optional board target kinds: ${BOARD_OBLIGATION_TARGET_KINDS.join(", ")}.` },
        limit: { type: "number", description: "Maximum obligations to return. Defaults to 50; capped at 200." }
      }
    },
    async execute(_toolCallId, params) {
      rejectScopeAlias(params ?? {});
      const identity = resolveToolCaller(api, params);
      const filter = normalizeFilter(params?.filter, "query.board_obligations");
      const targetKinds = normalizeBoardTargetKinds(params ?? {});
      const limit = normalizeLimit(params?.limit);
      const [obligations, effects, artifacts, objects] = await Promise.all([
        listObligationRecords(api.pluginConfig, identity.board),
        listEffectRecords(api.pluginConfig, identity.board),
        listArtifactRecords(api.pluginConfig, identity.board),
        listCoordinationObjectRecords(api.pluginConfig, identity.board)
      ]);
      const effectsById = byId(effects, "effect_id");
      const artifactsById = byId(artifacts, "artifact_id");
      const objectsById = byId(objects, "object_id");
      const targetKindSet = new Set(targetKinds);
      const matched = obligations
        .filter((obligation) => includeBoardObligationByFilter(obligation, identity, filter))
        .map((obligation) => ({ obligation, target_kinds: boardTargetKindsForObligation(obligation) }))
        .filter((item) => targetKindSet.size === 0 || item.target_kinds.some((kind) => targetKindSet.has(kind)));
      const returned = matched.slice(0, limit).map((item) => {
        const sourceEffect = item.obligation.source_effect_id == null ? null : effectsById.get(item.obligation.source_effect_id) ?? null;
        const objectId = item.obligation.target?.object_id ?? sourceEffect?.target?.object_id ?? null;
        const artifactId = item.obligation.target?.artifact_id ?? sourceEffect?.target?.artifact_id ?? null;
        return {
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
      return boardResult({
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
          by_type: countBy(matched.map((item) => item.obligation), "type")
        },
        obligations: returned
      });
    }
  };
}
