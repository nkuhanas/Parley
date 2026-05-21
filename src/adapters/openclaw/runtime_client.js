import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createParleyEmbeddedClient, createParleyRemoteClient } from "../../client/index.js";
import { materializeProjectionResult } from "./projection_materializer.js";
import { ParleyConfigError, resolveParleyRuntimeConfig } from "../../core/config.js";
import {
  PARLEY_CREDENTIAL_CONFIG,
  PARLEY_CREDENTIAL_ENV,
  PARLEY_CREDENTIAL_FILE_CONFIG,
  PARLEY_CREDENTIAL_FILE_ENV,
  REMOTE_CREDENTIAL_FILE_OPTION,
  REMOTE_CREDENTIAL_OPTION
} from "../../core/sensitive_names.js";
import { createValidationError, QUERY_ACTIONS } from "./tools/descriptors.js";
import { serviceCallerFromTool } from "./tools/service_request.js";
import { boardResult } from "./tools/v2_common.js";

const SERVICE_QUERY_TOOL_SPECS = Object.freeze({
  parley_describe: { query: "describe", input: params => params ?? {}, result: data => rawToolResult(data) },
  parley_where_am_i: { query: "whereAmI", input: params => params ?? {}, result: data => rawToolResult(data) },
  parley_my_boards: { query: "myBoards", input: () => ({}), result: data => boardResult({ tool: "parley_my_boards", result: data }) },
  parley_board_projection: { query: "getBoardProjection", input: params => params ?? {}, result: data => boardResult({ tool: "parley_board_projection", identity: data.identity, projection: data.projection }) },
  parley_checkpoint_projection: { query: "checkpointProjection", input: params => params ?? {}, result: data => boardResult(data) },
  parley_validate_plan: { query: "validatePlan", input: params => params ?? {}, result: data => boardResult({ tool: "parley_validate_plan", identity: data.identity, validation: data.validation, setupState: data.setupState, resolved_path: data.resolved_path }) },
  parley_validate_state: { query: "validateState", input: params => params ?? {}, result: data => boardResult({ tool: "parley_validate_state", identity: data.identity, validation: data.validation }) },
  parley_get_plan_setup_status: { query: "getPlanSetupStatus", input: params => params ?? {}, result: data => boardResult({ tool: "parley_get_plan_setup_status", identity: data.identity, plan: data.plan, setupState: data.setupState }) },
  parley_get_plan_status: { query: "getPlanStatus", input: params => params ?? {}, result: data => boardResult(data) },
  parley_get_plan_overview: { query: "getPlanOverview", input: params => params ?? {}, result: data => boardResult(data) },
  parley_get_plan_phases: { query: "getPlanPhases", input: params => params ?? {}, result: data => boardResult(data) },
  parley_get_plan_review_status: { query: "getPlanReviewStatus", input: params => params ?? {}, result: data => boardResult(data) },
  parley_get_plan_relationships: { query: "getPlanRelationships", input: params => params ?? {}, result: data => boardResult(data) },
  parley_read_plan_projection: { query: "readPlanProjection", input: params => params ?? {}, result: data => boardResult(data) },
  parley_query_runtime_obligations: { query: "listRuntimeObligations", input: params => params ?? {}, result: data => boardResult(data) },
  parley_query_board_obligations: { query: "listBoardObligations", input: params => params ?? {}, result: data => boardResult(data) },
  parley_query_search: { query: "searchReferences", input: params => params ?? {}, result: data => boardResult(data) }
});

const RUNTIME_TOOL_ACTIONS = Object.freeze({
  parley_open_thread: "open_thread",
  parley_claim_turn: "claim_turn",
  parley_reply_thread: "reply_thread",
  parley_probe_thread: "probe_thread",
  parley_settle_turn: "settle_turn",
  parley_conclude_thread: "conclude_thread",
  parley_record_transport_result: "record_transport_result",
  parley_dispatch_transport_request: "dispatch_transport_request",
  parley_record_human_summary_anchor: "record_human_summary_anchor"
});

