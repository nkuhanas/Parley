export const SERVICE_ERROR_CODES = Object.freeze({
  MISSING_BOARD_ID: "MISSING_BOARD_ID",
  UNKNOWN_BOARD: "UNKNOWN_BOARD",
  MISSING_BOARD_PERMISSION: "MISSING_BOARD_PERMISSION",
  AMBIGUOUS_CALLER_IDENTITY: "AMBIGUOUS_CALLER_IDENTITY",
  ANONYMOUS_MUTATION_REJECTED: "ANONYMOUS_MUTATION_REJECTED",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  PLAN_NOT_FOUND: "PLAN_NOT_FOUND",
  ARTIFACT_NOT_FOUND: "ARTIFACT_NOT_FOUND",
  OBLIGATION_NOT_FOUND: "OBLIGATION_NOT_FOUND",
  INVALID_LIFECYCLE_STATUS: "INVALID_LIFECYCLE_STATUS",
  CONFLICTING_STATE: "CONFLICTING_STATE",
  UNSUPPORTED_ACTION: "UNSUPPORTED_ACTION",
  INTERNAL_ERROR: "INTERNAL_ERROR"
});

export class ParleyServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "ParleyServiceError";
    this.code = code ?? SERVICE_ERROR_CODES.INTERNAL_ERROR;
    this.status = options.status ?? "error";
    this.diagnostics = options.diagnostics ?? undefined;
    this.cause = options.cause;
  }
}

export function isParleyServiceError(error) {
  return error instanceof ParleyServiceError;
}

export function serviceError(code, message, options = {}) {
  return new ParleyServiceError(code, message, options);
}

export function normalizeServiceError(error, fallbackMessage = "Parley service call failed.") {
  if (isParleyServiceError(error)) return error;
  return new ParleyServiceError(
    SERVICE_ERROR_CODES.INTERNAL_ERROR,
    error?.message || fallbackMessage,
    { cause: error }
  );
}
