#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveParleyRuntimeConfig } from "../core/config.js";
import { startParleyHttpService } from "../service/http_app.js";

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
  return `Usage: parleyd [--config <file>] [--host <host>] [--port <port>] --mode service --db-path <path> [options]

Options:
  --config <file>              JSON config file shaped like Parley plugin config.
  --host <host>                Bind host. Defaults to PARLEY_HOST or 127.0.0.1.
  --port <port>                Bind port. Defaults to PARLEY_PORT or 7331. Use 0 for an ephemeral port.
  --mode service               Required service runtime mode.
  --db-path <path>             Required SQLite DB path outside repos/workspaces.
  --repo-root <path>           Optional repo root override.
  --agent <id>                 Optional service caller/default agent id.
  --default-board <board>      Optional default board for service callers.
  --auth-token-file <path>     Bearer token file for protected routes.
  --auth-token <token>         Bearer token value; prefer --auth-token-file in real deployments.
  --no-query-auth              Development/test only: do not require auth on query routes.
  --no-meta-auth               Development/test only: do not require auth on /v1/meta.

Environment aliases: PARLEY_CONFIG, PARLEY_HOST, PARLEY_PORT, PARLEY_MODE, PARLEY_DB_PATH,
PARLEY_REPO_ROOT, PARLEY_AGENT_ID, PARLEY_DEFAULT_BOARD, PARLEY_AUTH_TOKEN_FILE, PARLEY_AUTH_TOKEN.`;
}

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--no-query-auth") {
      options.requireQueryAuth = false;
      continue;
    }
    if (arg === "--no-meta-auth") {
      options.requireMetaAuth = false;
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

async function loadJsonConfig(configPath) {
  if (configPath == null) return {};
  const resolved = path.resolve(expandHome(configPath));
  const content = await fs.readFile(resolved, "utf8");
  const parsed = JSON.parse(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Parley daemon config JSON must be an object");
  }
  return parsed;
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

function parsePort(value) {
  const portText = nonEmptyString(value);
  if (portText == null) return 7331;
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("Parley daemon port must be an integer between 0 and 65535");
  }
  return port;
}

function cliOverrides(options) {
  return Object.fromEntries(Object.entries({
    parleyMode: nonEmptyString(options.mode),
    repoRoot: nonEmptyString(options["repo-root"]),
    parleyDbPath: nonEmptyString(options["db-path"]),
    parleyAgentId: nonEmptyString(options.agent),
    parleyDefaultBoard: nonEmptyString(options["default-board"]),
    parleyAuthTokenFile: nonEmptyString(options["auth-token-file"]),
    parleyAuthToken: nonEmptyString(options["auth-token"])
  }).filter(([, value]) => value != null));
}

function runtimeSummary(runtimeConfig) {
  return Object.fromEntries(Object.entries({
    mode: runtimeConfig.mode,
    modeSource: runtimeConfig.modeSource,
    surface: runtimeConfig.surface,
    storageMode: runtimeConfig.storageMode,
    repoRoot: runtimeConfig.repoRoot,
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
    code: error?.code ?? "PARLEY_DAEMON_ERROR",
    message: error?.message ?? "Parley daemon failed.",
    diagnostics: error?.details ?? error?.diagnostics
  };
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function waitForShutdown(server, io = {}) {
  const stderr = io.stderr ?? process.stderr;
  return await new Promise((resolve) => {
    let settling = false;
    async function shutdown(signal) {
      if (settling) return;
      settling = true;
      try {
        await closeServer(server);
        resolve(0);
      } catch (error) {
        stderr.write(`parleyd: failed to close cleanly after ${signal}: ${error?.message ?? error}\n`);
        resolve(1);
      }
    }
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.once(signal, () => void shutdown(signal));
    }
  });
}

export async function startParleyDaemon(argv = process.argv.slice(2), io = {}) {
  const env = io.env ?? process.env;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const options = parseArgs(argv);
  if (options.help) {
    stdout.write(`${usage()}\n`);
    return { exitCode: 0 };
  }

  if (options._.length > 0) {
    throw new Error(`Unexpected positional arguments: ${options._.join(" ")}`);
  }

  const configPath = nonEmptyString(options.config) ?? nonEmptyString(env.PARLEY_CONFIG);
  const fileConfig = await loadJsonConfig(configPath);
  const pluginConfig = { ...fileConfig, ...cliOverrides(options) };
  const host = nonEmptyString(options.host) ?? nonEmptyString(env.PARLEY_HOST) ?? "127.0.0.1";
  const port = parsePort(options.port ?? env.PARLEY_PORT);
  const runtimeConfig = resolveParleyRuntimeConfig({
    surface: "service",
    pluginConfig,
    env
  });

  if (runtimeConfig.warnings.length > 0) {
    for (const warning of runtimeConfig.warnings) stderr.write(`parleyd: ${warning}\n`);
  }

  const server = await startParleyHttpService({
    host,
    port,
    pluginConfig,
    runtimeConfig,
    env,
    authToken: pickConfigString(pluginConfig, env, ["parleyAuthToken", "authToken"], ["PARLEY_AUTH_TOKEN"]),
    authTokenFile: pickConfigString(pluginConfig, env, ["parleyAuthTokenFile", "authTokenFile"], ["PARLEY_AUTH_TOKEN_FILE"]),
    ...(options.requireQueryAuth === false ? { requireQueryAuth: false } : {}),
    ...(options.requireMetaAuth === false ? { requireMetaAuth: false } : {})
  });
  const address = server.address();
  const bind = typeof address === "object" && address != null
    ? { host: address.address, port: address.port }
    : { host, port };

  printJson({ ok: true, service: "parley", event: "ready", bind, runtime: runtimeSummary(runtimeConfig) }, stdout);

  if (io.wait === false) return { exitCode: 0, server, bind, runtimeConfig };
  const exitCode = await waitForShutdown(server, { stderr });
  return { exitCode };
}

const invokedPath = process.argv[1] == null ? null : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  startParleyDaemon().then(({ exitCode = 0 }) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    printJson({ ok: false, error: cliErrorResponse(error) }, process.stderr);
    process.exitCode = 1;
  });
}
