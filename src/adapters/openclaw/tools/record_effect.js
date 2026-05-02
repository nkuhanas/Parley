import { createEffectRecord, saveEffectRecord } from "../../../core/storage/board_store.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

function normalizePositiveInteger(value) {
  if (value == null) return null;
  if (Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (parsed > 0) return parsed;
  }
  throw new Error("artifact_version must be a positive integer");
}

function firstValue(...values) {
  for (const value of values) {
    if (value != null) return value;
  }
  return null;
}

async function normalizeApprovalEffectTarget(_pluginConfig, _board, type, target = {}, payload = {}) {
  if (type !== "approval_recorded" && type !== "approval_withdrawn" && type !== "objection_raised") return target;
  const artifactId = firstValue(target.artifact_id, payload.artifact_id);
  if (typeof artifactId !== "string" || !artifactId.trim()) {
    throw new Error(`${type} requires target.artifact_id`);
  }
  const artifactVersion = normalizePositiveInteger(firstValue(
    target.artifact_version,
    target.version,
    payload.artifact_version,
    payload.version
  ));
  if (artifactVersion == null) throw new Error(`${type} requires target.artifact_version`);
  const scope = firstValue(target.scope, target.authority_scope, payload.scope, payload.authority_scope);
  if (typeof scope !== "string" || !scope.trim()) {
    throw new Error(`${type} requires target.scope`);
  }
  return {
    ...target,
    artifact_id: artifactId.trim(),
    artifact_version: artifactVersion,
    scope: scope.trim()
  };
}

export function createRecordEffectTool(api) {
  return {
    name: "parley_record_effect",
    label: "Parley Record Effect",
    description: "Append a board-scoped immutable Parley effect for the v2/dev object/effect/obligation slice.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["type", "target"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Optional board override. Normal MVP use derives the board from callerRuntimeRef." },
        effectId: { type: "string", description: "Optional effect id. Defaults to effect_<uuid>." },
        type: { type: "string", description: "Effect type, e.g. artifact_linked or review_requested." },
        target: { type: "object", additionalProperties: true, description: "Effect target payload." },
        payload: { type: "object", additionalProperties: true, description: "Effect-specific payload." },
        sourceThreadId: { type: "string", description: "Optional source Parley thread id." },
        sourceMessageId: { type: "string", description: "Optional source Parley message id." }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const target = await normalizeApprovalEffectTarget(api.pluginConfig, identity.board, params?.type, params?.target, params?.payload);
      const effect = createEffectRecord({
        board_id: identity.board_id,
        effect_id: params?.effectId,
        type: params?.type,
        actor: identity.actor,
        target,
        payload: params?.payload,
        source_thread_id: params?.sourceThreadId,
        source_message_id: params?.sourceMessageId
      });
      const saved = await saveEffectRecord(api.pluginConfig, identity.board, effect);
      return boardResult({ tool: "parley_record_effect", identity, effect: saved });
    }
  };
}
