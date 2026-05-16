import { createClaimTurnTool } from "../../adapters/openclaw/tools/claim_turn.js";
import { createConcludeThreadTool } from "../../adapters/openclaw/tools/conclude_thread.js";
import { createDispatchTransportRequestTool } from "../../adapters/openclaw/tools/dispatch_transport_request.js";
import { createOpenThreadTool } from "../../adapters/openclaw/tools/open_thread.js";
import { createProbeThreadTool } from "../../adapters/openclaw/tools/probe.js";
import { createRecordHumanSummaryAnchorTool } from "../../adapters/openclaw/tools/record_human_summary_anchor.js";
import { createRecordTransportResultTool } from "../../adapters/openclaw/tools/record_transport_result.js";
import { createReplyThreadTool } from "../../adapters/openclaw/tools/reply.js";
import { createSettleTurnTool } from "../../adapters/openclaw/tools/settle_turn.js";
import { createValidationError } from "../../adapters/openclaw/tools/descriptors.js";
import { normalizeServiceRequest } from "../context.js";
import { serviceResponse } from "../responses.js";
import { withParleyServiceLedgerTransaction } from "../../core/storage/sqlite_ledger.js";

export const RUNTIME_ACTIONS = Object.freeze([
  "open_thread",
  "claim_turn",
  "reply_thread",
  "probe_thread",
  "settle_turn",
  "conclude_thread",
  "record_transport_result",
  "dispatch_transport_request",
  "record_human_summary_anchor"
]);

const RUNTIME_TOOL_FACTORIES = Object.freeze({
  open_thread: createOpenThreadTool,
  claim_turn: createClaimTurnTool,
  reply_thread: createReplyThreadTool,
  probe_thread: createProbeThreadTool,
  settle_turn: createSettleTurnTool,
  conclude_thread: createConcludeThreadTool,
  record_transport_result: createRecordTransportResultTool,
  dispatch_transport_request: createDispatchTransportRequestTool,
  record_human_summary_anchor: createRecordHumanSummaryAnchorTool
});

function value(input, snakeName, camelName = snakeName) {
  return input?.[snakeName] ?? input?.[camelName];
}

function normalizeInput(input) {
  if (input == null) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("input must be an object");
  return input;
}

function getFactory(action) {
  const factory = RUNTIME_TOOL_FACTORIES[action];
  if (factory == null) {
    throw createValidationError(`unsupported Parley runtime action: ${action}`, {
      code: "INVALID_PARLEY_RUNTIME_ACTION",
      validValues: RUNTIME_ACTIONS,
      describeTopic: "targets"
    });
  }
  return factory;
}

function assertDelegatedParams(tool, params) {
  if (tool.parameters?.additionalProperties !== false) return;
  const allowed = new Set(Object.keys(tool.parameters?.properties ?? {}));
  for (const key of Object.keys(params)) {
    if (!allowed.has(key)) throw new Error(`${tool.name} does not accept parameter: ${key}`);
  }
}

function bridgeApi(deps = {}) {
  return {
    pluginConfig: {
      ...(deps.pluginConfig ?? {}),
      __parleyServiceTransportMode: "caller_managed"
    },
    toolContext: null,
    callGateway: deps.callGateway
  };
}

export async function runtime(request = {}, deps = {}) {
  const { input } = normalizeServiceRequest(request);
  const action = value(input, "action");
  const factory = getFactory(action);
  const delegatedTool = factory(bridgeApi(deps));
  const delegatedParams = normalizeInput(value(input, "input"));
  assertDelegatedParams(delegatedTool, delegatedParams);
  const delegated = await withParleyServiceLedgerTransaction(deps.pluginConfig, () => delegatedTool.execute(null, delegatedParams));
  return serviceResponse({ data: delegated.details });
}
