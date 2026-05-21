import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SERVICE_ERROR_CODES } from "./errors.js";
import { errorResponse, serviceResponse } from "./responses.js";
import {
  checkpointProjection,
  describe,
  getBoardProjection,
  getPlanOverview,
  getPlanPhases,
  getPlanRelationships,
  getPlanReviewStatus,
  getPlanSetupStatus,
  getPlanStatus,
  listBoardObligations,
  listRuntimeObligations,
  myBoards,
  readPlanProjection,
  searchReferences,
  validatePlan,
  validateState,
  whereAmI
} from "./queries/index.js";
import { mutate, runtime } from "./commands/index.js";
import { resolveParleyRuntimeConfig } from "../core/config.js";
import {
  HTTP_CREDENTIAL_HEADER,
  PARLEY_CREDENTIAL_CONFIG,
  PARLEY_CREDENTIAL_FILE_CONFIG,
  REMOTE_CREDENTIAL_FILE_OPTION,
  REMOTE_CREDENTIAL_OPTION
} from "../core/sensitive_names.js";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export const HTTP_QUERY_HANDLERS = Object.freeze({
  checkpointProjection,
  describe,
  getBoardProjection,
  getPlanOverview,
  getPlanPhases,
  getPlanRelationships,
  getPlanReviewStatus,
  getPlanSetupStatus,
  getPlanStatus,
  listBoardObligations,
  listRuntimeObligations,
  myBoards,
  readPlanProjection,
  searchReferences,
  validatePlan,
  validateState,
  whereAmI
});

export const HTTP_COMMAND_HANDLERS = Object.freeze({
  mutate,
  runtime
});

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => {
    if (entry == null) return false;
    if (Array.isArray(entry) && entry.length === 0) return false;
    return true;
  }));
}

function normalizeEnvelope(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("HTTP service request envelope must be a JSON object");
  }
  return value;
}

function unsupportedAction(kind, name) {
  return serviceResponse({
    status: "error",
    code: SERVICE_ERROR_CODES.UNSUPPORTED_ACTION,
    message: `Unsupported Parley ${kind}: ${name}`,
    diagnostics: { kind, name }
  });
}

function authError(code, message, diagnostics = undefined) {
  return serviceResponse({ status: "error", code, message, diagnostics });
}

function responseStatusForEnvelope(envelope, fallback = 200) {
  if (envelope?.status !== "error") return fallback;
  switch (envelope.code) {
    case SERVICE_ERROR_CODES.AUTH_REQUIRED:
      return 401;
    case SERVICE_ERROR_CODES.AUTH_FORBIDDEN:
      return 403;
    case SERVICE_ERROR_CODES.AUTH_NOT_CONFIGURED:
      return 503;
    case SERVICE_ERROR_CODES.MALFORMED_REQUEST:
      return 400;
    case SERVICE_ERROR_CODES.UNSUPPORTED_ACTION:
      return 404;
    default:
      return 500;
  }
}

function sendJson(res, statusCode, envelope) {
  const body = JSON.stringify(envelope ?? serviceResponse({ status: "ok" }));
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJsonBody(req, maxBodyBytes = DEFAULT_MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("HTTP service request body is too large");
      error.code = SERVICE_ERROR_CODES.MALFORMED_REQUEST;
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return normalizeEnvelope(JSON.parse(raw));
  } catch (error) {
    const wrapped = new Error(error?.message ?? "Invalid JSON body");
    wrapped.code = SERVICE_ERROR_CODES.MALFORMED_REQUEST;
    throw wrapped;
  }
}

