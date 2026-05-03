import { createTriggerRecord, saveTriggerRecord } from "../../../core/storage/board_store.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

export function createCreateTriggerTool(api) {
  return {
    name: "parley_create_trigger",
    label: "Parley Create Trigger",
    description: "Create a board-scoped trigger record. MVP evaluation is obligation-bound: resolved obligations evaluate only their explicit onResolveTriggerIds.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId", "title", "source", "action"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Required board id for this board-scoped operation." },
        triggerId: { type: "string", description: "Optional stable trigger id. Defaults to trigger_<uuid>." },
        title: { type: "string" },
        status: { type: "string", description: "active, disabled, or retired. Defaults to active." },
        source: { type: "object", additionalProperties: true, description: "Source event selector. MVP supports event_type/eventType=obligation.resolved plus optional obligation/template/subject filters." },
        condition: { type: "object", additionalProperties: true, description: "Optional guard, e.g. obligationResolutionIn and subjectStatusIn." },
        action: { type: "object", additionalProperties: true, description: "Narrow side effect. MVP supports create_obligation and record_effect." },
        firePolicy: { type: "string", description: "once, once_per_source_obligation, or many. Defaults to once." }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const trigger = createTriggerRecord({
        board_id: identity.board_id,
        trigger_id: params?.triggerId,
        title: params?.title,
        status: params?.status,
        source: params?.source,
        condition: params?.condition,
        action: params?.action,
        fire_policy: params?.firePolicy
      });
      const saved = await saveTriggerRecord(api.pluginConfig, identity.board, trigger);
      return boardResult({
        tool: "parley_create_trigger",
        identity,
        trigger: saved,
        mvp_evaluation: "obligation_bound",
        guidance: "Bind this trigger to an obligation with onResolveTriggerIds; broad registry scanning is intentionally not enabled in the MVP."
      });
    }
  };
}
