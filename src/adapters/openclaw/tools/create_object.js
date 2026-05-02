import { createCoordinationObjectRecord, loadArtifactRecord, normalizeArtifactRef, saveCoordinationObjectRecord } from "../../../core/storage/board_store.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

export function createCreateObjectTool(api) {
  return {
    name: "parley_create_object",
    label: "Parley Create Coordination Object",
    description: "Create a board-scoped Parley coordination object linked to an optional artifact reference.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId", "kind", "title"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Required board id for this board-scoped operation. Call parley_my_boards to discover accessible boards and default_board." },
        objectId: { type: "string", description: "Optional stable object id. Defaults to object_<uuid>." },
        kind: { type: "string", description: "Object kind, e.g. plan, review_request, decision_record." },
        title: { type: "string", description: "Object title." },
        status: { type: "string", description: "Object status. Defaults to draft." },
        artifactId: { type: "string", description: "Optional artifact id to link." },
        artifactVersion: { type: "number", description: "Optional artifact version override." },
        participants: { type: "array", items: { type: "string" }, description: "Board-local participants." }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      let artifactRef = null;
      if (typeof params?.artifactId === "string" && params.artifactId.trim()) {
        const artifact = await loadArtifactRecord(api.pluginConfig, identity.board, params.artifactId.trim());
        if (!artifact) throw new Error(`artifact not found: ${params.artifactId}`);
        artifactRef = normalizeArtifactRef(artifact, params?.artifactVersion ?? null);
      }
      const object = createCoordinationObjectRecord({
        board_id: identity.board_id,
        object_id: params?.objectId,
        kind: params?.kind,
        title: params?.title,
        status: params?.status,
        artifact_ref: artifactRef,
        participants: params?.participants ?? [identity.board_agent_id]
      });
      const saved = await saveCoordinationObjectRecord(api.pluginConfig, identity.board, object);
      return boardResult({ tool: "parley_create_object", identity, object: saved });
    }
  };
}
