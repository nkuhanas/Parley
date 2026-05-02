import {
  createEffectRecord,
  loadRelationshipRecord,
  saveEffectRecord,
  saveRelationshipRecord
} from "../../../core/storage/board_store.js";
import { assertNonEmptyString } from "../../../core/board/board_schema.js";
import { nowIso } from "../../../core/time.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

const REMOVAL_STATUSES = new Set(["removed", "superseded"]);

function normalizeRemovalStatus(value) {
  if (value == null) return "removed";
  if (typeof value === "string" && REMOVAL_STATUSES.has(value)) return value;
  throw new Error("removalStatus must be removed or superseded");
}

export function createRemoveRelationshipTool(api) {
  return {
    name: "parley_remove_relationship",
    label: "Parley Remove Relationship",
    description: "Logically remove a board relationship through an append-only relationship_removed effect; original history remains intact.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId", "relationshipId", "reason"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Required board id for this board-scoped operation. Call parley_my_boards to discover accessible boards and default_board." },
        relationshipId: { type: "string", description: "Board-scoped relationship_id to mark inactive in normal projections." },
        effectId: { type: "string", description: "Optional stable effect id for the relationship_removed effect." },
        reason: { type: "string", description: "Required reason for logical removal/correction." },
        removalStatus: { type: "string", description: "Relationship status to apply. Defaults to removed; use superseded when replacing with a corrected edge." },
        supersededByRelationshipId: { type: "string", description: "Optional corrected replacement relationship_id." },
        superseded_by_relationship_id: { type: "string", description: "Snake-case alias for supersededByRelationshipId." },
        sourceThreadId: { type: "string", description: "Optional source Parley thread id." },
        sourceMessageId: { type: "string", description: "Optional source Parley message id." }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const relationshipId = assertNonEmptyString(params?.relationshipId, "relationshipId");
      const reason = assertNonEmptyString(params?.reason, "reason");
      const removalStatus = normalizeRemovalStatus(params?.removalStatus);
      const relationship = await loadRelationshipRecord(api.pluginConfig, identity.board, relationshipId);
      if (!relationship) throw new Error(`relationship not found: ${relationshipId}`);
      if (relationship.status !== "active") throw new Error(`relationship is not active: ${relationshipId}`);
      const supersededByRelationshipId = params?.supersededByRelationshipId ?? params?.superseded_by_relationship_id ?? null;
      if (supersededByRelationshipId != null) {
        const replacement = await loadRelationshipRecord(api.pluginConfig, identity.board, supersededByRelationshipId);
        if (!replacement) throw new Error(`supersededByRelationshipId relationship not found: ${supersededByRelationshipId}`);
      }

      const effect = createEffectRecord({
        board_id: identity.board_id,
        effect_id: params?.effectId,
        type: "relationship_removed",
        actor: identity.actor,
        target: {
          relationship_id: relationship.relationship_id,
          relationship_type: relationship.type,
          from: relationship.from,
          to: relationship.to
        },
        payload: {
          reason,
          removal_mode: "inactive_in_projection",
          relationship_status: removalStatus,
          ...(supersededByRelationshipId != null ? { superseded_by_relationship_id: supersededByRelationshipId } : {})
        },
        source_thread_id: params?.sourceThreadId,
        source_message_id: params?.sourceMessageId
      });
      const savedEffect = await saveEffectRecord(api.pluginConfig, identity.board, effect);
      const removedAt = nowIso();
      const savedRelationship = await saveRelationshipRecord(api.pluginConfig, identity.board, {
        ...relationship,
        status: removalStatus,
        removed_effect_id: savedEffect.effect_id,
        removed_at: removedAt,
        updated_at: removedAt
      });

      return boardResult({
        tool: "parley_remove_relationship",
        identity,
        relationship: savedRelationship,
        effect: savedEffect
      });
    }
  };
}
