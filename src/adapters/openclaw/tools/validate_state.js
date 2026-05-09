import { validateState } from "../../../service/index.js";
import { boardResult, callerRuntimeRefParameter } from "./v2_common.js";
import { serviceRequestFromTool } from "./service_request.js";

export function createValidateStateAction(api) {
  return {
    name: "parley_validate_state",
    label: "Parley Validate State",
    description: "Read-only validator for Parley board records, references, derived-state safety diagnostics, and extraction readiness checks.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Required board id for this board-scoped operation. Call parley_my_boards to discover accessible boards and default_board." }
      }
    },
    async execute(_toolCallId, params) {
      const response = await validateState(serviceRequestFromTool(api, params, params), { pluginConfig: api.pluginConfig });
      return boardResult({
        tool: "parley_validate_state",
        identity: response.data.identity,
        validation: response.data.validation
      });
    }
  };
}
