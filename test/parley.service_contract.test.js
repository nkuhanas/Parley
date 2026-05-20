import test from "node:test";
import assert from "node:assert/strict";

import {
  SERVICE_ERROR_CODES,
  artifactHandle,
  artifactReadResponse,
  boardIdForRead,
  errorResponse,
  mutationResponse,
  normalizeCallerContext,
  queryResponse,
  requireExplicitBoardIdForMutation,
  serviceError
} from "../src/service/index.js";

test("service caller context normalizes transport-safe trace metadata", () => {
  const caller = normalizeCallerContext({
    actorId: "parley-agent",
    actorType: "agent",
    runtime: "openclaw",
    runtimeRef: { scheme: "openclaw", type: "session", id: "session-1" },
    runtimeAliases: [{ runtime_ref: { scheme: "openclaw", type: "agent", id: "parley-agent" } }],
    boardId: "parley",
    requestId: "req-1",
    capabilities: ["read", "mutate"]
  });

  assert.deepEqual(caller, {
    actor_id: "parley-agent",
    actor_type: "agent",
    runtime: "openclaw",
    runtime_ref: { scheme: "openclaw", type: "session", id: "session-1" },
    runtime_aliases: [{ runtime_ref: { scheme: "openclaw", type: "agent", id: "parley-agent" } }],
    board_id: "parley",
    request_id: "req-1",
    capabilities: ["read", "mutate"]
  });
});

test("service caller context reports missing actor as generic identity ambiguity", () => {
  assert.throws(
    () => normalizeCallerContext({}),
    (error) => error.code === SERVICE_ERROR_CODES.AMBIGUOUS_CALLER_IDENTITY
  );
});

test("service board targeting defaults reads but requires explicit mutation board", () => {
  const caller = { actor_id: "parley-agent", actor_type: "agent", board_id: "caller-board" };

  assert.equal(boardIdForRead({}, caller), "caller-board");
  assert.equal(boardIdForRead({ board_id: "input-board" }, caller), "input-board");
  assert.equal(requireExplicitBoardIdForMutation({ board_id: "input-board" }, caller), "input-board");

  assert.throws(
    () => requireExplicitBoardIdForMutation({}, caller),
    (error) => error.code === SERVICE_ERROR_CODES.MISSING_BOARD_ID
  );
});

test("service mutation response includes protocol code and primary artifact fields", () => {
  const response = mutationResponse({
    status: "blocked",
    code: "MISSING_BOARD_PERMISSION",
    message: "Caller lacks mutate permission for board parley.",
    artifact_ref: "repo://plans/example.md",
    artifact_path: "/tmp/example.md",
    artifact_version: 2,
    projection: { kind: "plan_markdown", uri: "repo://plans/example.md" },
    projection_materialization: { status: "written", localPath: "/tmp/mirror/example.md" },
    summary: "Mutation was not applied.",
    warnings: ["permission denied"]
  });

  assert.equal(response.status, "blocked");
  assert.equal(response.code, "MISSING_BOARD_PERMISSION");
  assert.equal(response.message, "Caller lacks mutate permission for board parley.");
  assert.equal(response.artifact_ref, "repo://plans/example.md");
  assert.equal(response.artifact_path, "/tmp/example.md");
  assert.equal(response.artifact_version, 2);
  assert.deepEqual(response.projection, { kind: "plan_markdown", uri: "repo://plans/example.md" });
  assert.deepEqual(response.projection_materialization, { status: "written", localPath: "/tmp/mirror/example.md" });
});

test("service query and artifact read responses stay compact by default", () => {
  const query = queryResponse({ data: { plan_id: "plan_1" }, cursor: "effect:1" });
  assert.deepEqual(query, { status: "ok", data: { plan_id: "plan_1" }, cursor: "effect:1" });

  const artifact = {
    artifact_id: "artifact_1",
    uri: "repo://plans/plan.md",
    resolved_path: "/tmp/plan.md",
    version: 1,
    title: "Plan",
    kind: "plan",
    content_hash: "sha256:test"
  };
  assert.deepEqual(artifactHandle(artifact, "primary"), {
    artifact_id: "artifact_1",
    artifact_ref: "repo://plans/plan.md",
    artifact_path: "/tmp/plan.md",
    artifact_version: 1,
    role: "primary"
  });

  const compact = artifactReadResponse({ artifact, body: "large body" });
  assert.equal(compact.body, undefined);
  assert.equal(compact.body_truncated, undefined);

  const withBody = artifactReadResponse({ artifact, include_body: true, body: "large body", body_truncated: false });
  assert.equal(withBody.body, "large body");
  assert.equal(withBody.body_truncated, false);
});

test("service errors convert to code/message response fields", () => {
  const response = errorResponse(serviceError(
    SERVICE_ERROR_CODES.VALIDATION_FAILED,
    "Plan document failed validation.",
    { status: "blocked" }
  ));

  assert.equal(response.status, "blocked");
  assert.equal(response.code, SERVICE_ERROR_CODES.VALIDATION_FAILED);
  assert.equal(response.message, "Plan document failed validation.");
});
