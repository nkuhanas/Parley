import {
  listArtifactRecords,
  listCoordinationObjectRecords,
  listEffectRecords,
  listObligationRecords
} from "../../../core/storage/board_store.js";
import { createValidationError, OBLIGATION_FILTERS, TARGET_KIND_ALIASES } from "./descriptors.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

const TERMINAL_STATUSES = new Set(["resolved", "cancelled", "superseded"]);
const NEEDS_MY_ACTION_STATUSES = new Set(["active", "blocking", "waiting", "deferred", "stale"]);

function normalizeStringArray(value, fieldName) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) throw new Error(`${fieldName}[${index}] must be a non-empty string`);
    return item.trim();
  });
}

function normalizeTargetKinds(input = {}) {
  const raw = input.targetKinds ?? input.target_kinds ?? input.scope;
  const normalized = normalizeStringArray(raw, "targetKinds").map((kind) => {
    const mapped = TARGET_KIND_ALIASES[kind];
    if (mapped == null) {
      throw createValidationError(`invalid obligations targetKinds item: ${kind}`, {
        code: "INVALID_OBLIGATIONS_TARGET_KIND",
        validValues: Object.keys(TARGET_KIND_ALIASES),
        describeTopic: "query.obligations"
      });
    }
    return mapped;
  });
  return [...new Set(normalized)];
}

function normalizeFilter(value) {
  const filter = value == null ? "needs_my_action" : value;
  if (typeof filter !== "string" || !filter.trim()) throw new Error("filter must be a non-empty string");
  const normalized = filter.trim();
  if (!OBLIGATION_FILTERS.includes(normalized)) {
    throw createValidationError(`invalid obligations filter: ${normalized}`, {
      code: "INVALID_OBLIGATIONS_FILTER",
      validValues: OBLIGATION_FILTERS,
      describeTopic: "query.obligations"
    });
  }
  return normalized;
}

function normalizeLimit(value) {
  if (value == null) return 50;
  if (!Number.isInteger(value) || value < 0) throw new Error("limit must be a non-negative integer");
  return Math.min(value, 200);
}

function targetKindsForObligation(obligation) {
  const target = obligation?.target ?? {};
  const kinds = [];
  if (target.thread_id != null || target.message_id != null) kinds.push("threads");
  if (target.plan_id != null) kinds.push("plans");
  if (target.artifact_id != null) kinds.push("artifacts");
  if (target.object_id != null) kinds.push("objects");
  if (target.phase_id != null) kinds.push("phases");
  if (target.relationship_id != null) kinds.push("relationships");
  if (target.obligation_id != null) kinds.push("obligations");
  return kinds.length > 0 ? kinds : ["unknown"];
}

function includeByFilter(obligation, identity, filter) {
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

export function createObligationsQueryAction(api) {
  return {
    name: "parley_query_obligations",
    label: "Parley Query Obligations",
    description: "Return board-scoped obligations filtered by actor and target kind.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Required board id for this board-scoped operation. Call parley_my_boards to discover accessible boards and default_board." },
        filter: { type: "string", description: "Filter to apply: needs_my_action, assigned_to_me, or all. Defaults to needs_my_action." },
        targetKinds: { type: "array", items: { type: "string" }, description: "Optional target kinds, e.g. threads, plans, artifacts, objects. Alias: scope." },
        scope: { type: "array", items: { type: "string" }, description: "Alias for targetKinds." },
        limit: { type: "number", description: "Maximum obligations to return. Defaults to 50; capped at 200." }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const filter = normalizeFilter(params?.filter);
      const targetKinds = normalizeTargetKinds(params ?? {});
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
        .filter((obligation) => includeByFilter(obligation, identity, filter))
        .map((obligation) => ({ obligation, target_kinds: targetKindsForObligation(obligation) }))
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
            thread_id: item.obligation.target?.thread_id ?? null,
            message_id: item.obligation.target?.message_id ?? null
          }
        };
      });
      return boardResult({
        tool: "parley_query_obligations",
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
