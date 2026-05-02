import { validateParleyBoardState } from "../state_validator.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

export function createValidateStateAction(api) {
  return {
    name: "parley_validate_state",
    label: "Parley Validate State",
    description: "Read-only validator for Parley board records, references, derived-state safety diagnostics, and extraction readiness checks.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Optional board override. Normal MVP use derives the board from callerRuntimeRef." }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const validation = await validateParleyBoardState(api.pluginConfig, identity.board, {});
      return boardResult({
        tool: "parley_validate_state",
        identity,
        validation
      });
    }
  };
}
