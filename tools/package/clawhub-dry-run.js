#!/usr/bin/env node
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
  --source-commit <sha>   Git commit SHA. Default: git HEAD from .git metadata.
  --source-ref <ref>      Git ref/branch/tag. Default: current branch, then HEAD.
  --source-path <path>    Repo subpath to report to ClawHub.
  --clawhub-command <cmd> Explicit clawhub command instead of PATH/npx detection.
  -h, --help             Show this help.
`;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readTrimmed(filePath) {
  return fs.readFileSync(filePath, "utf8").trim();
}

function firstExistingPath(paths) {
  return paths.find((candidate) => fs.existsSync(candidate));
}

function findRepositoryMarker(cwd = repoRoot) {
  let current = path.resolve(cwd);
  while (true) {
    const marker = path.join(current, ".git");
    if (fs.existsSync(marker)) return { marker, workTree: current };
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function resolveGitDirs(cwd = repoRoot) {
  const found = findRepositoryMarker(cwd);
  if (!found) {
    throw new Error(`Unable to locate .git metadata from ${cwd}`);
  }

  let gitDir;
  const stat = fs.statSync(found.marker);
  if (stat.isDirectory()) {
    gitDir = found.marker;
  } else {
    const content = readTrimmed(found.marker);
    const match = content.match(/^gitdir:\s*(.+)$/i);
    if (!match) throw new Error(`Unsupported .git file format at ${found.marker}`);
    gitDir = path.resolve(found.workTree, match[1]);
  }

  let commonDir = gitDir;
  const commonDirFile = path.join(gitDir, "commondir");
  if (fs.existsSync(commonDirFile)) {
    commonDir = path.resolve(gitDir, readTrimmed(commonDirFile));
  }

  return { gitDir, commonDir, workTree: found.workTree };
}

function readGitConfigValue(sectionName, keyName, cwd = repoRoot) {
  const { commonDir } = resolveGitDirs(cwd);
  const configPath = path.join(commonDir, "config");
  if (!fs.existsSync(configPath)) return undefined;

  let inSection = false;
  for (const rawLine of fs.readFileSync(configPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      inSection = sectionMatch[1] === sectionName;
      continue;
    }
    if (!inSection) continue;
    const keyMatch = line.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (keyMatch && keyMatch[1].trim() === keyName) {
      return keyMatch[2].trim();
    }
  }
  return undefined;
}

function readPackedRef(refName, commonDir) {
  const packedRefsPath = path.join(commonDir, "packed-refs");
  if (!fs.existsSync(packedRefsPath)) return undefined;
  for (const rawLine of fs.readFileSync(packedRefsPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("^")) continue;
    const [sha, ref] = line.split(/\s+/, 2);
    if (ref === refName) return sha;
  }
  return undefined;
}

function readHead(cwd = repoRoot) {
  const { gitDir, commonDir } = resolveGitDirs(cwd);
  const head = readTrimmed(path.join(gitDir, "HEAD"));
  const refMatch = head.match(/^ref:\s*(.+)$/);
  if (!refMatch) return { type: "sha", value: head, gitDir, commonDir };
  return { type: "ref", value: refMatch[1], gitDir, commonDir };
}

function currentBranchOrHead(cwd = repoRoot) {
  const head = readHead(cwd);
  if (head.type !== "ref") return "HEAD";
  return head.value.startsWith("refs/heads/") ? head.value.slice("refs/heads/".length) : head.value;
}

function currentCommit(cwd = repoRoot) {
  const head = readHead(cwd);
  if (head.type === "sha") return head.value;
  const looseRef = firstExistingPath([
    path.join(head.gitDir, head.value),
    path.join(head.commonDir, head.value)
  ]);
  if (looseRef) return readTrimmed(looseRef);
  const packedRef = readPackedRef(head.value, head.commonDir);
  if (packedRef) return packedRef;
  throw new Error(`Unable to resolve Git ref ${head.value}; pass --source-commit <sha>.`);
}

function commandPath(command, env = process.env) {
  const names = process.platform === "win32" && !path.extname(command)
    ? [command, ...(env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean).map((ext) => `${command}${ext}`)]
    : [command];

  if (command.includes("/") || command.includes("\\")) {
    for (const name of names) {
      const candidate = path.isAbsolute(name) ? name : path.resolve(repoRoot, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Try the next candidate.
      }
    }
    return undefined;
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
  return undefined;
}

function commandExists(command, env = process.env) {
  return commandPath(command, env) != null;
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

function detectSourceRepo(cwd = repoRoot) {
  return githubRepoFromRemote(readGitConfigValue('remote "origin"', "url", cwd));
}

export function resolveSourceMetadata(options = {}, cwd = repoRoot) {
  const sourceRepo = nonEmptyString(options["source-repo"]) ?? detectSourceRepo(cwd);
  const sourceCommit = nonEmptyString(options["source-commit"]) ?? currentCommit(cwd);
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
  if (typeof process.execve !== "function") {
    stderr.write("clawhub-dry-run: this Node.js runtime does not provide process.execve; run clawhub package publish directly with the printed source metadata.\n");
    return 127;
  }
  const executable = commandPath(commandSpec.command, commandSpec.env);
  if (!executable) {
    stderr.write(`clawhub-dry-run: command not found on PATH: ${commandSpec.command}\n`);
    return 127;
  }
  process.chdir(commandSpec.cwd);
  process.execve(executable, [commandSpec.command, ...commandSpec.args], commandSpec.env);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    process.exitCode = runClawHubDryRun();
  } catch (error) {
    process.stderr.write(`clawhub-dry-run: ${error.message}\n`);
    process.exitCode = 1;
  }
}
