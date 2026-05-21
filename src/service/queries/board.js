import { buildBoardProjection } from "../../core/board/board_projection.js";
import {
  listCoordinationObjectRecords,
  listObligationRecords,
  listRelationshipRecords,
  loadPlanSetupRecord
} from "../../core/storage/board_store.js";
import { boardAgentIds, derivePlanSetupState, isHumanGatePhase, renderPlanSetupMarkdown } from "../../core/plan/plan_state.js";
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

async function loadPlanForQuery(deps, identity, input) {
  const planId = requireString(input, "plan_id", "planId");
  const plan = await loadPlanSetupRecord(deps.pluginConfig, identity.board, planId);
  if (plan == null) {
    throw serviceError(SERVICE_ERROR_CODES.PLAN_NOT_FOUND, `Parley plan not found: ${planId}`);
  }
  return plan;
}

function countBy(records, fieldName) {
  const counts = {};
  for (const record of records) {
    const key = record?.[fieldName] ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function reviewState(plan, board, obligations = []) {
  const review = plan.review ?? { required_reviewers: [], approvals: [], objections: [] };
  const required = Array.isArray(review.required_reviewers) ? review.required_reviewers : [];
  const approvals = Array.isArray(review.approvals) ? review.approvals : [];
  const objections = Array.isArray(review.objections) ? review.objections : [];
  const valid = new Set(boardAgentIds(board));
  const pending = required.filter((reviewer) => valid.has(reviewer) && !approvals.includes(reviewer));
  const invalid = required.filter((reviewer) => !valid.has(reviewer));
  return {
    status: plan.status,
    required_reviewers: required,
    board_local_required_reviewers: required.filter((reviewer) => valid.has(reviewer)),
    pending_reviewers: pending,
    invalid_required_reviewers: invalid,
    approvals,
    objections,
    approved: required.length > 0 && pending.length === 0 && invalid.length === 0,
    lifecycle_review_obligations: obligations.map((obligation) => ({
      obligation_id: obligation.obligation_id,
      agent: obligation.agent,
      status: obligation.status,
      resolution: obligation.resolution ?? null,
      reason: obligation.reason ?? null
    }))
  };
}

function refKey(ref = {}) {
  if (ref.kind == null || ref.id == null) return null;
  return `${ref.kind}:${ref.id}`;
}

async function planRelationshipState(deps, identity, plan) {
  const [objects, relationships] = await Promise.all([
    listCoordinationObjectRecords(deps.pluginConfig, identity.board),
    listRelationshipRecords(deps.pluginConfig, identity.board)
  ]);
  const planObjects = objects.filter((object) => object.kind === "plan" && object.artifact_ref?.artifact_id === plan.artifact_id);
  const relatedRefs = new Set([
    plan.artifact_id == null ? null : `artifact:${plan.artifact_id}`,
    ...planObjects.map((object) => `object:${object.object_id}`)
  ].filter(Boolean));
  const boardRelationships = relationships.filter((relationship) => relatedRefs.has(refKey(relationship.from)) || relatedRefs.has(refKey(relationship.to)));
  return {
    declared_relationships: plan.relationships ?? null,
    plan_objects: planObjects.map((object) => ({
      object_id: object.object_id,
      title: object.title,
      status: object.status,
      artifact_ref: object.artifact_ref
    })),
    board_relationships: boardRelationships,
    counts: {
      declared_relationship_groups: plan.relationships && typeof plan.relationships === "object" ? Object.keys(plan.relationships).length : 0,
      plan_objects: planObjects.length,
      board_relationships: boardRelationships.length,
      board_relationships_by_type: countBy(boardRelationships, "type"),
      board_relationships_by_status: countBy(boardRelationships, "status")
    }
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
    recordLimit: value(input, "record_limit", "recordLimit"),
    includeDerivedDetails: value(input, "include_derived_details", "includeDerivedDetails") ?? value(input, "include_details", "includeDetails")
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
  const plan = await loadPlanForQuery(deps, identity, input);
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
  const plan = await loadPlanForQuery(deps, identity, input);
  return queryResponse({
    data: {
      tool: "parley_get_plan_status",
      identity: summarizeIdentity(identity),
      ...(await explicitPlanStatus({ pluginConfig: deps.pluginConfig }, identity, plan))
    }
  });
}

export async function getPlanOverview(request = {}, deps = {}) {
  const { caller, input } = normalizeServiceRequest(request);
  const identity = resolveServiceCallerIdentity(deps.pluginConfig, caller, input);
  const plan = await loadPlanForQuery(deps, identity, input);
  return queryResponse({
    data: {
      tool: "parley_get_plan_overview",
      identity: summarizeIdentity(identity),
      plan: summarizePlan(plan),
      overview: plan.overview
    }
  });
}

export async function getPlanPhases(request = {}, deps = {}) {
  const { caller, input } = normalizeServiceRequest(request);
  const identity = resolveServiceCallerIdentity(deps.pluginConfig, caller, input);
  const plan = await loadPlanForQuery(deps, identity, input);
  return queryResponse({
    data: {
      tool: "parley_get_plan_phases",
      identity: summarizeIdentity(identity),
      plan: summarizePlan(plan),
      phases: plan.phases,
      counts: {
        phases: plan.phases.length,
        by_kind: countBy(plan.phases, "kind"),
        by_status: countBy(plan.phases, "status"),
        human_gates: plan.phases.filter(isHumanGatePhase).length
      }
    }
  });
}

export async function getPlanReviewStatus(request = {}, deps = {}) {
  const { caller, input } = normalizeServiceRequest(request);
  const identity = resolveServiceCallerIdentity(deps.pluginConfig, caller, input);
  const plan = await loadPlanForQuery(deps, identity, input);
  const obligations = (await listObligationRecords(deps.pluginConfig, identity.board)).filter((obligation) => {
    const binding = obligation.managedBinding ?? obligation.managed_binding;
    return obligation.target?.plan_id === plan.plan_id
      && (obligation.scope === "plan_lifecycle:review_decision" || binding?.role === "review_decision");
  });
  return queryResponse({
    data: {
      tool: "parley_get_plan_review_status",
      identity: summarizeIdentity(identity),
      plan: summarizePlan(plan),
      review: reviewState(plan, identity.board, obligations)
    }
  });
}

export async function getPlanRelationships(request = {}, deps = {}) {
  const { caller, input } = normalizeServiceRequest(request);
  const identity = resolveServiceCallerIdentity(deps.pluginConfig, caller, input);
  const plan = await loadPlanForQuery(deps, identity, input);
  const relationships = await planRelationshipState(deps, identity, plan);
  return queryResponse({
    data: {
      tool: "parley_get_plan_relationships",
      identity: summarizeIdentity(identity),
      plan: summarizePlan(plan),
      relationships
    }
  });
}

export async function readPlanProjection(request = {}, deps = {}) {
  const { caller, input } = normalizeServiceRequest(request);
  const identity = resolveServiceCallerIdentity(deps.pluginConfig, caller, input);
  const plan = await loadPlanForQuery(deps, identity, input);
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
