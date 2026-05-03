const INACTIVE_DERIVED_STATE_SOURCE_STATUSES = new Set(["archived", "cancelled", "complete", "superseded"]);

function isInactiveDerivedStateSource(record) {
  return record != null && INACTIVE_DERIVED_STATE_SOURCE_STATUSES.has(record.status);
}

export function artifactVisibleForDerivedBoardState(artifact) {
  return artifact != null && !isInactiveDerivedStateSource(artifact);
}

export function planVisibleForDerivedBoardState(plan, artifact = null) {
  return !isInactiveDerivedStateSource(plan) && !isInactiveDerivedStateSource(artifact);
}
