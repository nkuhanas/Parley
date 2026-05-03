import fs from "node:fs/promises";

import { assertPathUnderArtifactNamespaces } from "../../../core/board/board.js";
import { validateParleyPlanV1Document } from "../../../core/schema/index.js";
import { derivePlanSetupState } from "../../../core/plan/plan_state.js";
import { loadPlanSetupRecord } from "../../../core/storage/board_store.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

export function createValidatePlanAction(api) {
  return {
    name: "parley_validate_plan",
    label: "Parley Validate Plan",
    description: "Validate a Markdown plan document against the Parley-owned parley.plan.v1 schema without executing it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Required board id for this board-scoped operation. Call parley_my_boards to discover accessible boards and default_board." },
        markdown: { type: "string", description: "Plan Markdown content to validate." },
        resolvedPath: { type: "string", description: "Optional path to a plan document under an allowed reference namespace." },
        planId: { type: "string", description: "Optional tracked plan id. When provided, returns shell/setup completeness from canonical plan setup state." }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      let markdown = typeof params?.markdown === "string" ? params.markdown : null;
      let resolvedPath = null;
      let setupState = null;
      if (params?.planId != null || params?.plan_id != null) {
        const planId = params.planId ?? params.plan_id;
        const plan = await loadPlanSetupRecord(api.pluginConfig, identity.board, planId);
        if (plan == null) throw new Error(`plan not found: ${planId}`);
        setupState = derivePlanSetupState(plan, identity.board);
        markdown ??= await fs.readFile(plan.landing.resolved_path, "utf8");
        resolvedPath = plan.landing.resolved_path;
      }
      if (markdown == null) {
        if (typeof params?.resolvedPath !== "string" || !params.resolvedPath.trim()) {
          throw new Error("markdown or resolvedPath required");
        }
        resolvedPath = assertPathUnderArtifactNamespaces(identity.board, params.resolvedPath, "reference", "resolvedPath");
        markdown = await fs.readFile(resolvedPath, "utf8");
      }

      const validation = validateParleyPlanV1Document(markdown);
      return boardResult({
        tool: "parley_validate_plan",
        identity,
        validation: {
          ...validation,
          shell_valid: validation.ok,
          setup_complete: setupState?.setupComplete ?? null,
          missingRequired: setupState?.missingRequired ?? []
        },
        setupState,
        resolved_path: resolvedPath
      });
    }
  };
}
