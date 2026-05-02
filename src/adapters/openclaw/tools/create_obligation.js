import { createObligationRecord, saveObligationRecord } from "../../../core/storage/board_store.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller, assertBoardAgentForTool } from "./v2_common.js";

export function createCreateObligationTool(api) {
  return {
    name: "parley_create_obligation",
    label: "Parley Create Obligation",
    description: "Create a board-scoped Parley obligation assigned to a board-local agent.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["agent", "type", "target"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Optional board override. Normal MVP use derives the board from callerRuntimeRef." },
        obligationId: { type: "string", description: "Optional obligation id. Defaults to obligation_<uuid>." },
        agent: { type: "string", description: "Board-local agent id assigned the obligation." },
        type: { type: "string", description: "Obligation type, e.g. review or approve_or_object." },
        status: { type: "string", description: "Obligation status. Defaults to active." },
        target: { type: "object", additionalProperties: true, description: "Obligation target payload." },
        scope: { type: "string", description: "Optional authority/review scope." },
        reason: { type: "string", description: "Optional reason for the obligation." },
        sourceEffectId: { type: "string", description: "Optional source effect id." }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const agent = assertBoardAgentForTool(identity.board, params?.agent);
      const obligation = createObligationRecord({
        board_id: identity.board_id,
        obligation_id: params?.obligationId,
        agent,
        type: params?.type,
        status: params?.status,
        target: params?.target,
        scope: params?.scope,
        reason: params?.reason,
        source_effect_id: params?.sourceEffectId
      });
      const saved = await saveObligationRecord(api.pluginConfig, identity.board, obligation);
      return boardResult({ tool: "parley_create_obligation", identity, obligation: saved });
    }
  };
}
