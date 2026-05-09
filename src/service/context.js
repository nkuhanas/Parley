import { SERVICE_ERROR_CODES, serviceError } from "./errors.js";

const ACTOR_TYPES = new Set(["agent", "human", "service"]);

function optionalString(value) {
  if (value == null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function stringArray(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) return [String(value).trim()].filter(Boolean);
  return value.map((item) => String(item).trim()).filter(Boolean);
}

export function normalizeCallerContext(raw = {}) {
  const actorId = optionalString(raw.actor_id ?? raw.actorId);
  const actorType = optionalString(raw.actor_type ?? raw.actorType) ?? "agent";
  if (actorId == null) {
    throw serviceError(
      SERVICE_ERROR_CODES.AMBIGUOUS_CALLER_IDENTITY,
      "CallerContext.actor_id is required."
    );
  }
  if (!ACTOR_TYPES.has(actorType)) {
    throw serviceError(
      SERVICE_ERROR_CODES.VALIDATION_FAILED,
      `CallerContext.actor_type must be one of: ${[...ACTOR_TYPES].join(", ")}.`
    );
  }
  return {
    actor_id: actorId,
    actor_type: actorType,
    runtime: optionalString(raw.runtime),
    runtime_ref: raw.runtime_ref ?? raw.runtimeRef,
    runtime_aliases: raw.runtime_aliases ?? raw.runtimeAliases,
    board_id: optionalString(raw.board_id ?? raw.boardId),
    request_id: optionalString(raw.request_id ?? raw.requestId),
    capabilities: stringArray(raw.capabilities)
  };
}

export function requireMutationCaller(caller) {
  const normalized = normalizeCallerContext(caller);
  if (normalized.actor_id == null) {
    throw serviceError(
      SERVICE_ERROR_CODES.ANONYMOUS_MUTATION_REJECTED,
      "Mutations require a non-anonymous caller."
    );
  }
  return normalized;
}

export function explicitBoardId(input = {}) {
  return optionalString(input.board_id ?? input.boardId);
}

export function boardIdForRead(input = {}, caller = {}) {
  const callerContext = normalizeCallerContext(caller);
  return explicitBoardId(input) ?? callerContext.board_id;
}

export function requireBoardIdForRead(input = {}, caller = {}) {
  const boardId = boardIdForRead(input, caller);
  if (boardId == null) {
    throw serviceError(
      SERVICE_ERROR_CODES.MISSING_BOARD_ID,
      "Query requires board_id in input or CallerContext.board_id."
    );
  }
  return boardId;
}

export function requireExplicitBoardIdForMutation(input = {}, caller = {}) {
  requireMutationCaller(caller);
  const boardId = explicitBoardId(input);
  if (boardId == null) {
    throw serviceError(
      SERVICE_ERROR_CODES.MISSING_BOARD_ID,
      "Mutation requires explicit input.board_id; CallerContext.board_id is read-default context only."
    );
  }
  return boardId;
}

export function normalizeServiceRequest(request = {}) {
  return {
    caller: normalizeCallerContext(request.caller),
    input: request.input && typeof request.input === "object" && !Array.isArray(request.input) ? request.input : {}
  };
}
