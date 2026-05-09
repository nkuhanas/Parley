import { searchReferences } from "../../../service/index.js";
import { createValidationError } from "./descriptors.js";
import { boardResult, callerRuntimeRefParameter } from "./v2_common.js";
import { serviceRequestFromTool } from "./service_request.js";

function preserveSearchFacadeError(error) {
  if (error?.code === "VALIDATION_FAILED" && /^query is required\.?$/.test(error?.message ?? "")) {
    throw createValidationError("query.search input.query required", {
      code: "MISSING_SEARCH_QUERY",
      describeTopic: "query.search"
    });
  }
  throw error;
}

export function createNamespaceSearchAction(api) {
  return {
    name: "parley_query_search",
    label: "Parley Query Search",
    description: "Search files under board-registered reference namespaces.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId", "query"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Required board id for this board-scoped operation. Call parley_my_boards to discover accessible boards and default_board." },
        query: { type: "string", description: "Search query." },
        namespaces: { type: "array", items: { type: "string" }, description: "Optional board artifact namespace ids. Defaults to allowed reference namespaces." },
        limit: { type: "number", description: "Maximum results to return. Defaults to 20; capped at 100." }
      }
    },
    async execute(_toolCallId, params) {
      try {
        const response = await searchReferences(serviceRequestFromTool(api, params, params), { pluginConfig: api.pluginConfig });
        return boardResult(response.data);
      } catch (error) {
        preserveSearchFacadeError(error);
      }
    }
  };
}
