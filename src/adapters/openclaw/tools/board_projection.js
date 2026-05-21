import { getBoardProjection } from "../../../service/index.js";
import { boardResult, callerRuntimeRefParameter } from "./v2_common.js";
import { serviceRequestFromTool } from "./service_request.js";

export function createBoardProjectionTool(api) {
  return {
    name: "parley_board_projection",
    label: "Parley Board Projection",
    description: "Return a compact read-only board projection. Detailed derived state is opt-in; prefer scoped plan and obligation read tools when possible.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Required board id for this board-scoped operation. Call parley_my_boards to discover accessible boards and default_board." },
        includeRecords: { type: "boolean", description: "Include bounded record excerpts. Defaults to false; records are opt-in to preserve context." },
        recordLimit: { type: "number", description: "Maximum records per collection when includeRecords is true. Defaults to 50; 0 returns counts only." },
        includeDerivedDetails: { type: "boolean", description: "Include agents, approval state, activation state, checkpoint state, relationship graph, and nested count breakdowns. Defaults to false; prefer scoped plan reads when possible." }
      }
    },
    async execute(_toolCallId, params) {
      const response = await getBoardProjection(serviceRequestFromTool(api, params, params), { pluginConfig: api.pluginConfig });
      return boardResult({
        tool: "parley_board_projection",
        identity: response.data.identity,
        projection: response.data.projection
      });
    }
  };
}
