import assert from "node:assert/strict";
import test from "node:test";

import {
  PINNED_CLAWHUB_VERSION,
  buildClawHubDryRunCommand,
  githubRepoFromRemote,
  parseArgs
} from "../tools/package/clawhub-dry-run.js";

test("clawhub dry-run wrapper parses GitHub repos from common remote URL shapes", () => {
  assert.equal(githubRepoFromRemote("git@github.com:nkuhanas/Parley.git"), "nkuhanas/Parley");
  assert.equal(githubRepoFromRemote("https://github.com/nkuhanas/Parley.git"), "nkuhanas/Parley");
  assert.equal(githubRepoFromRemote("git@parley-github:nkuhanas/Parley.git"), "nkuhanas/Parley");
  assert.equal(githubRepoFromRemote("nkuhanas/Parley"), "nkuhanas/Parley");
});

test("clawhub dry-run wrapper builds a no-publish package publish plan", () => {
  const command = buildClawHubDryRunCommand({
    "clawhub-command": "clawhub",
    "source-repo": "nkuhanas/Parley",
    "source-commit": "abc123",
    "source-ref": "main"
  }, { PATH: "/bin" }, "/repo");

  assert.equal(command.command, "clawhub");
  assert.deepEqual(command.args, [
    "package", "publish", ".", "--dry-run", "--json",
    "--source-repo", "nkuhanas/Parley",
    "--source-commit", "abc123",
    "--source-ref", "main"
  ]);
  assert.equal(command.env.CLAWHUB_DISABLE_TELEMETRY, "1");
  assert.equal(command.usesNpxFallback, false);
});

test("clawhub dry-run wrapper can force the pinned npx fallback", () => {
  const command = buildClawHubDryRunCommand({
    "source-repo": "nkuhanas/Parley",
    "source-commit": "abc123",
    "source-ref": "main"
  }, { PATH: "/definitely-not-a-real-path" }, "/repo");

  assert.equal(command.command, "npx");
  assert.equal(command.usesNpxFallback, true);
  assert.deepEqual(command.args.slice(0, 2), ["--yes", `clawhub@${PINNED_CLAWHUB_VERSION}`]);
  assert.ok(command.args.includes("--dry-run"));
  assert.ok(command.args.includes("--json"));
});

test("clawhub dry-run wrapper rejects valueless options", () => {
  assert.throws(() => parseArgs(["--source-repo"]), /requires a value/);
});
