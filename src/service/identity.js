import { resolveCallerIdentity, resolveCallerBoardMemberships } from "../core/board/board.js";
import { boardIdForRead } from "./context.js";
import { SERVICE_ERROR_CODES, serviceError } from "./errors.js";

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function callerRuntimeRefFromServiceCaller(caller = {}) {
  const explicit = caller.runtime_ref ?? caller.runtimeRef;
  if (explicit != null) return explicit;

  const actorId = nonEmptyString(caller.actor_id ?? caller.actorId);
  if (actorId == null) return null;
  const runtime = nonEmptyString(caller.runtime) ?? "openclaw";
  if (runtime === "openclaw") return { scheme: "openclaw", type: "agent", id: actorId };
  return { scheme: runtime, type: caller.actor_type ?? caller.actorType ?? "agent", id: actorId };
}

export function callerRuntimeAliasesFromServiceCaller(caller = {}) {
  const aliases = caller.runtime_aliases ?? caller.runtimeAliases;
  if (aliases == null) return [];
  if (!Array.isArray(aliases)) {
    throw serviceError(SERVICE_ERROR_CODES.VALIDATION_FAILED, "CallerContext.runtime_aliases must be an array.");
  }
  return aliases;
}

function translateIdentityError(error) {
  const message = error?.message ?? "Caller identity resolution failed.";
  if (/requires boardId|requires board_id/.test(message)) {
    return serviceError(SERVICE_ERROR_CODES.MISSING_BOARD_ID, message, { cause: error });
  }
  if (/board not found/.test(message)) {
    return serviceError(SERVICE_ERROR_CODES.UNKNOWN_BOARD, message, { cause: error });
  }
  if (/not a member of board/.test(message)) {
    return serviceError(SERVICE_ERROR_CODES.MISSING_BOARD_PERMISSION, message, { cause: error });
  }
  if (/resolved ambiguously/.test(message)) {
    return serviceError(SERVICE_ERROR_CODES.AMBIGUOUS_CALLER_IDENTITY, message, { cause: error });
  }
  return error;
}

export function resolveServiceCallerMemberships(pluginConfig, caller) {
  try {
    return resolveCallerBoardMemberships(pluginConfig, {
      callerRuntimeRef: callerRuntimeRefFromServiceCaller(caller),
      runtimeAliases: callerRuntimeAliasesFromServiceCaller(caller)
    });
  } catch (error) {
    throw translateIdentityError(error);
  }
}

export function resolveServiceCallerIdentity(pluginConfig, caller, input = {}) {
  try {
    return resolveCallerIdentity(pluginConfig, {
      callerRuntimeRef: callerRuntimeRefFromServiceCaller(caller),
      runtimeAliases: callerRuntimeAliasesFromServiceCaller(caller),
      boardId: boardIdForRead(input, caller)
    });
  } catch (error) {
    throw translateIdentityError(error);
  }
}
