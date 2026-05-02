import { resolveCallerBoardMemberships } from "../../../core/board/board.js";
import { boardResult, callerRuntimeAliasesFromToolContext, callerRuntimeRefFromToolContext, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";
import { DESCRIBE_TOPICS, overviewDescriptor, topicDescriptor } from "./descriptors.js";

function normalizeTopic(value) {
  if (value == null || value === "") return "overview";
  if (typeof value !== "string" || !value.trim()) throw new Error("topic must be a non-empty string");
  return value.trim();
}

function namespaceMetadata(board) {
  return (Array.isArray(board.artifact_namespaces) ? board.artifact_namespaces : []).map((namespace) => ({
    id: namespace.id,
    roles: namespace.roles ?? [],
    default_for: namespace.default_for ?? [],
    uri_prefix: namespace.uri_prefix ?? null,
    allowed_subpaths: namespace.allowed_subpaths ?? []
  }));
}

function boardMetadata(identity) {
  return {
    board_id: identity.board.board_id,
    display_name: identity.board.display_name,
    status: identity.board.status,
    board_agent_id: identity.board_agent_id,
    global_agent_id: identity.global_agent_id,
    member_roles: identity.membership?.roles ?? [],
    permission_model: identity.board.permission_model ?? null,
    explicit_board_required: true,
    default_board_behavior: "default_board is a selection hint from parley_my_boards, not implicit routing for board-scoped calls.",
    artifact_namespaces: namespaceMetadata(identity.board),
    allowed_reference_namespaces: identity.board.allowed_reference_namespaces ?? [],
    plan_extension: identity.board.plan_extension ?? null
  };
}

function membershipsMetadata(api, params) {
  const memberships = resolveCallerBoardMemberships(api.pluginConfig, {
    callerRuntimeRef: params?.callerRuntimeRef ?? callerRuntimeRefFromToolContext(api.toolContext),
    runtimeAliases: callerRuntimeAliasesFromToolContext(api.toolContext)
  });
  return {
    global_agent_id: memberships.global_agent_id,
    default_board: memberships.default_board,
    boards: memberships.boards.map((board) => ({
      board_id: board.board_id,
      display_name: board.display_name,
      status: board.status,
      board_agent_id: board.board_agent_id,
      roles: board.roles,
      is_default: board.is_default
    }))
  };
}

export function createDescribeTool(api) {
  return {
    name: "parley_describe",
    label: "Parley Describe",
    description: "Self-describing metadata for Parley tools, facade actions, board selection, schemas, and recovery flows.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        topic: { type: "string", description: "Optional topic. Omit for overview. Valid topics include recovery, targets, query, query.runtime_obligations, query.board_obligations, query.search, mutate, mutate.create_plan, boards/identity." },
        boardId: { type: "string", description: "Optional board id. When provided, describe returns board metadata only; no board state records are read." }
      }
    },
    async execute(_toolCallId, params = {}) {
      const hasExplicitTopic = params?.topic != null && params.topic !== "";
      const topic = hasExplicitTopic ? normalizeTopic(params?.topic) : (params?.boardId != null ? "board" : "overview");
      const descriptor = topic === "board" ? { topic: "board", metadata_only: true } : topicDescriptor(topic);
      const base = descriptor ?? {
        topic,
        known: false,
        valid_topics: [...DESCRIBE_TOPICS],
        hint: "Call parley_describe({}) for an overview, or parley_describe({ topic: \"recovery\" }) for the boot sequence."
      };

      const details = {
        tool: "parley_describe",
        topic,
        descriptor: base
      };

      if (params?.boardId != null) {
        const identity = resolveToolCaller(api, params);
        details.board = boardMetadata(identity);
      } else if (topic === "boards" || topic === "identity" || topic === "boards/identity") {
        details.identity = membershipsMetadata(api, params);
      }

      if (descriptor == null && params?.boardId == null && topic !== "overview") {
        details.overview = overviewDescriptor();
      }

      return boardResult(details);
    }
  };
}