function bearerTokenFromRequest(req) {
  const bearerHeader = req.headers[HTTP_CREDENTIAL_HEADER];
  if (!bearerHeader || Array.isArray(bearerHeader)) return undefined;
  const match = bearerHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

async function expectedBearerCredential(options = {}) {
  if (options.__cachedBearerCredential !== undefined) return options.__cachedBearerCredential;
  const explicit = nonEmptyString(options.credential ?? options[REMOTE_CREDENTIAL_OPTION] ?? options[PARLEY_CREDENTIAL_CONFIG]);
  if (explicit != null) {
    options.__cachedBearerCredential = explicit;
    return explicit;
  }
  const credentialFile = nonEmptyString(options.credentialFile ?? options[REMOTE_CREDENTIAL_FILE_OPTION] ?? options[PARLEY_CREDENTIAL_FILE_CONFIG]);
  if (credentialFile == null) return undefined;
  const credential = (await fs.readFile(path.resolve(expandHome(credentialFile)), "utf8")).trim() || undefined;
  options.__cachedBearerCredential = credential;
  return credential;
}

async function authorize(req, options = {}) {
  const expected = await expectedBearerCredential(options);
  if (expected == null) {
    return authError(
      SERVICE_ERROR_CODES.AUTH_NOT_CONFIGURED,
      "Parley HTTP service auth token is not configured for this protected route."
    );
  }
  const provided = bearerTokenFromRequest(req);
  if (provided == null) {
    return authError(SERVICE_ERROR_CODES.AUTH_REQUIRED, "Bearer token required for this Parley HTTP route.");
  }
  if (provided !== expected) {
    return authError(SERVICE_ERROR_CODES.AUTH_FORBIDDEN, "Bearer token was not accepted for this Parley HTTP route.");
  }
  return null;
}

function depsForOptions(options = {}) {
  return { pluginConfig: options.pluginConfig ?? {}, callGateway: options.callGateway };
}

function normalizeHttpServiceOptions(options = {}) {
  const runtimeConfig = options.runtimeConfig ?? resolveParleyRuntimeConfig({
    surface: "service",
    pluginConfig: options.pluginConfig ?? {},
    config: options.config,
    env: options.env
  });
  return {
    ...options,
    runtimeConfig,
    pluginConfig: {
      ...(options.pluginConfig ?? {}),
      __parleySurface: "service",
      parleyMode: runtimeConfig.mode,
      repoRoot: runtimeConfig.repoRoot,
      parleyDbPath: runtimeConfig.dbPath,
      ...(runtimeConfig.agentId != null ? { parleyAgentId: runtimeConfig.agentId } : {}),
      ...(runtimeConfig.defaultBoard != null ? { parleyDefaultBoard: runtimeConfig.defaultBoard } : {})
    }
  };
}

export async function handleQuery(queryName, requestEnvelope = {}, options = {}) {
  const handler = HTTP_QUERY_HANDLERS[queryName];
  if (handler == null) return unsupportedAction("query", queryName);
  try {
    return await handler(normalizeEnvelope(requestEnvelope), depsForOptions(options));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleCommand(commandName, requestEnvelope = {}, options = {}) {
  const handler = HTTP_COMMAND_HANDLERS[commandName];
  if (handler == null) return unsupportedAction("command", commandName);
  try {
    return await handler(normalizeEnvelope(requestEnvelope), depsForOptions(options));
  } catch (error) {
    return errorResponse(error);
  }
}

function metaEnvelope(options = {}) {
  return serviceResponse({
    data: compactObject({
      service: "parley",
      version: options.version,
      queries: Object.keys(HTTP_QUERY_HANDLERS).sort(),
      commands: Object.keys(HTTP_COMMAND_HANDLERS).sort()
    })
  });
}

async function protectedRoute(req, res, options, required) {
  if (!required) return false;
  const auth = await authorize(req, options);
  if (auth == null) return false;
  sendJson(res, responseStatusForEnvelope(auth), auth);
  return true;
}

export function createParleyHttpHandler(options = {}) {
  const serviceOptions = normalizeHttpServiceOptions(options);
  const maxBodyBytes = serviceOptions.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const requireQueryAuth = serviceOptions.requireQueryAuth ?? true;
  const requireMetaAuth = serviceOptions.requireMetaAuth ?? true;

  return async function parleyHttpHandler(req, res) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (req.method === "GET" && pathname === "/health") {
        sendJson(res, 200, serviceResponse({ data: { service: "parley", status: "ok", mode: serviceOptions.runtimeConfig.mode, storageMode: serviceOptions.runtimeConfig.storageMode } }));
        return;
      }

      if (req.method === "GET" && pathname === "/v1/meta") {
        if (await protectedRoute(req, res, serviceOptions, requireMetaAuth)) return;
        sendJson(res, 200, metaEnvelope(serviceOptions));
        return;
      }

      const queryMatch = pathname.match(/^\/v1\/queries\/([^/]+)$/);
      if (req.method === "POST" && queryMatch) {
        if (await protectedRoute(req, res, serviceOptions, requireQueryAuth)) return;
        const body = await readJsonBody(req, maxBodyBytes);
        const envelope = await handleQuery(decodeURIComponent(queryMatch[1]), body, serviceOptions);
        sendJson(res, responseStatusForEnvelope(envelope), envelope);
        return;
      }

      const commandMatch = pathname.match(/^\/v1\/commands\/([^/]+)$/);
      if (req.method === "POST" && commandMatch) {
        if (await protectedRoute(req, res, serviceOptions, true)) return;
        const body = await readJsonBody(req, maxBodyBytes);
        const envelope = await handleCommand(decodeURIComponent(commandMatch[1]), body, serviceOptions);
        sendJson(res, responseStatusForEnvelope(envelope), envelope);
        return;
      }

      const notFound = serviceResponse({
        status: "error",
        code: SERVICE_ERROR_CODES.UNSUPPORTED_ACTION,
        message: `Unsupported Parley HTTP route: ${req.method} ${pathname}`,
        diagnostics: { method: req.method, pathname }
      });
      sendJson(res, 404, notFound);
    } catch (error) {
      const envelope = serviceResponse({
        status: "error",
        code: error?.code ?? SERVICE_ERROR_CODES.INTERNAL_ERROR,
        message: error?.message ?? "Parley HTTP service request failed."
      });
      sendJson(res, responseStatusForEnvelope(envelope), envelope);
    }
  };
}

export function createParleyHttpServer(options = {}) {
  return http.createServer(createParleyHttpHandler(options));
}

export async function startParleyHttpService(options = {}) {
  const server = createParleyHttpServer(options);
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 7331;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}
