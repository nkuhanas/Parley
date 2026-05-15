import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createParleyRemoteClient } from "../src/client/index.js";

function jsonResponse(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? "OK",
    headers: { get: (name) => name.toLowerCase() === "content-type" ? "application/json" : undefined },
    json: async () => body
  };
}

async function withTempRoot(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "parley-remote-client-test-"));
  try {
    await callback(tempRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

test("remote client uses injected fetch for health and query calls", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/health")) return jsonResponse({ status: "ok", data: { service: "parley" } });
    return jsonResponse({ status: "ok", data: { query: "describe" } });
  };

  const client = createParleyRemoteClient({
    apiUrl: "http://parley.test/base/",
    authToken: "secret-token",
    agentId: "parley-agent",
    defaultBoard: "project",
    fetchImpl
  });

  const health = await client.health({ requestId: "req-health" });
  assert.equal(health.status, "ok");
  assert.equal(calls[0].url, "http://parley.test/base/health");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.authorization, "Bearer secret-token");
  assert.equal(calls[0].init.headers["x-parley-request-id"], "req-health");

  const described = await client.describe({ topic: "targets" }, { requestId: "req-query" });
  assert.equal(described.status, "ok");
  assert.equal(calls[1].url, "http://parley.test/base/v1/queries/describe");
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.headers["content-type"], "application/json");
  assert.equal(calls[1].init.headers.authorization, "Bearer secret-token");
  assert.equal(calls[1].init.headers["x-parley-request-id"], "req-query");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    caller: {
      actor_id: "parley-agent",
      actor_type: "agent",
      runtime: "sdk",
      board_id: "project",
      request_id: "req-query"
    },
    input: { topic: "targets" },
    request_id: "req-query"
  });
});

test("remote client can read bearer token from an injected token file", async () => {
  await withTempRoot(async (tempRoot) => {
    const tokenPath = path.join(tempRoot, "token");
    await fs.writeFile(tokenPath, "file-token\n", "utf8");
    const calls = [];
    const client = createParleyRemoteClient({
      apiUrl: "https://parley.example",
      authTokenFile: tokenPath,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse({ status: "ok" });
      }
    });

    await client.myBoards();
    assert.equal(calls[0].init.headers.authorization, "Bearer file-token");
  });
});

test("remote client maps HTTP and transport failures into stable envelopes", async () => {
  const serviceDown = createParleyRemoteClient({
    apiUrl: "http://parley.test",
    fetchImpl: async () => jsonResponse(
      { code: "SERVICE_DOWN", message: "service unavailable" },
      { ok: false, status: 503, statusText: "Service Unavailable" }
    )
  });
  const errorEnvelope = await serviceDown.whereAmI();
  assert.equal(errorEnvelope.status, "error");
  assert.equal(errorEnvelope.code, "SERVICE_DOWN");
  assert.equal(errorEnvelope.message, "service unavailable");

  const fetchFailed = createParleyRemoteClient({
    apiUrl: "http://parley.test",
    fetchImpl: async () => { throw new Error("connection refused"); }
  });
  const failedEnvelope = await fetchFailed.health();
  assert.equal(failedEnvelope.status, "error");
  assert.equal(failedEnvelope.code, "PARLEY_REMOTE_FETCH_FAILED");
  assert.match(failedEnvelope.message, /connection refused/);
});
