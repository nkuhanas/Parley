import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ParleyConfigError } from "../core/config.js";
import {
  HTTP_CREDENTIAL_HEADER,
  PARLEY_CREDENTIAL_CONFIG,
  PARLEY_CREDENTIAL_FILE_CONFIG,
  REMOTE_CREDENTIAL_FILE_OPTION,
  REMOTE_CREDENTIAL_OPTION
} from "../core/sensitive_names.js";
import { serviceResponse } from "../service/responses.js";

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function normalizeApiUrl(value) {
  const apiUrl = nonEmptyString(value);
  if (apiUrl == null) {
    throw new ParleyConfigError("createParleyRemoteClient requires apiUrl", "PARLEY_API_URL_REQUIRED");
  }
  let parsed;
  try {
    parsed = new URL(apiUrl);
  } catch (_error) {
    throw new ParleyConfigError("apiUrl must be a valid HTTP(S) URL", "PARLEY_API_URL_INVALID", { apiUrl });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ParleyConfigError("apiUrl must use http or https", "PARLEY_API_URL_INVALID", { apiUrl });
  }
  return parsed.toString().replace(/\/$/, "");
}

function normalizeFetch(fetchImpl) {
  const resolved = fetchImpl ?? globalThis.fetch;
  if (typeof resolved !== "function") {
    throw new ParleyConfigError(
      "createParleyRemoteClient requires fetchImpl when globalThis.fetch is unavailable.",
      "PARLEY_FETCH_UNAVAILABLE"
    );
  }
  return resolved;
}

function normalizeCaller(options = {}) {
  const actorId = nonEmptyString(options.actor_id ?? options.actorId)
    ?? nonEmptyString(options.agentId)
    ?? "parley-client";
  return {
    actor_id: actorId,
    actor_type: nonEmptyString(options.actor_type ?? options.actorType) ?? "agent",
    runtime: nonEmptyString(options.runtime) ?? "sdk",
    runtime_ref: options.runtime_ref ?? options.runtimeRef,
    runtime_aliases: options.runtime_aliases ?? options.runtimeAliases,
    board_id: nonEmptyString(options.board_id ?? options.boardId) ?? nonEmptyString(options.defaultBoard),
    request_id: nonEmptyString(options.request_id ?? options.requestId),
    capabilities: options.capabilities
  };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => {
    if (entry == null) return false;
    if (Array.isArray(entry) && entry.length === 0) return false;
    return true;
  }));
}

