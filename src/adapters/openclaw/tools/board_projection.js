import { buildBoardProjection } from "../../../core/board/board_projection.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

export function createBoardProjectionTool(api) {
  return {
    name: "parley_board_projection",
    label: "Parley Board Projection",
    description: "Return a read-only minimal projection of board-scoped Parley state for situational awareness.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Required board id for this board-scoped operation. Call parley_my_boards to discover accessible boards and default_board." },
        includeRecords: { type: "boolean", description: "Include bounded record excerpts. Defaults to false; records are opt-in to preserve context." },
        recordLimit: { type: "number", description: "Maximum records per collection when includeRecords is true. Defaults to 50; 0 returns counts only." }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const projection = await buildBoardProjection(api.pluginConfig, identity.board, {
        includeRecords: params?.includeRecords,
        recordLimit: params?.recordLimit
      });
      return boardResult({
        tool: "parley_board_projection",
        identity,
        projection
      });
    }
  };
}
