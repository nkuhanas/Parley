import { buildBoardProjection } from "../../core/board/board_projection.js";
import { loadPlanSetupRecord } from "../../core/storage/board_store.js";
import { derivePlanSetupState, isHumanGatePhase, renderPlanSetupMarkdown } from "../../core/plan/plan_state.js";
import { explicitPlanStatus } from "../../core/plan/plan_status.js";
import { planProjectionPayload } from "../../core/plan/projection.js";
import { validateParleyPlanV1Document } from "../../core/schema/index.js";
import { normalizeServiceRequest } from "../context.js";
import { SERVICE_ERROR_CODES, serviceError } from "../errors.js";
import { queryResponse } from "../responses.js";
import { resolveServiceCallerIdentity, resolveServiceCallerMemberships } from "../identity.js";

function value(input, snakeName, camelName = snakeName) {
  return input?.[snakeName] ?? input?.[camelName];
}

function requireString(input, snakeName, camelName = snakeName) {
  const raw = value(input, snakeName, camelName);
  if (typeof raw !== "string" || !raw.trim()) {
    throw serviceError(SERVICE_ERROR_CODES.VALIDATION_FAILED, `${snakeName} is required.`);
  }
  return raw.trim();
}

function summarizeIdentity(identity) {
  return {
    board_id: identity.board_id,
    global_agent_id: identity.global_agent_id,
    board_agent_id: identity.board_agent_id
  };
}

function summarizePlan(plan) {
  return {
    plan_id: plan.plan_id,
    title: plan.title,
    status: plan.status,
    phase_count: plan.phases.length,
    checkpoint_count: plan.phases.filter(isHumanGatePhase).length,
    generatedMarkdownPath: plan.landing.resolved_path,
    generatedMarkdownUri: plan.landing.uri
  };
}

export async function myBoards(request = {}, deps = {}) {
  const { caller } = normalizeServiceRequest(request);
  const result = resolveServiceCallerMemberships(deps.pluginConfig, caller);
  return queryResponse({ data: result });
}

export async function getBoardProjection(request = {}, deps = {}) {
  const { caller, input } = normalizeServiceRequest(request);
  const identity = resolveServiceCallerIdentity(deps.pluginConfig, caller, input);
  const projection = await buildBoardProjection(deps.pluginConfig, identity.board, {
    includeRecords: value(input, "include_records", "includeRecords"),
    recordLimit: value(input, "record_limit", "recordLimit")
  });
  return queryResponse({
    data: {
      identity: summarizeIdentity(identity),
      projection
    }
  });
}

export async function getPlanSetupStatus(request = {}, deps = {}) {
  const { caller, input } = normalizeServiceRequest(request);
  const identity = resolveServiceCallerIdentity(deps.pluginConfig, caller, input);
  const planId = requireString(input, "plan_id", "planId");
  const plan = await loadPlanSetupRecord(deps.pluginConfig, identity.board, planId);
  if (plan == null) {
    throw serviceError(SERVICE_ERROR_CODES.PLAN_NOT_FOUND, `Parley plan not found: ${planId}`);
  }
  return queryResponse({
    data: {
      identity: summarizeIdentity(identity),
      plan: summarizePlan(plan),
      setupState: derivePlanSetupState(plan, identity.board)
    }
  });
}

export async function getPlanStatus(request = {}, deps = {}) {
  const { caller, input } = normalizeServiceRequest(request);
  const identity = resolveServiceCallerIdentity(deps.pluginConfig, caller, input);
  const planId = requireString(input, "plan_id", "planId");
  const plan = await loadPlanSetupRecord(deps.pluginConfig, identity.board, planId);
  if (plan == null) {
    throw serviceError(SERVICE_ERROR_CODES.PLAN_NOT_FOUND, `Parley plan not found: ${planId}`);
  }
  return queryResponse({
    data: {
      tool: "parley_get_plan_status",
      identity: summarizeIdentity(identity),
      ...(await explicitPlanStatus({ pluginConfig: deps.pluginConfig }, identity, plan))
    }
  });
}

export async function readPlanProjection(request = {}, deps = {}) {
  const { caller, input } = normalizeServiceRequest(request);
  const identity = resolveServiceCallerIdentity(deps.pluginConfig, caller, input);
  const planId = requireString(input, "plan_id", "planId");
  const plan = await loadPlanSetupRecord(deps.pluginConfig, identity.board, planId);
  if (plan == null) {
    throw serviceError(SERVICE_ERROR_CODES.PLAN_NOT_FOUND, `Parley plan not found: ${planId}`);
  }
  const markdown = renderPlanSetupMarkdown(plan);
  const validation = validateParleyPlanV1Document(markdown);
  return queryResponse({
    data: {
      tool: "parley_read_plan_projection",
      identity: summarizeIdentity(identity),
      plan: { ...summarizePlan(plan), projection_validation: validation },
      projection: planProjectionPayload({ plan, markdown })
    }
  });
}
