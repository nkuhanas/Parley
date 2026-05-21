#!/usr/bin/env node
import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveParleyRuntimeConfig } from "../core/config.js";
import { doctorParleyBoardConfig } from "../core/config_doctor.js";
import {
  PARLEY_CREDENTIAL_ENV_KEYS,
  PARLEY_CREDENTIAL_FILE_ENV_KEYS,
  REMOTE_CREDENTIAL_FILE_KEYS,
  REMOTE_CREDENTIAL_FILE_OPTION,
  REMOTE_CREDENTIAL_KEYS,
  REMOTE_CREDENTIAL_OPTION
} from "../core/sensitive_names.js";
import { migrateParleySqliteLedger } from "../core/storage/sqlite_ledger.js";
import { createParleyEmbeddedClient, createParleyRemoteClient } from "../client/index.js";

const COMMANDS = new Set(["mode", "migrate", "doctor", "health", "describe", "my-boards", "where-am-i"]);

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function usage() {
  return `Usage: parley [--config <file>] [--mode <mode>] [--agent <id>] [--default-board <board>] [--caller-runtime <scheme>] <command> [options]

Commands:
  mode                         Show resolved runtime mode/config summary.
  migrate                      Run idempotent service-mode SQLite ledger migrations.
  doctor [--board <board>] [--repair]
                               Inspect protected board defaults; --repair writes missing/invalid human member entries to --config.
  health                       Check remote service or embedded client health.
  describe [--topic <topic>] [--board <board>]
  my-boards                    List boards visible to the caller.
  where-am-i [--board <board>] [--verbosity compact|full] [--include-terminal]

Standalone mode calls the embedded Parley service boundary with local file-backed state.
Client mode requires PARLEY_API_URL/parleyApiUrl and uses the remote client surface.
Use --caller-runtime openclaw or parleyCallerRuntime to make CLI calls impersonate the canonical OpenClaw runtime identity when the service registry does not bind cli:* refs.`;
}

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--include-terminal") {
      options.includeTerminal = true;
      continue;
    }
    if (arg === "--repair") {
      options.repair = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }
    const eqIndex = arg.indexOf("=");
    const key = arg.slice(2, eqIndex === -1 ? undefined : eqIndex);
    const value = eqIndex === -1 ? argv[++index] : arg.slice(eqIndex + 1);
    if (value == null || value.startsWith("--")) {
      throw new Error(`--${key} requires a value`);
    }
    options[key] = value;
  }
  return options;
}

function resolveConfigPath(configPath) {
  return configPath == null ? null : path.resolve(expandHome(configPath));
}

async function loadJsonConfig(configPath) {
  const resolved = resolveConfigPath(configPath);
  if (resolved == null) return {};
  const content = await fs.readFile(resolved, "utf8");
  const parsed = JSON.parse(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Parley config JSON must be an object");
  }
  return parsed;
}

function cliOverrides(options) {
  return Object.fromEntries(Object.entries({
    parleyMode: nonEmptyString(options.mode),
    parleyStateRoot: nonEmptyString(options["state-root"]),
    parleyRuntimeRoot: nonEmptyString(options["runtime-root"]),
    parleyDbPath: nonEmptyString(options["db-path"]),
    parleyApiUrl: nonEmptyString(options["api-url"]),
    parleyAuthToken: nonEmptyString(options["auth-token"]),
    parleyAuthTokenFile: nonEmptyString(options["auth-token-file"]),
    parleyAgentId: nonEmptyString(options.agent),
    parleyDefaultBoard: nonEmptyString(options["default-board"]),
    parleyCallerRuntime: nonEmptyString(options["caller-runtime"]),
    parleyCallerRuntimeRef: nonEmptyString(options["caller-runtime-ref"]),
    parleyCallerRuntimeAliases: nonEmptyString(options["caller-runtime-aliases"])
  }).filter(([, value]) => value != null));
}

