#!/usr/bin/env node
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ACTOR_ID = "codex-agent";
const DEFAULT_RUNTIME = "codex";
const DEFAULT_SURFACE = "codex-cli";
const DEFAULT_COMMAND = "codex";

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sanitizeIdPart(value) {
  return String(value ?? "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function timestampForId(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function usage() {
  return `Usage: parley-codex [options] [--] [codex-args...]

Launch codex with Parley client-mode identity environment.

Options:
  --actor <id>             Durable Parley actor id. Default: codex-agent.
  --api-url <url>          Parley service URL. Defaults to PARLEY_API_URL.
  --auth-token-file <path> Parley bearer token file. Defaults to PARLEY_AUTH_TOKEN_FILE.
  --auth-token <token>     Parley bearer token. Defaults to PARLEY_AUTH_TOKEN.
  --default-board <board>  Default board. Defaults to PARLEY_DEFAULT_BOARD.
  --runtime <name>         Caller runtime scheme. Default: codex.
  --surface <name>         Worker surface metadata. Default: codex-cli.
  --session-id <id>        Ephemeral worker/session id. Default: generated.
  --host-id <id>           Host id for generated session metadata. Default: hostname.
  --workspace <path>       Workspace provenance. Defaults to current directory.
  --command <cmd>          Command to exec. Default: codex.
  --print-env              Print sanitized environment/config and exit.
  --dry-run                Print sanitized command/environment and exit.
  -h, --help               Show this help.

Required for execution: PARLEY_API_URL/--api-url and either PARLEY_AUTH_TOKEN_FILE/--auth-token-file or PARLEY_AUTH_TOKEN/--auth-token.
`;
}

export function parseParleyCodexArgs(argv = []) {
  const options = { commandArgs: [] };
  let afterTerminator = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (afterTerminator) {
      options.commandArgs.push(arg);
      continue;
    }
    if (arg === "--") {
      afterTerminator = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--print-env") {
      options.printEnv = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      options.commandArgs.push(arg);
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

export function buildParleyCodexLaunch(options = {}, baseEnv = process.env, now = new Date()) {
  const actorId = nonEmptyString(options.actor) ?? nonEmptyString(baseEnv.PARLEY_AGENT_ID) ?? DEFAULT_ACTOR_ID;
  const apiUrl = nonEmptyString(options["api-url"]) ?? nonEmptyString(baseEnv.PARLEY_API_URL);
  const authTokenFile = nonEmptyString(options["auth-token-file"]) ?? nonEmptyString(baseEnv.PARLEY_AUTH_TOKEN_FILE);
  const authToken = nonEmptyString(options["auth-token"]) ?? nonEmptyString(baseEnv.PARLEY_AUTH_TOKEN);
  const defaultBoard = nonEmptyString(options["default-board"]) ?? nonEmptyString(baseEnv.PARLEY_DEFAULT_BOARD);
  const runtime = nonEmptyString(options.runtime) ?? nonEmptyString(baseEnv.PARLEY_CALLER_RUNTIME) ?? DEFAULT_RUNTIME;
  const surface = nonEmptyString(options.surface) ?? nonEmptyString(baseEnv.PARLEY_WORKER_SURFACE) ?? DEFAULT_SURFACE;
  const hostId = nonEmptyString(options["host-id"]) ?? nonEmptyString(baseEnv.PARLEY_HOST_ID) ?? os.hostname();
  const workspace = nonEmptyString(options.workspace) ?? nonEmptyString(baseEnv.PARLEY_WORKSPACE) ?? process.cwd();
  const sessionId = nonEmptyString(options["session-id"])
    ?? nonEmptyString(baseEnv.PARLEY_SESSION_ID)
    ?? `${sanitizeIdPart(runtime)}-${sanitizeIdPart(hostId)}-${timestampForId(now)}-${process.pid}`;
  const command = nonEmptyString(options.command) ?? DEFAULT_COMMAND;
  const commandArgs = Array.isArray(options.commandArgs) && options.commandArgs.length > 0 ? options.commandArgs : [];

  if (!apiUrl) {
    throw new Error("PARLEY_API_URL or --api-url is required");
  }
  if (!authTokenFile && !authToken) {
    throw new Error("PARLEY_AUTH_TOKEN_FILE/--auth-token-file or PARLEY_AUTH_TOKEN/--auth-token is required");
  }

  const env = {
    ...baseEnv,
    PARLEY_MODE: "client",
    PARLEY_API_URL: apiUrl,
    PARLEY_AGENT_ID: actorId,
    PARLEY_CALLER_RUNTIME: runtime,
    PARLEY_CALLER_RUNTIME_REF: `${runtime}:agent:${actorId}`,
    PARLEY_CALLER_RUNTIME_ALIASES: `${runtime}:session:${sessionId}`,
    PARLEY_SESSION_ID: sessionId,
    PARLEY_WORKER_SURFACE: surface,
    PARLEY_HOST_ID: hostId,
    PARLEY_WORKSPACE: workspace
  };
  if (authTokenFile) env.PARLEY_AUTH_TOKEN_FILE = authTokenFile;
  if (authToken) env.PARLEY_AUTH_TOKEN = authToken;
  if (defaultBoard) env.PARLEY_DEFAULT_BOARD = defaultBoard;

  return {
    command,
    args: commandArgs,
    env,
    metadata: {
      actorId,
      runtime,
      runtimeRef: env.PARLEY_CALLER_RUNTIME_REF,
      runtimeAliases: env.PARLEY_CALLER_RUNTIME_ALIASES,
      sessionId,
      surface,
      hostId,
      workspace,
      apiUrl,
      authTokenFile: authTokenFile ?? null,
      hasAuthToken: Boolean(authToken),
      defaultBoard: defaultBoard ?? null
    }
  };
}

function sanitizedLaunch(launch) {
  const interestingEnvKeys = [
    "PARLEY_MODE",
    "PARLEY_API_URL",
    "PARLEY_AGENT_ID",
    "PARLEY_AUTH_TOKEN_FILE",
    "PARLEY_AUTH_TOKEN",
    "PARLEY_DEFAULT_BOARD",
    "PARLEY_CALLER_RUNTIME",
    "PARLEY_CALLER_RUNTIME_REF",
    "PARLEY_CALLER_RUNTIME_ALIASES",
    "PARLEY_SESSION_ID",
    "PARLEY_WORKER_SURFACE",
    "PARLEY_HOST_ID",
    "PARLEY_WORKSPACE"
  ];
  const env = {};
  for (const key of interestingEnvKeys) {
    if (launch.env[key] == null) continue;
    env[key] = key === "PARLEY_AUTH_TOKEN" ? "__REDACTED__" : launch.env[key];
  }
  return {
    command: launch.command,
    args: launch.args,
    metadata: {
      ...launch.metadata,
      hasAuthToken: launch.metadata.hasAuthToken,
      authTokenFile: launch.metadata.authTokenFile
    },
    env
  };
}

export async function runParleyCodex(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const env = io.env ?? process.env;
  const options = parseParleyCodexArgs(argv);
  if (options.help) {
    stdout.write(usage());
    return 0;
  }
  const launch = buildParleyCodexLaunch(options, env, io.now ?? new Date());
  if (options.printEnv || options.dryRun) {
    stdout.write(`${JSON.stringify({ ok: true, dryRun: Boolean(options.dryRun), launch: sanitizedLaunch(launch) }, null, 2)}\n`);
    return 0;
  }
  const child = spawn(launch.command, launch.args, {
    env: launch.env,
    cwd: launch.metadata.workspace,
    stdio: "inherit"
  });
  return await new Promise((resolve) => {
    child.on("error", (error) => {
      stderr.write(`parley-codex: failed to launch ${launch.command}: ${error.message}\n`);
      resolve(127);
    });
    child.on("exit", (code, signal) => {
      if (signal) {
        stderr.write(`parley-codex: ${launch.command} exited from signal ${signal}\n`);
        resolve(1);
      } else {
        resolve(code ?? 0);
      }
    });
  });
}

const invokedPath = process.argv[1] == null ? null : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  runParleyCodex().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: { message: error.message, code: error.code ?? "PARLEY_CODEX_ERROR" } }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
