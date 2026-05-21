import { createBoardProjectionTool } from "./board_projection.js";
import { createValidatePlanAction } from "./validate_plan.js";
import { createGetPlanSetupStatusAction } from "./get_plan_setup_status.js";
import { createGetPlanStatusAction } from "./get_plan_status.js";
import { createGetPlanOverviewAction, createGetPlanPhasesAction, createGetPlanRelationshipsAction, createGetPlanReviewStatusAction } from "./get_plan_scoped.js";
import { createReadPlanProjectionAction } from "./read_plan_projection.js";
import { createValidateStateAction } from "./validate_state.js";
import { createWhereAmITool } from "./where_am_i.js";
import { createMyBoardsTool } from "./my_boards.js";
import { createNamespaceSearchAction } from "./namespace_search.js";
import { createBoardObligationsQueryAction, createRuntimeObligationsQueryAction } from "./obligations.js";
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

function compactBoardCounts(counts = {}) {
  return Object.fromEntries(Object.entries(counts).filter(([, value]) => typeof value !== "object" || value == null));
}

function compactBoardProjectionForFacade(projection) {
  if (projection == null || typeof projection !== "object" || Array.isArray(projection)) return projection;
  return {
    board_id: projection.board_id,
    display_name: projection.display_name,
    status: projection.status,
    projection_type: projection.projection_type,
    derived: projection.derived,
    agent_count: Array.isArray(projection.agents) ? projection.agents.length : projection.counts?.agents,
    counts: compactBoardCounts(projection.counts),
    omitted: ["agents", "approval_state", "activation_state", "checkpoint_state", "relationship_graph", "records"],
    records: null,
    recordsOmitted: projection.records != null,
    detailedProjectionAvailableVia: "parley_board_projection({ includeDerivedDetails: true })",
    scopedPlanReadsAvailableVia: ["parley_get_plan_overview", "parley_get_plan_phases", "parley_get_plan_review_status", "parley_get_plan_relationships"],
    recordExcerptsAvailableVia: "parley_board_projection({ includeRecords: true })"
  };
}

function compactDelegatedDetailsForFacade(action, details) {
  if (action !== "board" || details?.projection == null) return details;
  return {
    ...details,
    projection: compactBoardProjectionForFacade(details.projection)
  };
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
        boardId: { type: "string", description: "Required for board-scoped actions. Omit for my_boards, runtime_obligations, and runtime-only where_am_i." },
        action: { type: "string", description: "Read action. Supported now: where_am_i, my_boards, board, validate_plan, plan_setup_status, plan_status, plan_overview, plan_phases, plan_review_status, plan_relationships, read_plan_projection, validate_state, runtime_obligations, board_obligations, search." },
        includeTerminal: { type: "boolean", description: "where_am_i board section only: include resolved/cancelled/superseded obligations. Defaults to false." },
        verbosity: { type: "string", description: "where_am_i only: compact or full. Defaults to compact." },
        includeRecords: { type: "boolean", description: "board only: include bounded record excerpts. Defaults to false; records are opt-in to preserve context." },
        recordLimit: { type: "number", description: "board only: maximum records per collection when includeRecords is true. Defaults to 50; 0 returns counts only." },
        input: { type: "object", description: "Action-specific input. Used by validate_plan, plan_* reads, read_plan_projection, runtime_obligations, board_obligations, and search.", additionalProperties: true }
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
          includeTerminal: params?.includeTerminal,
          verbosity: params?.verbosity
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
      } else if (params.action === "plan_setup_status") {
        const delegatedTool = createGetPlanSetupStatusAction(api);
        const delegatedParams = {
          ...shared,
          ...normalizeInput(params?.input)
        };
        assertDelegatedParams(delegatedTool, delegatedParams);
        delegated = await delegatedTool.execute(toolCallId, delegatedParams);
      } else if (params.action === "plan_status") {
        const delegatedTool = createGetPlanStatusAction(api);
        const delegatedParams = {
          ...shared,
          ...normalizeInput(params?.input)
        };
        assertDelegatedParams(delegatedTool, delegatedParams);
        delegated = await delegatedTool.execute(toolCallId, delegatedParams);
      } else if (params.action === "plan_overview") {
        const delegatedTool = createGetPlanOverviewAction(api);
        const delegatedParams = {
          ...shared,
          ...normalizeInput(params?.input)
        };
        assertDelegatedParams(delegatedTool, delegatedParams);
        delegated = await delegatedTool.execute(toolCallId, delegatedParams);
      } else if (params.action === "plan_phases") {
        const delegatedTool = createGetPlanPhasesAction(api);
        const delegatedParams = {
          ...shared,
          ...normalizeInput(params?.input)
        };
        assertDelegatedParams(delegatedTool, delegatedParams);
        delegated = await delegatedTool.execute(toolCallId, delegatedParams);
      } else if (params.action === "plan_review_status") {
        const delegatedTool = createGetPlanReviewStatusAction(api);
        const delegatedParams = {
          ...shared,
          ...normalizeInput(params?.input)
        };
        assertDelegatedParams(delegatedTool, delegatedParams);
        delegated = await delegatedTool.execute(toolCallId, delegatedParams);
      } else if (params.action === "plan_relationships") {
        const delegatedTool = createGetPlanRelationshipsAction(api);
        const delegatedParams = {
          ...shared,
          ...normalizeInput(params?.input)
        };
        assertDelegatedParams(delegatedTool, delegatedParams);
        delegated = await delegatedTool.execute(toolCallId, delegatedParams);
      } else if (params.action === "read_plan_projection") {
        const delegatedTool = createReadPlanProjectionAction(api);
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
      } else if (params.action === "runtime_obligations") {
        if (params?.boardId != null) {
          throw createValidationError("runtime_obligations is runtime-scoped and does not accept boardId", {
            code: "RUNTIME_OBLIGATIONS_BOARD_ID_NOT_ALLOWED",
            validValues: ["runtime_obligations", "board_obligations"],
            describeTopic: "query.runtime_obligations"
          });
        }
        const delegatedTool = createRuntimeObligationsQueryAction(api);
        const delegatedParams = {
          callerRuntimeRef: params?.callerRuntimeRef,
          ...normalizeInput(params?.input)
        };
        assertDelegatedParams(delegatedTool, delegatedParams);
        delegated = await delegatedTool.execute(toolCallId, delegatedParams);
      } else if (params.action === "board_obligations") {
        const delegatedTool = createBoardObligationsQueryAction(api);
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
        result: compactDelegatedDetailsForFacade(params.action, delegated.details)
      }, { summarize: params.action !== "where_am_i" || params?.verbosity !== "full" });
    }
  };
}
