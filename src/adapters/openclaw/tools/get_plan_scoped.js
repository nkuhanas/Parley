import {
  getPlanOverview,
  getPlanPhases,
  getPlanRelationships,
  getPlanReviewStatus
} from "../../../service/index.js";
import { boardResult, callerRuntimeRefParameter } from "./v2_common.js";
import { serviceRequestFromTool } from "./service_request.js";

function planReadParameters(description) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["boardId", "planId"],
    properties: {
      callerRuntimeRef: callerRuntimeRefParameter(),
      boardId: { type: "string", description: "Board id for the plan." },
      planId: { type: "string", description }
    }
  };
}

function createScopedPlanReadAction({ name, label, description, query }) {
  return function createAction(api) {
    return {
      name,
      label,
      description,
      parameters: planReadParameters("Tracked plan id to inspect."),
      async execute(_toolCallId, params) {
        const response = await query(serviceRequestFromTool(api, params, params), { pluginConfig: api.pluginConfig });
        return boardResult(response.data);
      }
    };
  };
}

export const createGetPlanOverviewAction = createScopedPlanReadAction({
  name: "parley_get_plan_overview",
  label: "Parley Get Plan Overview",
  description: "Read only the overview band and compact metadata for a tracked Parley plan.",
  query: getPlanOverview
});

export const createGetPlanPhasesAction = createScopedPlanReadAction({
  name: "parley_get_plan_phases",
  label: "Parley Get Plan Phases",
  description: "Read full phase definitions and phase counts for a tracked Parley plan without fetching the whole board projection.",
  query: getPlanPhases
});

export const createGetPlanReviewStatusAction = createScopedPlanReadAction({
  name: "parley_get_plan_review_status",
  label: "Parley Get Plan Review Status",
  description: "Read review routing, approvals, pending reviewers, invalid reviewers, and lifecycle review obligations for a tracked Parley plan.",
  query: getPlanReviewStatus
});

export const createGetPlanRelationshipsAction = createScopedPlanReadAction({
  name: "parley_get_plan_relationships",
  label: "Parley Get Plan Relationships",
  description: "Read declared and board-recorded relationships touching a tracked Parley plan.",
  query: getPlanRelationships
});
