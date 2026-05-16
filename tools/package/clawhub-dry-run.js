#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PINNED_CLAWHUB_VERSION = "0.15.0";

const scriptPath = fileURLToPath(import.meta.url);
export const repoRoot = path.resolve(path.dirname(scriptPath), "../..");

function usage() {
  return `Usage: npm run clawhub:dry-run -- [options]

Run the ClawHub package publish dry-run for this Parley checkout without
requiring a globally installed clawhub CLI.

Options:
  --source-repo <repo>    GitHub repo, e.g. nkuhanas/Parley. Default: git origin.
  --source-commit <sha>   Git commit SHA. Default: git rev-parse HEAD.
  --source-ref <ref>      Git ref/branch/tag. Default: current branch, then HEAD.
  --source-path <path>    Repo subpath to report to ClawHub.
  --clawhub-command <cmd> Explicit clawhub command instead of PATH/npx detection.
  -h, --help             Show this help.
`;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function git(args, cwd = repoRoot) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function commandExists(command, env = process.env) {
  const pathValue = env.PATH ?? "";
  const pathExt = process.platform === "win32"
    ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of pathExt) {
      const candidate = path.join(dir, process.platform === "win32" ? `${command}${ext}` : command);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        // Keep scanning PATH.
      }
    }
  }
  return false;
}

export function parseArgs(argv = []) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
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

export function githubRepoFromRemote(remoteUrl) {
  const value = nonEmptyString(remoteUrl);
  if (!value) return undefined;

  const withoutGitSuffix = value.replace(/\.git$/i, "");
  const githubMatch = withoutGitSuffix.match(/github\.com[/:]([^/]+\/[^/#]+)$/i);
  if (githubMatch) return githubMatch[1];

  const scpLikeMatch = withoutGitSuffix.match(/^[^:]+:([^/]+\/[^/#]+)$/);
  if (scpLikeMatch) return scpLikeMatch[1];

  const shorthandMatch = withoutGitSuffix.match(/^([^/\s]+\/[^/\s]+)$/);
  if (shorthandMatch) return shorthandMatch[1];

  return undefined;
}

function currentBranchOrHead(cwd = repoRoot) {
  const branch = git(["branch", "--show-current"], cwd);
  return branch || "HEAD";
}

function detectSourceRepo(cwd = repoRoot) {
  return githubRepoFromRemote(git(["remote", "get-url", "origin"], cwd));
}

export function resolveSourceMetadata(options = {}, cwd = repoRoot) {
  const sourceRepo = nonEmptyString(options["source-repo"]) ?? detectSourceRepo(cwd);
  const sourceCommit = nonEmptyString(options["source-commit"]) ?? git(["rev-parse", "HEAD"], cwd);
  const sourceRef = nonEmptyString(options["source-ref"]) ?? currentBranchOrHead(cwd);
  const sourcePath = nonEmptyString(options["source-path"]);

  if (!sourceRepo) {
    throw new Error("Unable to infer GitHub source repo from git origin; pass --source-repo <owner/repo>.");
  }
  if (!sourceCommit) {
    throw new Error("Unable to infer source commit; pass --source-commit <sha>.");
  }

  return { sourceRepo, sourceCommit, sourceRef, sourcePath };
}

export function buildClawHubDryRunCommand(options = {}, env = process.env, cwd = repoRoot) {
  const metadata = resolveSourceMetadata(options, cwd);
  const explicitCommand = nonEmptyString(options["clawhub-command"]);
  const hasLocalClawHub = explicitCommand ? true : commandExists("clawhub", env);
  const command = explicitCommand ?? (hasLocalClawHub ? "clawhub" : "npx");
  const args = explicitCommand || hasLocalClawHub
    ? ["package", "publish", ".", "--dry-run", "--json"]
    : ["--yes", `clawhub@${PINNED_CLAWHUB_VERSION}`, "package", "publish", ".", "--dry-run", "--json"];

  args.push("--source-repo", metadata.sourceRepo, "--source-commit", metadata.sourceCommit);
  if (metadata.sourceRef) args.push("--source-ref", metadata.sourceRef);
  if (metadata.sourcePath) args.push("--source-path", metadata.sourcePath);

  return {
    command,
    args,
    cwd,
    env: {
      ...env,
      CLAWHUB_DISABLE_TELEMETRY: env.CLAWHUB_DISABLE_TELEMETRY ?? "1"
    },
    metadata,
    usesNpxFallback: !explicitCommand && !hasLocalClawHub
  };
}

export function runClawHubDryRun(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const options = parseArgs(argv);
  if (options.help) {
    stdout.write(usage());
    return 0;
  }
  const commandSpec = buildClawHubDryRunCommand(options, io.env ?? process.env, io.cwd ?? repoRoot);
  const result = spawnSync(commandSpec.command, commandSpec.args, {
    cwd: commandSpec.cwd,
    env: commandSpec.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.stdout) stdout.write(result.stdout);
  if (result.stderr) stderr.write(result.stderr);
  return result.status ?? (result.error ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    process.exitCode = runClawHubDryRun();
  } catch (error) {
    process.stderr.write(`clawhub-dry-run: ${error.message}\n`);
    process.exitCode = 1;
  }
}
