import { callerRuntimeAliasesFromToolContext, callerRuntimeRefFromToolContext } from "./v2_common.js";

export function serviceCallerFromTool(api, params = {}) {
  const runtimeRef = params?.callerRuntimeRef ?? callerRuntimeRefFromToolContext(api.toolContext);
  return {
    actor_id: runtimeRef?.id ?? api.pluginConfig?.agentId ?? "unknown",
    actor_type: runtimeRef?.type === "service" ? "service" : "agent",
    runtime: runtimeRef?.scheme ?? "openclaw",
    runtime_ref: runtimeRef,
    runtime_aliases: callerRuntimeAliasesFromToolContext(api.toolContext)
  };
}

export function serviceRequestFromTool(api, params = {}, input = params) {
  return {
    caller: serviceCallerFromTool(api, params),
    input
  };
}
