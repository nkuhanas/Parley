import { listThreadRecords } from "../../../core/storage/store.js";
import { listBoardObligations as serviceListBoardObligations, listRuntimeObligations as serviceListRuntimeObligations } from "../../../service/queries/obligations.js";
import { resolveCallerBoardMemberships } from "../../../core/board/board.js";
import { createValidationError, BOARD_OBLIGATION_TARGET_KINDS, BOARD_OBLIGATION_TARGET_KIND_ALIASES, OBLIGATION_FILTERS } from "./descriptors.js";
import {
  decorateRuntimeObligation,
  sortObligationsByPriority
} from "./obligation_priority.js";
import { boardResult, callerRuntimeAliasesFromToolContext, callerRuntimeRefFromToolContext, callerRuntimeRefParameter } from "./v2_common.js";
import { serviceRequestFromTool } from "./service_request.js";

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

export async function runtimeObligationsForCaller(api, params = {}) {
  const identity = resolveRuntimeIdentity(api, params);
  const participantIds = runtimeParticipantIds(identity);
  const threads = await listThreadRecords(api.pluginConfig);
  const obligations = sortObligationsByPriority(threads.flatMap((thread) => runtimeObligationsForThread(thread, participantIds)).map(decorateRuntimeObligation));
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
      normalizeFilter(params?.filter, "query.runtime_obligations");
      normalizeLimit(params?.limit);
      const response = await serviceListRuntimeObligations(serviceRequestFromTool(api, params, params), { pluginConfig: api.pluginConfig });
      return boardResult(response.data);
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
        scope: { type: "array", items: { type: "string" }, description: "Removed alias; use targetKinds. Present only so Parley can return a scoped deprecation diagnostic." },
        limit: { type: "number", description: "Maximum obligations to return. Defaults to 50; capped at 200." }
      }
    },
    async execute(_toolCallId, params) {
      rejectScopeAlias(params ?? {});
      normalizeFilter(params?.filter, "query.board_obligations");
      normalizeBoardTargetKinds(params ?? {});
      normalizeLimit(params?.limit);
      const response = await serviceListBoardObligations(serviceRequestFromTool(api, params, params), { pluginConfig: api.pluginConfig });
      return boardResult(response.data);
    }
  };
}