function runtimeSummary(runtimeConfig) {
  return Object.fromEntries(Object.entries({
    mode: runtimeConfig.mode,
    modeSource: runtimeConfig.modeSource,
    surface: runtimeConfig.surface,
    storageMode: runtimeConfig.storageMode,
    stateRoot: runtimeConfig.stateRoot,
    runtimeRoot: runtimeConfig.runtimeRoot,
    testRoot: runtimeConfig.testRoot,
    apiUrl: runtimeConfig.apiUrl,
    dbPath: runtimeConfig.dbPath,
    defaultBoard: runtimeConfig.defaultBoard,
    agentId: runtimeConfig.agentId,
    warnings: runtimeConfig.warnings
  }).filter(([, value]) => value != null && (!Array.isArray(value) || value.length > 0)));
}

function printJson(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function cliErrorResponse(error) {
  return {
    status: "error",
    code: error?.code ?? "PARLEY_CLI_ERROR",
    message: error?.message ?? "Parley CLI command failed.",
    diagnostics: error?.details ?? error?.diagnostics
  };
}

function commandInput(command, options) {
  if (command === "describe") {
    return Object.fromEntries(Object.entries({
      topic: nonEmptyString(options.topic),
      boardId: nonEmptyString(options.board)
    }).filter(([, value]) => value != null));
  }
  if (command === "where-am-i") {
    return Object.fromEntries(Object.entries({
      boardId: nonEmptyString(options.board),
      verbosity: nonEmptyString(options.verbosity),
      includeTerminal: options.includeTerminal === true ? true : undefined
    }).filter(([, value]) => value != null));
  }
  return {};
}

function parseRuntimeRef(value) {
  if (value == null) return undefined;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  const normalized = nonEmptyString(value);
  if (normalized == null) return undefined;
  if (normalized.startsWith("{")) return JSON.parse(normalized);
  const parts = normalized.split(":");
  if (parts.length < 3) throw new Error("runtime ref must use scheme:type:id");
  const [scheme, type, ...idParts] = parts;
  const id = idParts.join(":");
  if (!scheme || !type || !id) throw new Error("runtime ref must use scheme:type:id");
  return { scheme, type, id };
}

function parseRuntimeAliases(value) {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (entry?.runtime_ref != null || entry?.runtimeRef != null) return entry;
      return { runtime_ref: parseRuntimeRef(entry), source: "cli_config" };
    });
  }
  const normalized = nonEmptyString(value);
  if (normalized == null) return undefined;
  if (normalized.startsWith("[")) return parseRuntimeAliases(JSON.parse(normalized));
  return normalized.split(",").map((entry) => ({ runtime_ref: parseRuntimeRef(entry), source: "cli_config" }));
}

function pickConfigString(pluginConfig, env, keys, envKeys = []) {
  for (const key of keys) {
    const value = nonEmptyString(pluginConfig[key]);
    if (value != null) return value;
  }
  for (const key of envKeys) {
    const value = nonEmptyString(env[key]);
    if (value != null) return value;
  }
  return undefined;
}

function callerOptions(runtimeConfig, pluginConfig, env = {}) {
  return {
    actor_id: runtimeConfig.agentId,
    agentId: runtimeConfig.agentId,
    board_id: runtimeConfig.defaultBoard,
    defaultBoard: runtimeConfig.defaultBoard,
    runtime: pickConfigString(pluginConfig, env, ["parleyCallerRuntime", "callerRuntime"], ["PARLEY_CALLER_RUNTIME"]) ?? "cli",
    runtime_ref: parseRuntimeRef(pluginConfig.parleyCallerRuntimeRef ?? pluginConfig.callerRuntimeRef ?? env.PARLEY_CALLER_RUNTIME_REF),
    runtime_aliases: parseRuntimeAliases(pluginConfig.parleyCallerRuntimeAliases ?? pluginConfig.callerRuntimeAliases ?? env.PARLEY_CALLER_RUNTIME_ALIASES)
  };
}

