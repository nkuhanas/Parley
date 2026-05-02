import { createBoardProjectionTool } from "./board_projection.js";
import { createValidatePlanAction } from "./validate_plan.js";
import { createValidateStateAction } from "./validate_state.js";
import { createWhereAmITool } from "./where_am_i.js";
import { createMyBoardsTool } from "./my_boards.js";
import { createNamespaceSearchAction } from "./namespace_search.js";
import { createObligationsQueryAction } from "./obligations.js";
import { createValidationError, QUERY_ACTIONS } from "./descriptors.js";
import { boardResult, callerRuntimeRefParameter } from "./v2_common.js";

const QUERY_ACTION_SET = new Set(QUERY_ACTIONS);

function pickSharedParams(params) {
  const shared = {};
  if (params?.callerRuntimeRef != null) shared.callerRuntimeRef = params.callerRuntimeRef;
  if (params?.boardId != null) shared.boardId = params.boardId;
  return shared;
}

function normalizeInput(input) {
  if (input == null) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("input must be an object");
  return input;
}

function assertKnownAction(action) {
  if (!QUERY_ACTION_SET.has(action)) {
    throw createValidationError(`unsupported parley_query action: ${action}`, {
      code: "INVALID_PARLEY_QUERY_ACTION",
      validValues: QUERY_ACTIONS,
      describeTopic: "query"
    });
  }
}

function assertDelegatedParams(tool, params) {
  if (tool.parameters?.additionalProperties !== false) return;
  const allowed = new Set(Object.keys(tool.parameters?.properties ?? {}));
  for (const key of Object.keys(params)) {
    if (!allowed.has(key)) throw new Error(`${tool.name} does not accept parameter: ${key}`);
  }
}

export function createQueryTool(api) {
  return {
    name: "parley_query",
    label: "Parley Query",
    description: "Stable read façade over proven Parley v2/dev projections.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Required for board-scoped actions. Omit only for action=my_boards." },
        action: { type: "string", description: "Read action. Supported now: where_am_i, my_boards, board, validate_plan, validate_state, obligations, search." },
        includeTerminal: { type: "boolean", description: "where_am_i only: include resolved/cancelled/superseded obligations. Defaults to false." },
        includeRecords: { type: "boolean", description: "board only: include bounded record excerpts. Defaults to false; records are opt-in to preserve context." },
        recordLimit: { type: "number", description: "board only: maximum records per collection when includeRecords is true. Defaults to 50; 0 returns counts only." },
        input: { type: "object", description: "Action-specific input. Used by validate_plan, obligations, and search.", additionalProperties: true }
      }
    },
    async execute(toolCallId, params) {
      assertKnownAction(params?.action);
      const shared = pickSharedParams(params);
      let delegated;

      if (params.action === "where_am_i") {
        const delegatedTool = createWhereAmITool(api);
        const delegatedParams = {
          ...shared,
          includeTerminal: params?.includeTerminal
        };
        assertDelegatedParams(delegatedTool, delegatedParams);
        delegated = await delegatedTool.execute(toolCallId, delegatedParams);
      } else if (params.action === "my_boards") {
        const delegatedTool = createMyBoardsTool(api);
        const delegatedParams = { ...shared };
        assertDelegatedParams(delegatedTool, delegatedParams);
        delegated = await delegatedTool.execute(toolCallId, delegatedParams);
      } else if (params.action === "validate_plan") {
        const delegatedTool = createValidatePlanAction(api);
        const delegatedParams = {
          ...shared,
          ...normalizeInput(params?.input)
        };
        assertDelegatedParams(delegatedTool, delegatedParams);
        delegated = await delegatedTool.execute(toolCallId, delegatedParams);
      } else if (params.action === "validate_state") {
        const delegatedTool = createValidateStateAction(api);
        const delegatedParams = { ...shared };
        assertDelegatedParams(delegatedTool, delegatedParams);
        delegated = await delegatedTool.execute(toolCallId, delegatedParams);
      } else if (params.action === "obligations") {
        const delegatedTool = createObligationsQueryAction(api);
        const delegatedParams = {
          ...shared,
          ...normalizeInput(params?.input)
        };
        assertDelegatedParams(delegatedTool, delegatedParams);
        delegated = await delegatedTool.execute(toolCallId, delegatedParams);
      } else if (params.action === "search") {
        const delegatedTool = createNamespaceSearchAction(api);
        const delegatedParams = {
          ...shared,
          ...normalizeInput(params?.input)
        };
        assertDelegatedParams(delegatedTool, delegatedParams);
        delegated = await delegatedTool.execute(toolCallId, delegatedParams);
      } else {
        const delegatedTool = createBoardProjectionTool(api);
        const delegatedParams = {
          ...shared,
          includeRecords: params?.includeRecords,
          recordLimit: params?.recordLimit
        };
        assertDelegatedParams(delegatedTool, delegatedParams);
        delegated = await delegatedTool.execute(toolCallId, delegatedParams);
      }

      return boardResult({
        tool: "parley_query",
        action: params.action,
        result: delegated.details
      });
    }
  };
}
