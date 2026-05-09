import { normalizeServiceError } from "./errors.js";

const STATUSES = new Set(["ok", "blocked", "needs_review", "error"]);

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => {
    if (entry == null) return false;
    if (Array.isArray(entry) && entry.length === 0) return false;
    return true;
  }));
}

function normalizeStatus(status) {
  return STATUSES.has(status) ? status : "error";
}

export function serviceResponse({ status = "ok", code, message, data, summary, next_actions, warnings, diagnostics } = {}) {
  return compactObject({
    status: normalizeStatus(status),
    code,
    message,
    data,
    summary,
    next_actions,
    warnings,
    diagnostics
  });
}

export function mutationResponse({ status = "ok", code, message, ids, artifact_ref, artifact_path, artifact_version, summary, effects_recorded, obligations_created, obligations_resolved, next_actions, warnings, diagnostics } = {}) {
  return compactObject({
    status: normalizeStatus(status),
    code,
    message,
    ids,
    artifact_ref,
    artifact_path,
    artifact_version,
    summary,
    effects_recorded,
    obligations_created,
    obligations_resolved,
    next_actions,
    warnings,
    diagnostics
  });
}

export function queryResponse({ status = "ok", code, message, data, summary, cursor, next_actions, warnings, diagnostics } = {}) {
  return compactObject({
    // Query responses do not use needs_review; surface review state in data or next_actions.
    status: status === "needs_review" ? "ok" : normalizeStatus(status),
    code,
    message,
    data,
    summary,
    cursor,
    next_actions,
    warnings,
    diagnostics
  });
}

export function artifactHandle(artifact = {}, role = undefined) {
  return compactObject({
    artifact_id: artifact.artifact_id ?? artifact.artifactId,
    artifact_ref: artifact.artifact_ref ?? artifact.artifactRef ?? artifact.uri,
    artifact_path: artifact.artifact_path ?? artifact.artifactPath ?? artifact.resolved_path,
    artifact_version: artifact.artifact_version ?? artifact.artifactVersion ?? artifact.version,
    role
  });
}

export function artifactReadResponse({ status = "ok", code, message, artifact = {}, include_body = false, body, body_truncated, summary, diagnostics } = {}) {
  const handle = artifactHandle(artifact);
  return compactObject({
    // Artifact reads are queries; review state belongs in data/summary, not response status.
    status: status === "needs_review" ? "ok" : normalizeStatus(status),
    code,
    message,
    artifact_id: handle.artifact_id,
    artifact_ref: handle.artifact_ref,
    artifact_path: handle.artifact_path,
    artifact_version: handle.artifact_version,
    title: artifact.title,
    kind: artifact.kind,
    content_hash: artifact.content_hash ?? artifact.contentHash,
    body: include_body ? body : undefined,
    body_truncated: include_body ? Boolean(body_truncated) : undefined,
    summary,
    diagnostics
  });
}

export function errorResponse(error, diagnostics = undefined) {
  const normalized = normalizeServiceError(error);
  return serviceResponse({
    status: normalized.status,
    code: normalized.code,
    message: normalized.message,
    diagnostics: diagnostics ?? normalized.diagnostics
  });
}
