import fs from "node:fs/promises";

import { assertPathUnderArtifactNamespaces } from "../../core/board/board.js";
import { validateParleyBoardState } from "../../core/board/state_validator.js";
import { derivePlanSetupState } from "../../core/plan/plan_state.js";
import { validateParleyPlanV1Document } from "../../core/schema/index.js";
import { loadPlanSetupRecord } from "../../core/storage/board_store.js";
import { normalizeServiceRequest } from "../context.js";
import { SERVICE_ERROR_CODES, serviceError } from "../errors.js";
import { resolveServiceCallerIdentity } from "../identity.js";
import { queryResponse } from "../responses.js";

function value(input, snakeName, camelName = snakeName) {
  return input?.[snakeName] ?? input?.[camelName];
}

function summarizeIdentity(identity) {
  return {
    board_id: identity.board_id,
    global_agent_id: identity.global_agent_id,
    board_agent_id: identity.board_agent_id
  };
}

export async function validatePlan(request = {}, deps = {}) {
  const { caller, input } = normalizeServiceRequest(request);
  const identity = resolveServiceCallerIdentity(deps.pluginConfig, caller, input);
  let markdown = typeof value(input, "markdown") === "string" ? value(input, "markdown") : null;
  let resolvedPath = null;
  let setupState = null;

  const planId = value(input, "plan_id", "planId");
  if (planId != null) {
    const plan = await loadPlanSetupRecord(deps.pluginConfig, identity.board, planId);
    if (plan == null) {
      throw serviceError(SERVICE_ERROR_CODES.PLAN_NOT_FOUND, `Parley plan not found: ${planId}`);
    }
    setupState = derivePlanSetupState(plan, identity.board);
    markdown ??= await fs.readFile(plan.landing.resolved_path, "utf8");
    resolvedPath = plan.landing.resolved_path;
  }

  if (markdown == null) {
    const requestedPath = value(input, "resolved_path", "resolvedPath");
    if (typeof requestedPath !== "string" || !requestedPath.trim()) {
      throw serviceError(SERVICE_ERROR_CODES.VALIDATION_FAILED, "markdown or resolvedPath required");
    }
    resolvedPath = assertPathUnderArtifactNamespaces(identity.board, requestedPath, "reference", "resolvedPath");
    markdown = await fs.readFile(resolvedPath, "utf8");
  }

  const validation = validateParleyPlanV1Document(markdown);
  return queryResponse({
    data: {
      identity: summarizeIdentity(identity),
      validation: {
        ...validation,
        shell_valid: validation.ok,
        setup_complete: setupState?.setupComplete ?? null,
        missingRequired: setupState?.missingRequired ?? []
      },
      setupState,
      resolved_path: resolvedPath
    }
  });
}

export async function validateState(request = {}, deps = {}) {
  const { caller, input } = normalizeServiceRequest(request);
  const identity = resolveServiceCallerIdentity(deps.pluginConfig, caller, input);
  const validation = await validateParleyBoardState(deps.pluginConfig, identity.board, {});
  return queryResponse({
    data: {
      identity: summarizeIdentity(identity),
      validation
    }
  });
}
