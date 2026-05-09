import { checkpointProjection } from "../../../service/index.js";
import { SUPPORTED_CHECKPOINT_PROJECTIONS } from "../../../core/board/projection_checkpoint.js";
import { boardResult, callerRuntimeRefParameter } from "./v2_common.js";
import { serviceRequestFromTool } from "./service_request.js";

export function createCheckpointProjectionTool(api) {
  return {
    name: "parley_checkpoint_projection",
    label: "Parley Projection Checkpoint",
    description: "Compare and optionally advance a board-agent projection checkpoint keyed by board_id, board_agent_id, and projection_type.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Required board id for this board-scoped operation. Call parley_my_boards to discover accessible boards and default_board." },
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
    async execute(_toolCallId, params) {
      const response = await checkpointProjection(serviceRequestFromTool(api, params, params), { pluginConfig: api.pluginConfig });
      return boardResult(response.data);
    }
  };
}