const MUTATE_TOOL_ACTIONS = Object.freeze({
  parley_register_artifact: "register_artifact",
  parley_create_object: "create_object",
  parley_record_effect: "record_effect",
  parley_create_obligation: "create_obligation",
  parley_create_trigger: "create_trigger",
  parley_resolve_obligation: "resolve_obligation",
  parley_record_relationship: "record_relationship",
  parley_remove_relationship: "remove_relationship",
  parley_create_plan: "create_plan",
  parley_write_plan_overview: "write_plan_overview",
  parley_add_plan_phase: "add_plan_phase",
  parley_add_plan_checkpoint: "add_plan_checkpoint",
  parley_request_plan_review: "request_plan_review",
  parley_replace_plan_review_routing: "replace_plan_review_routing",
  parley_cancel_plan_review: "cancel_plan_review",
  parley_mark_plan_ready: "mark_plan_ready",
  parley_record_review_decision: "record_review_decision",
  parley_record_human_review_attestation: "record_human_review_attestation",
  parley_activate_plan: "activate_plan",
  parley_pause_plan: "pause_plan",
  parley_resume_plan: "resume_plan",
  parley_record_plan_disposition: "record_plan_disposition",
  parley_record_hitl_input: "record_hitl_input",
  parley_record_phase_outcome: "record_phase_outcome"
});

const QUERY_ACTION_SET = new Set(QUERY_ACTIONS);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => {
    if (entry == null) return false;
    if (Array.isArray(entry) && entry.length === 0) return false;
    return true;
  }));
}

function loadJsonConfig(configPath) {
  if (configPath == null) return {};
  const resolvedPath = path.resolve(expandHome(configPath));
  try {
    const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("PARLEY_CONFIG must contain a JSON object");
    }
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ParleyConfigError(`Failed to parse PARLEY_CONFIG JSON: ${error.message}`, "PARLEY_CONFIG_INVALID_JSON", { configPath: resolvedPath });
    }
    if (error instanceof ParleyConfigError) throw error;
    throw new ParleyConfigError(`Failed to read PARLEY_CONFIG: ${error.message}`, "PARLEY_CONFIG_READ_FAILED", { configPath: resolvedPath });
  }
}

function authConfig(pluginConfig = {}, fileConfig = {}, env = {}) {
  return compactObject({
    [PARLEY_CREDENTIAL_FILE_CONFIG]: nonEmptyString(pluginConfig[PARLEY_CREDENTIAL_FILE_CONFIG] ?? pluginConfig[REMOTE_CREDENTIAL_FILE_OPTION])
      ?? nonEmptyString(fileConfig[PARLEY_CREDENTIAL_FILE_CONFIG] ?? fileConfig[REMOTE_CREDENTIAL_FILE_OPTION])
      ?? nonEmptyString(env[PARLEY_CREDENTIAL_FILE_ENV]),
    [PARLEY_CREDENTIAL_CONFIG]: nonEmptyString(pluginConfig[PARLEY_CREDENTIAL_CONFIG] ?? pluginConfig[REMOTE_CREDENTIAL_OPTION])
      ?? nonEmptyString(fileConfig[PARLEY_CREDENTIAL_CONFIG] ?? fileConfig[REMOTE_CREDENTIAL_OPTION])
      ?? nonEmptyString(env[PARLEY_CREDENTIAL_ENV])
  });
}

function materializeRuntimeConfig(pluginConfig = {}, runtimeConfig = {}) {
  return {
    ...pluginConfig,
    parleyMode: runtimeConfig.mode,
    ...(runtimeConfig.apiUrl != null ? { parleyApiUrl: runtimeConfig.apiUrl } : {}),
    ...(runtimeConfig.agentId != null ? { parleyAgentId: runtimeConfig.agentId } : {}),
    ...(runtimeConfig.defaultBoard != null ? { parleyDefaultBoard: runtimeConfig.defaultBoard } : {}),
    ...(runtimeConfig.stateRoot != null ? { parleyStateRoot: runtimeConfig.stateRoot } : {}),
    ...(runtimeConfig.runtimeRoot != null ? { parleyRuntimeRoot: runtimeConfig.runtimeRoot } : {}),
    ...(runtimeConfig.testRoot != null ? { parleyTestRoot: runtimeConfig.testRoot } : {}),
    ...(runtimeConfig.dbPath != null ? { parleyDbPath: runtimeConfig.dbPath } : {}),
    ...(runtimeConfig.projectionMirrorRoot != null ? { parleyProjectionMirrorRoot: runtimeConfig.projectionMirrorRoot } : {})
  };
}

export function withOpenClawRuntimeConfig(api = {}) {
  const env = api.env ?? process.env;
  const fileConfig = loadJsonConfig(nonEmptyString(env.PARLEY_CONFIG));
  const pluginConfig = api.pluginConfig ?? {};
  const runtimeConfig = resolveParleyRuntimeConfig({
    surface: "openclaw-adapter",
    pluginConfig,
    config: fileConfig,
    env
  });
  const mergedPluginConfig = {
    ...fileConfig,
    ...pluginConfig,
    ...authConfig(pluginConfig, fileConfig, env)
  };
  return {
    ...api,
    env,
    pluginConfig: {
      ...materializeRuntimeConfig(mergedPluginConfig, runtimeConfig),
      __parleySurface: "openclaw-adapter",
      __parleyRuntimeConfig: runtimeConfig
    }
  };
}

