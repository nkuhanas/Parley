import assert from "node:assert/strict";
import test from "node:test";

import { buildParleyCodexLaunch, parseParleyCodexArgs, runParleyCodex } from "../src/cli/parley-codex.js";

function memoryStream() {
  const chunks = [];
  return {
    write(chunk) { chunks.push(String(chunk)); },
    text() { return chunks.join(""); }
  };
}

test("parley-codex builds client-mode codex actor environment", () => {
  const options = parseParleyCodexArgs([
    "--api-url", "http://127.0.0.1:7331",
    "--auth-token-file", "/run/parley/token",
    "--default-board", "parley",
    "--session-id", "codex-parley-vm-fixed",
    "--host-id", "parley-vm",
    "--workspace", "/srv/workspaces/Parley",
    "--",
    "--model", "gpt-5.5"
  ]);
  const launch = buildParleyCodexLaunch(options, { PATH: "/bin" }, new Date("2026-05-16T06:30:00Z"));

  assert.equal(launch.command, "codex");
  assert.deepEqual(launch.args, ["--model", "gpt-5.5"]);
  assert.equal(launch.env.PARLEY_MODE, "client");
  assert.equal(launch.env.PARLEY_API_URL, "http://127.0.0.1:7331");
  assert.equal(launch.env.PARLEY_AGENT_ID, "codex-agent");
  assert.equal(launch.env.PARLEY_AUTH_TOKEN_FILE, "/run/parley/token");
  assert.equal(launch.env.PARLEY_DEFAULT_BOARD, "parley");
  assert.equal(launch.env.PARLEY_CALLER_RUNTIME, "codex");
  assert.equal(launch.env.PARLEY_CALLER_RUNTIME_REF, "codex:agent:codex-agent");
  assert.equal(launch.env.PARLEY_CALLER_RUNTIME_ALIASES, "codex:session:codex-parley-vm-fixed");
  assert.equal(launch.env.PARLEY_SESSION_ID, "codex-parley-vm-fixed");
  assert.equal(launch.env.PARLEY_WORKER_SURFACE, "codex-cli");
  assert.equal(launch.env.PARLEY_HOST_ID, "parley-vm");
  assert.equal(launch.env.PARLEY_WORKSPACE, "/srv/workspaces/Parley");
  assert.equal(launch.env.PARLEY_SURFACE, undefined, "wrapper must not set core PARLEY_SURFACE to unsupported codex-cli");
});

test("parley-codex supports explicit actor/runtime/command overrides", () => {
  const launch = buildParleyCodexLaunch(parseParleyCodexArgs([
    "--actor", "codex-agent",
    "--runtime", "codex",
    "--surface", "codex-cli",
    "--api-url", "https://parley.example.test",
    "--auth-token", "secret-token",
    "--command", "echo",
    "hello"
  ]), { PATH: "/bin" }, new Date("2026-05-16T06:30:00Z"));

  assert.equal(launch.command, "echo");
  assert.deepEqual(launch.args, ["hello"]);
  assert.equal(launch.env.PARLEY_AUTH_TOKEN, "secret-token");
  assert.equal(launch.metadata.hasCredential, true);
  assert.equal(launch.metadata.runtimeRef, "codex:agent:codex-agent");
  assert.match(launch.metadata.sessionId, /^codex-/);
});

test("parley-codex fails closed without api url or auth", () => {
  assert.throws(
    () => buildParleyCodexLaunch(parseParleyCodexArgs(["--auth-token-file", "/token"]), {}, new Date("2026-05-16T06:30:00Z")),
    /PARLEY_API_URL or --api-url is required/
  );
  assert.throws(
    () => buildParleyCodexLaunch(parseParleyCodexArgs(["--api-url", "http://127.0.0.1:7331"]), {}, new Date("2026-05-16T06:30:00Z")),
    /PARLEY_AUTH_TOKEN_FILE.*or PARLEY_AUTH_TOKEN/
  );
});

test("parley-codex dry-run prints sanitized launch details", async () => {
  const stdout = memoryStream();
  const exitCode = await runParleyCodex([
    "--api-url", "http://127.0.0.1:7331",
    "--auth-token", "secret-token",
    "--session-id", "codex-test-session",
    "--dry-run"
  ], {
    stdout,
    env: { PATH: "/bin" },
    now: new Date("2026-05-16T06:30:00Z")
  });
  const parsed = JSON.parse(stdout.text());

  assert.equal(exitCode, 0);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.launch.env.PARLEY_AUTH_TOKEN, "__REDACTED__");
  assert.equal(parsed.launch.env.PARLEY_AGENT_ID, "codex-agent");
  assert.equal(parsed.launch.env.PARLEY_CALLER_RUNTIME_REF, "codex:agent:codex-agent");
});
