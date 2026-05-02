import { createBoardProjectionTool } from "./board_projection.js";
import { createWhereAmITool } from "./where_am_i.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";
import {
  createProjectionCheckpointRecord,
  loadProjectionCheckpointRecord,
  saveProjectionCheckpointRecord
} from "../../../core/storage/board_store.js";
import {
  buildProjectionCursor,
  compareProjectionCursors,
  normalizeProjectionType,
  SUPPORTED_CHECKPOINT_PROJECTIONS
} from "../../../core/board/projection_checkpoint.js";
import { nowIso } from "../../../core/time.js";

async function buildProjectionForCheckpoint(api, toolCallId, params, projectionType) {
  if (projectionType === "where_am_i") {
    const delegated = await createWhereAmITool(api).execute(toolCallId, {
      callerRuntimeRef: params?.callerRuntimeRef,
      boardId: params?.boardId,
      includeTerminal: params?.includeTerminal
    });
    return delegated.details.projection;
  }

  const delegated = await createBoardProjectionTool(api).execute(toolCallId, {
    callerRuntimeRef: params?.callerRuntimeRef,
    boardId: params?.boardId,
    includeRecords: false
  });
  return delegated.details.projection;
}

export function createCheckpointProjectionTool(api) {
  return {
    name: "parley_checkpoint_projection",
    label: "Parley Projection Checkpoint",
    description: "Compare and optionally advance a board-agent projection checkpoint keyed by board_id, board_agent_id, and projection_type.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Optional board override. Normal MVP use derives the board from callerRuntimeRef." },
        projectionType: {
          type: "string",
          description: `Projection checkpoint to inspect or advance. Supported: ${SUPPORTED_CHECKPOINT_PROJECTIONS.join(", ")}. Defaults to minimal_board.`
        },
        advance: {
          type: "boolean",
          description: "When true, persist the current cursor as the caller's last-seen checkpoint. Defaults to false for read-only inspection."
        },
        includeTerminal: {
          type: "boolean",
          description: "where_am_i checkpoints only: include resolved/cancelled/superseded obligations when computing the cursor. Defaults to false."
        }
      }
    },
    async execute(toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const projectionType = normalizeProjectionType(params?.projectionType);
      const previousCheckpoint = await loadProjectionCheckpointRecord(
        api.pluginConfig,
        identity.board,
        identity.board_agent_id,
        projectionType
      );
      const projection = await buildProjectionForCheckpoint(api, toolCallId, params, projectionType);
      const currentCursor = buildProjectionCursor(projectionType, projection);
      const comparison = compareProjectionCursors(previousCheckpoint?.cursor ?? null, currentCursor);

      let checkpoint = previousCheckpoint;
      if (params?.advance === true) {
        const timestamp = nowIso();
        checkpoint = await saveProjectionCheckpointRecord(
          api.pluginConfig,
          identity.board,
          createProjectionCheckpointRecord({
            board_id: identity.board_id,
            board_agent_id: identity.board_agent_id,
            projection_type: projectionType,
            cursor: currentCursor,
            last_seen_at: timestamp,
            last_seen_by_runtime_ref: identity.runtime_ref,
            created_at: previousCheckpoint?.created_at ?? timestamp,
            updated_at: timestamp
          })
        );
      }

      return boardResult({
        tool: "parley_checkpoint_projection",
        identity,
        projection_type: projectionType,
        advanced: params?.advance === true,
        comparison,
        previous_checkpoint: previousCheckpoint,
        current_cursor: currentCursor,
        checkpoint
      });
    }
  };
}
