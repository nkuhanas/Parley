import { resolveCallerIdentity } from "../board.js";
import { requireBoardAgent } from "../board.js";

export function boardResult(details) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(details, null, 2)
      }
    ],
    details
  };
}

export function callerRuntimeRefParameter(description = "Optional caller runtime identity override used to resolve board-local Parley identity. Normal tool execution derives this from trusted OpenClaw runtime metadata.") {
  return {
    type: "object",
    description,
    additionalProperties: false,
    required: ["scheme", "type", "id"],
    properties: {
      scheme: { type: "string", description: "Runtime scheme, e.g. openclaw." },
      type: { type: "string", description: "Runtime ref type, e.g. agent, session, or subagent." },
      id: { type: "string", description: "Runtime identity id." }
    }
  };
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function callerRuntimeRefFromToolContext(toolContext) {
  const agentId = nonEmptyString(toolContext?.agentId);
  if (agentId != null) return { scheme: "openclaw", type: "agent", id: agentId };

  const sessionKey = nonEmptyString(toolContext?.sessionKey);
  if (sessionKey != null) return { scheme: "openclaw", type: "session", id: sessionKey };

  return null;
}

export function callerRuntimeAliasesFromToolContext(toolContext) {
  const aliases = [];
  const sessionKey = nonEmptyString(toolContext?.sessionKey);
  if (sessionKey != null) {
    aliases.push({
      runtime_ref: { scheme: "openclaw", type: "session", id: sessionKey },
      source: "adapter_discovered"
    });
  }
  const parentAgentId = nonEmptyString(toolContext?.parentAgentId);
  if (parentAgentId != null) {
    aliases.push({
      runtime_ref: { scheme: "openclaw", type: "agent", id: parentAgentId },
      source: "adapter_discovered"
    });
  }
  return aliases;
}

export function resolveToolCaller(api, params) {
  return resolveCallerIdentity(api.pluginConfig, {
    callerRuntimeRef: params?.callerRuntimeRef ?? callerRuntimeRefFromToolContext(api.toolContext),
    runtimeAliases: callerRuntimeAliasesFromToolContext(api.toolContext),
    boardId: params?.boardId
  });
}

export function assertBoardAgentForTool(board, boardAgentId) {
  return requireBoardAgent(board, boardAgentId).board_agent_id;
}
