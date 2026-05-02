import {
  createEffectRecord,
  createRelationshipRecord,
  loadArtifactRecord,
  loadCoordinationObjectRecord,
  loadRelationshipRecord,
  saveEffectRecord,
  saveRelationshipRecord
} from "../board_store.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

const relationshipRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "id"],
  properties: {
    kind: { type: "string", description: "Relationship endpoint kind: artifact or object." },
    id: { type: "string", description: "Board-scoped artifact_id or object_id." },
    version: { type: "number", description: "Optional positive artifact version for artifact endpoints." }
  }
};

async function assertEndpointExists(pluginConfig, board, endpoint, fieldName) {
  if (endpoint?.kind === "artifact") {
    const artifact = await loadArtifactRecord(pluginConfig, board, endpoint.id);
    if (!artifact) throw new Error(`${fieldName} artifact not found: ${endpoint.id}`);
    return;
  }
  if (endpoint?.kind === "object") {
    const object = await loadCoordinationObjectRecord(pluginConfig, board, endpoint.id);
    if (!object) throw new Error(`${fieldName} object not found: ${endpoint.id}`);
    return;
  }
  throw new Error(`${fieldName}.kind must be artifact or object`);
}

export function createRecordRelationshipTool(api) {
  return {
    name: "parley_record_relationship",
    label: "Parley Record Relationship",
    description: "Create a board-scoped relationship record and matching append-only relationship_added effect.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["type", "from", "to"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Optional board override. Normal MVP use derives the board from callerRuntimeRef." },
        relationshipId: { type: "string", description: "Optional stable relationship id. Defaults to relationship_<uuid>." },
        effectId: { type: "string", description: "Optional stable effect id for the relationship_added effect." },
        type: { type: "string", description: "Relationship type, e.g. depends_on, supersedes, refines, related_to." },
        from: relationshipRefSchema,
        to: relationshipRefSchema,
        reason: { type: "string", description: "Optional reason for the relationship." },
        correctionOf: { type: "string", description: "Optional relationship_id this new relationship corrects." },
        correction_of: { type: "string", description: "Snake-case alias for correctionOf." },
        replacesRelationshipId: { type: "string", description: "Optional relationship_id this new relationship replaces." },
        replaces_relationship_id: { type: "string", description: "Snake-case alias for replacesRelationshipId." },
        sourceThreadId: { type: "string", description: "Optional source Parley thread id." },
        sourceMessageId: { type: "string", description: "Optional source Parley message id." }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      await assertEndpointExists(api.pluginConfig, identity.board, params?.from, "from");
      await assertEndpointExists(api.pluginConfig, identity.board, params?.to, "to");

      const correctionOf = params?.correctionOf ?? params?.correction_of ?? null;
      const replacesRelationshipId = params?.replacesRelationshipId ?? params?.replaces_relationship_id ?? null;
      if (correctionOf != null) {
        const corrected = await loadRelationshipRecord(api.pluginConfig, identity.board, correctionOf);
        if (!corrected) throw new Error(`correctionOf relationship not found: ${correctionOf}`);
      }
      if (replacesRelationshipId != null) {
        const replaced = await loadRelationshipRecord(api.pluginConfig, identity.board, replacesRelationshipId);
        if (!replaced) throw new Error(`replacesRelationshipId relationship not found: ${replacesRelationshipId}`);
      }

      const relationshipDraft = createRelationshipRecord({
        board_id: identity.board_id,
        relationship_id: params?.relationshipId,
        type: params?.type,
        from: params?.from,
        to: params?.to,
        actor: identity.actor,
        reason: params?.reason,
        correction_of: correctionOf,
        replaces_relationship_id: replacesRelationshipId
      });
      const existingRelationship = await loadRelationshipRecord(api.pluginConfig, identity.board, relationshipDraft.relationship_id);
      if (existingRelationship) throw new Error(`relationship record already exists: ${relationshipDraft.relationship_id}`);

      const effect = createEffectRecord({
        board_id: identity.board_id,
        effect_id: params?.effectId,
        type: "relationship_added",
        actor: identity.actor,
        target: {
          relationship_id: relationshipDraft.relationship_id,
          relationship_type: relationshipDraft.type,
          from: relationshipDraft.from,
          to: relationshipDraft.to
        },
        payload: {
          ...(params?.reason ? { reason: params.reason } : {}),
          ...(correctionOf != null ? { correction_of: correctionOf } : {}),
          ...(replacesRelationshipId != null ? { replaces_relationship_id: replacesRelationshipId } : {})
        },
        source_thread_id: params?.sourceThreadId,
        source_message_id: params?.sourceMessageId
      });
      const savedEffect = await saveEffectRecord(api.pluginConfig, identity.board, effect);
      const relationship = createRelationshipRecord({
        ...relationshipDraft,
        source_effect_id: savedEffect.effect_id,
        created_at: relationshipDraft.created_at,
        updated_at: relationshipDraft.updated_at
      });
      const savedRelationship = await saveRelationshipRecord(api.pluginConfig, identity.board, relationship);
      return boardResult({
        tool: "parley_record_relationship",
        identity,
        relationship: savedRelationship,
        effect: savedEffect
      });
    }
  };
}
