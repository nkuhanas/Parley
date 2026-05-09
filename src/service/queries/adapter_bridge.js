import { createDescribeTool } from "../../adapters/openclaw/tools/describe.js";
import { createWhereAmITool } from "../../adapters/openclaw/tools/where_am_i.js";
import { boardIdForRead, explicitBoardId, normalizeServiceRequest } from "../context.js";
import { callerRuntimeRefFromServiceCaller } from "../identity.js";
import { queryResponse } from "../responses.js";

function value(input, snakeName, camelName = snakeName) {
  return input?.[snakeName] ?? input?.[camelName];
}

function bridgeApi(deps = {}) {
  return {
    pluginConfig: deps.pluginConfig,
    toolContext: null
  };
}

async function executeQueryTool(tool, params) {
  const result = await tool.execute(null, params);
  return queryResponse({ data: result.details });
}

function baseParams(caller) {
  return { callerRuntimeRef: callerRuntimeRefFromServiceCaller(caller) };
}

export async function whereAmI(request = {}, deps = {}) {
  const { caller, input } = normalizeServiceRequest(request);
  const boardId = boardIdForRead(input, caller);
  return executeQueryTool(createWhereAmITool(bridgeApi(deps)), {
    ...baseParams(caller),
    boardId,
    includeTerminal: value(input, "include_terminal", "includeTerminal"),
    verbosity: value(input, "verbosity")
  });
}

export async function describe(request = {}, deps = {}) {
  const { caller, input } = normalizeServiceRequest(request);
  return executeQueryTool(createDescribeTool(bridgeApi(deps)), {
    ...baseParams(caller),
    topic: value(input, "topic"),
    boardId: explicitBoardId(input)
  });
}
