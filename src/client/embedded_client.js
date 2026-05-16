import {
  checkpointProjection,
  describe,
  getBoardProjection,
  getPlanSetupStatus,
  listBoardObligations,
  listRuntimeObligations,
  mutate,
  myBoards,
  runtime,
  searchReferences,
  validatePlan,
  validateState,
  whereAmI
} from "../service/index.js";
import { ParleyConfigError, resolveParleyRuntimeConfig } from "../core/config.js";

const QUERY_HANDLERS = Object.freeze({
  checkpointProjection,
  describe,
  getBoardProjection,
  getPlanSetupStatus,
  listBoardObligations,
  listRuntimeObligations,
  myBoards,
  searchReferences,
  validatePlan,
  validateState,
  whereAmI
});

const COMMAND_HANDLERS = Object.freeze({
  mutate,
  runtime
});

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeCaller(caller = {}, runtimeConfig = {}) {
  const actorId = nonEmptyString(caller.actor_id ?? caller.actorId)
    ?? nonEmptyString(runtimeConfig.agentId)
    ?? nonEmptyString(process.env.USER)
    ?? "parley-cli";
  return {
    actor_id: actorId,
    actor_type: nonEmptyString(caller.actor_type ?? caller.actorType) ?? "agent",
    runtime: nonEmptyString(caller.runtime) ?? "cli",
    runtime_ref: caller.runtime_ref ?? caller.runtimeRef ?? { scheme: "cli", type: "agent", id: actorId },
    runtime_aliases: caller.runtime_aliases ?? caller.runtimeAliases,
    board_id: nonEmptyString(caller.board_id ?? caller.boardId) ?? nonEmptyString(runtimeConfig.defaultBoard),
    request_id: nonEmptyString(caller.request_id ?? caller.requestId),
    capabilities: caller.capabilities
  };
}

function materializeStandalonePluginConfig(pluginConfig = {}, runtimeConfig = {}) {
  return {
    ...pluginConfig,
    parleyMode: runtimeConfig.mode,
    ...(runtimeConfig.stateRoot != null ? { parleyStateRoot: runtimeConfig.stateRoot } : {}),
    ...(runtimeConfig.testRoot != null ? { parleyTestRoot: runtimeConfig.testRoot } : {}),
    ...(runtimeConfig.runtimeRoot != null ? { parleyRuntimeRoot: runtimeConfig.runtimeRoot } : {})
  };
}

function assertEmbeddedMode(runtimeConfig) {
  if (!["standalone", "test"].includes(runtimeConfig.mode)) {
    throw new ParleyConfigError(
      `Embedded Parley client requires standalone or test mode; got ${runtimeConfig.mode}.`,
      "PARLEY_EMBEDDED_MODE_UNSUPPORTED",
      { mode: runtimeConfig.mode, surface: runtimeConfig.surface }
    );
  }
}

export function createParleyEmbeddedClient(options = {}) {
  const runtimeConfig = options.runtimeConfig ?? resolveParleyRuntimeConfig({
    surface: options.surface ?? "sdk",
    pluginConfig: options.pluginConfig ?? {},
    config: options.config,
    env: options.env
  });
  assertEmbeddedMode(runtimeConfig);

  const pluginConfig = materializeStandalonePluginConfig(options.pluginConfig ?? {}, runtimeConfig);
  const caller = normalizeCaller(options.caller, runtimeConfig);

  async function query(name, input = {}, queryOptions = {}) {
    const handler = QUERY_HANDLERS[name];
    if (handler == null) {
      throw new ParleyConfigError(`Unsupported embedded Parley query: ${name}`, "PARLEY_EMBEDDED_QUERY_UNSUPPORTED", { name });
    }
    const request = {
      caller: normalizeCaller(queryOptions.caller ?? caller, runtimeConfig),
      input: input && typeof input === "object" && !Array.isArray(input) ? input : {}
    };
    return handler(request, { pluginConfig });
  }

  async function command(name, input = {}, commandOptions = {}) {
    const handler = COMMAND_HANDLERS[name];
    if (handler == null) {
      throw new ParleyConfigError(`Unsupported embedded Parley command: ${name}`, "PARLEY_EMBEDDED_COMMAND_UNSUPPORTED", { name });
    }
    const request = {
      caller: normalizeCaller(commandOptions.caller ?? caller, runtimeConfig),
      input: input && typeof input === "object" && !Array.isArray(input) ? input : {}
    };
    return handler(request, { pluginConfig });
  }

  return {
    mode: runtimeConfig.mode,
    runtimeConfig,
    pluginConfig,
    caller,
    query,
    command,
    health: async () => ({ status: "ok", data: { mode: runtimeConfig.mode, storageMode: runtimeConfig.storageMode } }),
    describe: (input = {}, options = {}) => query("describe", input, options),
    myBoards: (input = {}, options = {}) => query("myBoards", input, options),
    whereAmI: (input = {}, options = {}) => query("whereAmI", input, options),
    mutate: (input = {}, options = {}) => command("mutate", input, options),
    runtime: (input = {}, options = {}) => command("runtime", input, options)
  };
}
