#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PARLEY_CREDENTIAL_ENV, PARLEY_CREDENTIAL_FILE_ENV } from "../core/sensitive_names.js";

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

function hasPathSeparator(command) {
  return command.includes("/") || (path.sep === "\\" && command.includes("\\"));
}

function executableNames(command, env = process.env) {
  if (process.platform !== "win32" || path.extname(command)) return [command];
  const pathExt = (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .filter(Boolean);
  return [command, ...pathExt.map((ext) => `${command}${ext}`)];
}

export function resolveExecutable(command, env = process.env, cwd = process.cwd()) {
  const names = executableNames(command, env);
  if (hasPathSeparator(command)) {
    for (const name of names) {
      const candidate = path.isAbsolute(name) ? name : path.resolve(cwd, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Try the next platform-specific extension.
      }
    }
    throw new Error(`Executable not found or not runnable: ${command}`);
  }

  for (const dir of String(env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Keep scanning PATH.
      }
    }
  }
  throw new Error(`Executable not found on PATH: ${command}`);
}

function usage() {
  return `Usage: parley-codex [options] [--] [codex-args...]

Launch codex with Parley client-mode identity environment.

Options:
  --actor <id>             Durable Parley actor id. Default: codex-agent.
  --api-url <url>          Parley service URL. Defaults to PARLEY_API_URL.
  --auth-token-file <path> Parley bearer credential file. Defaults to ${PARLEY_CREDENTIAL_FILE_ENV}.
  --auth-token <token>     Parley bearer credential. Defaults to ${PARLEY_CREDENTIAL_ENV}.
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

Required for execution: PARLEY_API_URL/--api-url and either ${PARLEY_CREDENTIAL_FILE_ENV}/--auth-token-file or ${PARLEY_CREDENTIAL_ENV}/--auth-token.
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
  const credentialFile = nonEmptyString(options["auth-token-file"]) ?? nonEmptyString(baseEnv[PARLEY_CREDENTIAL_FILE_ENV]);
  const credential = nonEmptyString(options["auth-token"]) ?? nonEmptyString(baseEnv[PARLEY_CREDENTIAL_ENV]);
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
  if (!credentialFile && !credential) {
    throw new Error(`${PARLEY_CREDENTIAL_FILE_ENV}/--auth-token-file or ${PARLEY_CREDENTIAL_ENV}/--auth-token is required`);
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
  if (credentialFile) env[PARLEY_CREDENTIAL_FILE_ENV] = credentialFile;
  if (credential) env[PARLEY_CREDENTIAL_ENV] = credential;
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
      credentialFile: credentialFile ?? null,
      hasCredential: Boolean(credential),
      defaultBoard: defaultBoard ?? null
    }
  };
}

function sanitizedLaunch(launch) {
  const interestingEnvKeys = [
    "PARLEY_MODE",
    "PARLEY_API_URL",
    "PARLEY_AGENT_ID",
    PARLEY_CREDENTIAL_FILE_ENV,
    PARLEY_CREDENTIAL_ENV,
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
    env[key] = key === PARLEY_CREDENTIAL_ENV ? "__REDACTED__" : launch.env[key];
  }
  return {
    command: launch.command,
    args: launch.args,
    metadata: {
      ...launch.metadata,
      hasCredential: launch.metadata.hasCredential,
      credentialFile: launch.metadata.credentialFile
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
  if (typeof process.execve !== "function") {
    stderr.write("parley-codex: this Node.js runtime does not provide process.execve; upgrade Node or use --dry-run to export the Parley environment.\n");
    return 127;
  }

  try {
    const executable = resolveExecutable(launch.command, launch.env, launch.metadata.workspace);
    process.chdir(launch.metadata.workspace);
    process.execve(executable, [launch.command, ...launch.args], launch.env);
    return 1;
  } catch (error) {
    stderr.write(`parley-codex: failed to launch ${launch.command}: ${error.message}\n`);
    return error?.code === "ENOENT" ? 127 : 1;
  }
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
