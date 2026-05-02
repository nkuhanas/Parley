import { validateParleyBoardState } from "../../../core/board/state_validator.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

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