function createClientForRuntime(runtimeConfig, pluginConfig, options = {}) {
  const caller = callerOptions(runtimeConfig, pluginConfig, options.env);
  if (runtimeConfig.mode === "client") {
    return createParleyRemoteClient({
      apiUrl: runtimeConfig.apiUrl,
      [REMOTE_CREDENTIAL_OPTION]: pickConfigString(pluginConfig, options.env, REMOTE_CREDENTIAL_KEYS, PARLEY_CREDENTIAL_ENV_KEYS),
      [REMOTE_CREDENTIAL_FILE_OPTION]: pickConfigString(pluginConfig, options.env, REMOTE_CREDENTIAL_FILE_KEYS, PARLEY_CREDENTIAL_FILE_ENV_KEYS),
      ...caller,
      fetchImpl: options.fetchImpl
    });
  }
  return createParleyEmbeddedClient({
    surface: "cli",
    pluginConfig,
    runtimeConfig,
    caller
  });
}

function methodName(command) {
  if (command === "my-boards") return "myBoards";
  if (command === "where-am-i") return "whereAmI";
  return command;
}

export async function runParleyCli(argv = process.argv.slice(2), io = {}) {
  const env = io.env ?? process.env;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const options = parseArgs(argv);
  const command = options._[0];
  if (options.help || command == null) {
    stdout.write(`${usage()}\n`);
    return 0;
  }
  if (!COMMANDS.has(command)) {
    throw new Error(`Unknown Parley command: ${command}`);
  }

  const configPath = nonEmptyString(options.config) ?? nonEmptyString(env.PARLEY_CONFIG);
  const fileConfig = await loadJsonConfig(configPath);
  const pluginConfig = { ...fileConfig, ...cliOverrides(options) };
  const runtimeConfig = resolveParleyRuntimeConfig({
    surface: "cli",
    pluginConfig,
    env
  });

  if (runtimeConfig.warnings.length > 0) {
    for (const warning of runtimeConfig.warnings) stderr.write(`parley: ${warning}\n`);
  }

  if (command === "mode") {
    printJson({ ok: true, command, runtime: runtimeSummary(runtimeConfig) }, stdout);
    return 0;
  }

  if (command === "migrate") {
    const migration = await migrateParleySqliteLedger(pluginConfig, { surface: "cli", env });
    printJson({ ok: true, command, runtime: runtimeSummary(runtimeConfig), migration }, stdout);
    return 0;
  }

  if (command === "doctor") {
    const repair = options.repair === true;
    const resolvedConfigPath = resolveConfigPath(configPath);
    if (repair && resolvedConfigPath == null) {
      throw new Error("doctor --repair requires --config or PARLEY_CONFIG so Parley knows which config file to update");
    }
    const doctor = doctorParleyBoardConfig(resolvedConfigPath == null ? pluginConfig : fileConfig, {
      boardId: nonEmptyString(options.board),
      repair
    });
    if (repair && doctor.repaired) {
      await fs.writeFile(resolvedConfigPath, `${JSON.stringify(fileConfig, null, 2)}\n`, "utf8");
    }
    printJson({
      ok: doctor.ok,
      command,
      runtime: runtimeSummary(runtimeConfig),
      configPath: resolvedConfigPath,
      doctor
    }, stdout);
    return doctor.ok ? 0 : 1;
  }

  const client = createClientForRuntime(runtimeConfig, pluginConfig, { env, fetchImpl: io.fetchImpl });
  const method = methodName(command);
  const response = await client[method](commandInput(command, options));
  printJson({
    ok: true,
    command,
    runtime: runtimeSummary(runtimeConfig),
    response
  }, stdout);
  return 0;
}

function isCliEntrypoint(invokedArg) {
  if (invokedArg == null) return false;
  const modulePath = fileURLToPath(import.meta.url);
  const invokedPath = path.resolve(invokedArg);
  if (invokedPath === modulePath) return true;
  try {
    return realpathSync(invokedPath) === realpathSync(modulePath);
  } catch (_error) {
    return false;
  }
}

if (isCliEntrypoint(process.argv[1])) {
  runParleyCli().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    printJson({ ok: false, error: cliErrorResponse(error) }, process.stderr);
    process.exitCode = 1;
  });
}
