import { validatePlan } from "../../../service/index.js";
import { boardResult, callerRuntimeRefParameter } from "./v2_common.js";
import { serviceRequestFromTool } from "./service_request.js";

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
      const response = await validatePlan(serviceRequestFromTool(api, params, params), { pluginConfig: api.pluginConfig });
      return boardResult({
        tool: "parley_validate_plan",
        identity: response.data.identity,
        validation: response.data.validation,
        setupState: response.data.setupState,
        resolved_path: response.data.resolved_path
      });
    }
  };
}