function normalizeInput(input) {
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

function endpoint(baseUrl, parts = []) {
  return `${baseUrl}/${parts.map((part) => encodeURIComponent(part)).join("/")}`;
}

function headerGet(headers, name) {
  if (headers?.get) return headers.get(name);
  if (headers && typeof headers === "object") return headers[name] ?? headers[name.toLowerCase()];
  return undefined;
}

async function parseJsonResponse(response) {
  const contentType = headerGet(response.headers, "content-type") ?? "";
  if (typeof response.json === "function" && (contentType.includes("json") || contentType === "")) {
    try {
      return await response.json();
    } catch (_error) {
      // Fall through to text parsing when the mock/response exposes both helpers.
    }
  }
  if (typeof response.text === "function") {
    const text = await response.text();
    if (!text.trim()) return undefined;
    try {
      return JSON.parse(text);
    } catch (_error) {
      return { message: text };
    }
  }
  return undefined;
}

async function remoteResponse(response, fallbackMessage) {
  const body = await parseJsonResponse(response);
  if (response.ok) return body ?? serviceResponse({ status: "ok" });
  const status = response.status ?? 0;
  const statusText = response.statusText ?? "HTTP error";
  return serviceResponse({
    status: "error",
    code: body?.code ?? `PARLEY_HTTP_${status || "ERROR"}`,
    message: body?.message ?? `${fallbackMessage}: ${status} ${statusText}`,
    diagnostics: body?.diagnostics ?? compactObject({ status, statusText, body })
  });
}

export function createParleyRemoteClient(options = {}) {
  const apiUrl = normalizeApiUrl(options.apiUrl ?? options.parleyApiUrl);
  const fetchImpl = normalizeFetch(options.fetchImpl);
  const defaultCaller = normalizeCaller(options);
  const credentialFile = nonEmptyString(options.credentialFile ?? options[REMOTE_CREDENTIAL_FILE_OPTION] ?? options[PARLEY_CREDENTIAL_FILE_CONFIG]);
  let cachedCredential = nonEmptyString(options.credential ?? options[REMOTE_CREDENTIAL_OPTION] ?? options[PARLEY_CREDENTIAL_CONFIG]);

  async function resolveCredential() {
    if (cachedCredential != null) return cachedCredential;
    if (credentialFile == null) return undefined;
    const credential = (await fs.readFile(path.resolve(expandHome(credentialFile)), "utf8")).trim();
    cachedCredential = credential || undefined;
    return cachedCredential;
  }

  async function request(pathParts, { method = "GET", body, requestId } = {}) {
    const headers = {
      accept: "application/json"
    };
    if (body != null) headers["content-type"] = "application/json";
    const credential = await resolveCredential();
    if (credential != null) headers[HTTP_CREDENTIAL_HEADER] = `Bearer ${credential}`;
    const resolvedRequestId = nonEmptyString(requestId);
    if (resolvedRequestId != null) headers["x-parley-request-id"] = resolvedRequestId;

    let response;
    try {
      response = await fetchImpl(endpoint(apiUrl, pathParts), compactObject({
        method,
        headers,
        body: body == null ? undefined : JSON.stringify(body)
      }));
    } catch (error) {
      return serviceResponse({
        status: "error",
        code: "PARLEY_REMOTE_FETCH_FAILED",
        message: error?.message ?? "Parley remote request failed.",
        diagnostics: compactObject({ endpoint: endpoint(apiUrl, pathParts), method })
      });
    }
    return remoteResponse(response, "Parley remote request failed");
  }

  function requestEnvelope(input = {}, requestOptions = {}) {
    const caller = normalizeCaller({
      ...defaultCaller,
      ...(requestOptions.caller ?? {}),
      request_id: requestOptions.requestId ?? requestOptions.request_id ?? defaultCaller.request_id
    });
    return compactObject({
      caller,
      input: normalizeInput(input),
      request_id: requestOptions.requestId ?? requestOptions.request_id,
      idempotency_key: requestOptions.idempotencyKey ?? requestOptions.idempotency_key
    });
  }

  async function health(options = {}) {
    return request(["health"], { method: "GET", requestId: options.requestId ?? options.request_id });
  }

  async function meta(options = {}) {
    return request(["v1", "meta"], { method: "GET", requestId: options.requestId ?? options.request_id });
  }

  async function query(name, input = {}, options = {}) {
    const queryName = nonEmptyString(name);
    if (queryName == null) {
      throw new ParleyConfigError("Remote query name is required", "PARLEY_REMOTE_QUERY_NAME_REQUIRED");
    }
    return request(["v1", "queries", queryName], {
      method: "POST",
      body: requestEnvelope(input, options),
      requestId: options.requestId ?? options.request_id
    });
  }

  async function command(name, input = {}, options = {}) {
    const commandName = nonEmptyString(name);
    if (commandName == null) {
      throw new ParleyConfigError("Remote command name is required", "PARLEY_REMOTE_COMMAND_NAME_REQUIRED");
    }
    return request(["v1", "commands", commandName], {
      method: "POST",
      body: requestEnvelope(input, options),
      requestId: options.requestId ?? options.request_id
    });
  }

  return {
    mode: "client",
    apiUrl,
    caller: defaultCaller,
    health,
    meta,
    query,
    command,
    describe: (input = {}, options = {}) => query("describe", input, options),
    myBoards: (input = {}, options = {}) => query("myBoards", input, options),
    whereAmI: (input = {}, options = {}) => query("whereAmI", input, options),
    readPlanProjection: (input = {}, options = {}) => query("readPlanProjection", input, options),
    mutate: (input = {}, options = {}) => command("mutate", input, options),
    runtime: (input = {}, options = {}) => command("runtime", input, options),
    listRuntimeObligations: (input = {}, options = {}) => query("listRuntimeObligations", input, options),
    listBoardObligations: (input = {}, options = {}) => query("listBoardObligations", input, options)
  };
}