function runtimeConfig(api) {
  return api.pluginConfig?.__parleyRuntimeConfig;
}

function rawToolResult(details) {
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

function unwrapServiceResponse(response) {
  if (response?.status === "error") {
    throw new ParleyConfigError(response.message ?? "Parley service request failed.", response.code ?? "PARLEY_SERVICE_REQUEST_FAILED", response.diagnostics ?? {});
  }
  return response?.data;
}

function clientForTool(api, params) {
  const config = runtimeConfig(api);
  const caller = serviceCallerFromTool(api, params);
  if (config?.mode === "client") {
    return createParleyRemoteClient({
      apiUrl: config.apiUrl ?? api.pluginConfig?.parleyApiUrl,
      [REMOTE_CREDENTIAL_OPTION]: api.pluginConfig?.[PARLEY_CREDENTIAL_CONFIG],
      [REMOTE_CREDENTIAL_FILE_OPTION]: api.pluginConfig?.[PARLEY_CREDENTIAL_FILE_CONFIG],
      agentId: config.agentId,
      defaultBoard: config.defaultBoard,
      fetchImpl: api.fetchImpl ?? api.fetch,
      ...caller
    });
  }
  return createParleyEmbeddedClient({
    surface: "openclaw-adapter",
    pluginConfig: api.pluginConfig,
    runtimeConfig: config,
    env: api.env,
    caller
  });
}

async function executeQuery(api, params, queryName, input) {
  const response = await clientForTool(api, params).query(queryName, input, { caller: serviceCallerFromTool(api, params) });
  const data = unwrapServiceResponse(response);
  return await materializeProjectionResult(data, { runtimeConfig: runtimeConfig(api) });
}

async function executeCommand(api, params, commandName, input) {
  const response = await clientForTool(api, params).command(commandName, input, { caller: serviceCallerFromTool(api, params) });
  const data = unwrapServiceResponse(response);
  return await materializeProjectionResult(data, { runtimeConfig: runtimeConfig(api) });
}

function commandInputForAction(action, params = {}) {
  const { callerRuntimeRef: _callerRuntimeRef, boardId, ...input } = params ?? {};
  return compactObject({
    action,
    boardId,
    input
  });
}

function normalizeFacadeInput(input) {
  if (input == null) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("input must be an object");
  return input;
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

async function executeQueryFacade(api, params = {}) {
  if (!QUERY_ACTION_SET.has(params?.action)) {
    throw createValidationError(`unsupported parley_query action: ${params?.action}`, {
      code: "INVALID_PARLEY_QUERY_ACTION",
      validValues: QUERY_ACTIONS,
      describeTopic: "query"
    });
  }

  let delegatedDetails;
  if (params.action === "where_am_i") {
    delegatedDetails = await executeQuery(api, params, "whereAmI", {
      boardId: params?.boardId,
      includeTerminal: params?.includeTerminal,
      verbosity: params?.verbosity
    });
  } else if (params.action === "my_boards") {
    const data = await executeQuery(api, params, "myBoards", {});
    delegatedDetails = boardResult({ tool: "parley_my_boards", result: data }).details;
  } else if (params.action === "validate_plan") {
    const data = await executeQuery(api, params, "validatePlan", { boardId: params?.boardId, ...normalizeFacadeInput(params?.input) });
    delegatedDetails = boardResult({ tool: "parley_validate_plan", identity: data.identity, validation: data.validation, setupState: data.setupState, resolved_path: data.resolved_path }).details;
  } else if (params.action === "plan_setup_status") {
    const data = await executeQuery(api, params, "getPlanSetupStatus", { boardId: params?.boardId, ...normalizeFacadeInput(params?.input) });
    delegatedDetails = boardResult({ tool: "parley_get_plan_setup_status", identity: data.identity, plan: data.plan, setupState: data.setupState }).details;
  } else if (params.action === "plan_status") {
    const data = await executeQuery(api, params, "getPlanStatus", { boardId: params?.boardId, ...normalizeFacadeInput(params?.input) });
    delegatedDetails = boardResult(data).details;
  } else if (params.action === "plan_overview") {
    const data = await executeQuery(api, params, "getPlanOverview", { boardId: params?.boardId, ...normalizeFacadeInput(params?.input) });
    delegatedDetails = boardResult(data).details;
  } else if (params.action === "plan_phases") {
    const data = await executeQuery(api, params, "getPlanPhases", { boardId: params?.boardId, ...normalizeFacadeInput(params?.input) });
    delegatedDetails = boardResult(data).details;
  } else if (params.action === "plan_review_status") {
    const data = await executeQuery(api, params, "getPlanReviewStatus", { boardId: params?.boardId, ...normalizeFacadeInput(params?.input) });
    delegatedDetails = boardResult(data).details;
  } else if (params.action === "plan_relationships") {
    const data = await executeQuery(api, params, "getPlanRelationships", { boardId: params?.boardId, ...normalizeFacadeInput(params?.input) });
    delegatedDetails = boardResult(data).details;
  } else if (params.action === "read_plan_projection") {
    const data = await executeQuery(api, params, "readPlanProjection", { boardId: params?.boardId, ...normalizeFacadeInput(params?.input) });
    delegatedDetails = boardResult(data).details;
  } else if (params.action === "validate_state") {
    const data = await executeQuery(api, params, "validateState", { boardId: params?.boardId });
    delegatedDetails = boardResult({ tool: "parley_validate_state", identity: data.identity, validation: data.validation }).details;
  } else if (params.action === "runtime_obligations") {
    if (params?.boardId != null) {
      throw createValidationError("runtime_obligations is runtime-scoped and does not accept boardId", {
        code: "RUNTIME_OBLIGATIONS_BOARD_ID_NOT_ALLOWED",
        validValues: ["runtime_obligations", "board_obligations"],
        describeTopic: "query.runtime_obligations"
      });
    }
    const data = await executeQuery(api, params, "listRuntimeObligations", normalizeFacadeInput(params?.input));
    delegatedDetails = boardResult(data).details;
  } else if (params.action === "board_obligations") {
    const data = await executeQuery(api, params, "listBoardObligations", { boardId: params?.boardId, ...normalizeFacadeInput(params?.input) });
    delegatedDetails = boardResult(data).details;
  } else if (params.action === "search") {
    const data = await executeQuery(api, params, "searchReferences", { boardId: params?.boardId, ...normalizeFacadeInput(params?.input) });
    delegatedDetails = boardResult(data).details;
  } else {
    const data = await executeQuery(api, params, "getBoardProjection", {
      boardId: params?.boardId,
      includeRecords: params?.includeRecords,
      recordLimit: params?.recordLimit
    });
    delegatedDetails = boardResult({ tool: "parley_board_projection", identity: data.identity, projection: data.projection }).details;
  }

  return boardResult({
    tool: "parley_query",
    action: params.action,
    result: compactDelegatedDetailsForFacade(params.action, delegatedDetails)
  }, { summarize: params.action !== "where_am_i" || params?.verbosity !== "full" });
}

async function executeRuntimeSplitTool(api, tool, params = {}) {
  if (tool.name === "parley_query") return executeQueryFacade(api, params);
  if (tool.name === "parley_mutate") {
    const data = await executeCommand(api, params, "mutate", params ?? {});
    return boardResult({ tool: "parley_mutate", action: params.action, result: data });
  }

  const querySpec = SERVICE_QUERY_TOOL_SPECS[tool.name];
  if (querySpec != null) {
    const data = await executeQuery(api, params, querySpec.query, querySpec.input(params));
    return querySpec.result(data, params);
  }

  const runtimeAction = RUNTIME_TOOL_ACTIONS[tool.name];
  if (runtimeAction != null) {
    const data = await executeCommand(api, params, "runtime", {
      action: runtimeAction,
      input: params ?? {}
    });
    return rawToolResult(data);
  }

  const mutateAction = MUTATE_TOOL_ACTIONS[tool.name];
  if (mutateAction != null) {
    const data = await executeCommand(api, params, "mutate", commandInputForAction(mutateAction, params));
    return rawToolResult(data);
  }

  throw new ParleyConfigError(
    `${tool.name} is not available in OpenClaw adapter client mode until the Parley service exposes its runtime transport command boundary.`,
    "PARLEY_OPENCLAW_CLIENT_TOOL_UNSUPPORTED",
    { tool: tool.name, mode: runtimeConfig(api)?.mode }
  );
}

export function wrapOpenClawToolForRuntime(api, tool) {
  const config = runtimeConfig(api);
  if (!["client", "standalone"].includes(config?.mode)) return tool;
  const shouldWrap = config.mode === "client"
    || tool.name === "parley_query"
    || tool.name === "parley_mutate"
    || SERVICE_QUERY_TOOL_SPECS[tool.name] != null
    || RUNTIME_TOOL_ACTIONS[tool.name] != null
    || MUTATE_TOOL_ACTIONS[tool.name] != null;
  if (!shouldWrap) return tool;
  return {
    ...tool,
    async execute(toolCallId, params) {
      return executeRuntimeSplitTool(api, tool, params ?? {});
    }
  };
}
