import { createHash } from "node:crypto";

import { nowIso } from "../time.js";

export const SUPPORTED_CHECKPOINT_PROJECTIONS = Object.freeze(["minimal_board", "where_am_i"]);

function normalizeValue(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeValue(item)])
    );
  }
  return value;
}

function projectionDigest(projection) {
  return createHash("sha256")
    .update(JSON.stringify(normalizeValue(projection)))
    .digest("hex");
}

function flattenNumericCounts(value, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const flattened = {};
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof item === "number" && Number.isFinite(item)) {
      flattened[path] = item;
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      Object.assign(flattened, flattenNumericCounts(item, path));
    }
  }
  return flattened;
}

export function normalizeProjectionType(value = "minimal_board") {
  const projectionType = typeof value === "string" && value.trim() ? value.trim() : "minimal_board";
  if (!SUPPORTED_CHECKPOINT_PROJECTIONS.includes(projectionType)) {
    throw new Error(`projectionType must be one of: ${SUPPORTED_CHECKPOINT_PROJECTIONS.join(", ")}`);
  }
  return projectionType;
}

export function buildProjectionCursor(projectionType, projection) {
  return {
    projection_type: normalizeProjectionType(projectionType),
    projection_digest: projectionDigest(projection),
    counts: projection?.counts && typeof projection.counts === "object" ? normalizeValue(projection.counts) : {},
    generated_at: nowIso()
  };
}

export function compareProjectionCursors(previousCursor, currentCursor) {
  const previousCounts = flattenNumericCounts(previousCursor?.counts ?? {});
  const currentCounts = flattenNumericCounts(currentCursor?.counts ?? {});
  const countKeys = [...new Set([...Object.keys(previousCounts), ...Object.keys(currentCounts)])].sort();
  const count_deltas = {};
  for (const key of countKeys) {
    const before = previousCounts[key] ?? 0;
    const after = currentCounts[key] ?? 0;
    if (before !== after) {
      count_deltas[key] = { before, after, delta: after - before };
    }
  }

  return {
    has_previous: previousCursor != null,
    changed: previousCursor?.projection_digest !== currentCursor.projection_digest,
    count_deltas
  };
}
