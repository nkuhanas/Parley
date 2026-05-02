import { resolveCallerBoardMemberships } from "../board.js";
import { boardResult, callerRuntimeRefFromToolContext, callerRuntimeAliasesFromToolContext, callerRuntimeRefParameter } from "./v2_common.js";

export function createMyBoardsTool(api) {
  return {
    name: "parley_my_boards",
    label: "Parley My Boards",
    description: "Resolve the caller to a global Parley agent and list that agent's accessible boards and default board.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter("Optional caller runtime identity override used to resolve the global Parley agent. Normal tool execution derives this from trusted OpenClaw runtime metadata.")
      }
    },
    async execute(_toolCallId, params) {
      const result = resolveCallerBoardMemberships(api.pluginConfig, {
        callerRuntimeRef: params?.callerRuntimeRef ?? callerRuntimeRefFromToolContext(api.toolContext),
        runtimeAliases: callerRuntimeAliasesFromToolContext(api.toolContext)
      });
      return boardResult({
        tool: "parley_my_boards",
        result
      });
    }
  };
}
