import { compareEffectRecords } from "../effect_ordering.js";

const UNSPECIFIED_SCOPE = "unspecified";

function effectActorId(effect) {
  return effect?.actor?.board_agent_id ?? effect?.actor?.runtime_ref?.id ?? "unknown";
}

function firstValue(...values) {
  for (const value of values) {
    if (value != null) return value;
  }
  return null;
}

function normalizePositiveInteger(value) {
  if (Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (parsed > 0) return parsed;
  }
  return null;
}

function approvalTarget(effect) {
  const target = effect?.target ?? {};
  const payload = effect?.payload ?? {};
  const artifactId = firstValue(target.artifact_id, payload.artifact_id);
  if (typeof artifactId !== "string" || !artifactId.trim()) return null;
  const artifactVersion = normalizePositiveInteger(firstValue(
    target.artifact_version,
    target.version,
    payload.artifact_version,
    payload.version
  ));
  if (artifactVersion == null) return null;
  return {
    artifact_id: artifactId.trim(),
    artifact_version: artifactVersion,
    scope: String(firstValue(target.scope, target.authority_scope, payload.scope, payload.authority_scope, UNSPECIFIED_SCOPE)).trim() || UNSPECIFIED_SCOPE,
    section_path: firstValue(target.section_path, target.path, payload.section_path, payload.path),
    approver: String(firstValue(payload.approver, target.approver, effectActorId(effect))).trim() || "unknown",
    carry_forward_from_version: normalizePositiveInteger(firstValue(
      payload.carry_forward_from_version,
      payload.carried_forward_from_version,
      target.carry_forward_from_version,
      target.carried_forward_from_version
    ))
  };
}

function approvalKey(parts) {
  return [
    parts.artifact_id,
    parts.artifact_version,
    parts.scope,
    parts.section_path ?? "",
    parts.approver
  ].join("\u0000");
}

function carryForwardKey(parts, fromVersion) {
  return [
    parts.artifact_id,
    fromVersion,
    parts.scope,
    parts.section_path ?? "",
    parts.approver
  ].join("\u0000");
}

function countBy(records, fieldName) {
  const counts = {};
  for (const record of records) {
    const key = record[fieldName] ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function currentArtifactVersions(artifacts) {
  const versions = {};
  for (const artifact of artifacts) {
    const previous = versions[artifact.artifact_id];
    if (previous == null || artifact.version > previous.version) {
      versions[artifact.artifact_id] = {
        version: artifact.version,
        status: artifact.status,
        content_hash: artifact.content_hash ?? null,
        artifact
      };
    }
  }
  return versions;
}

export function deriveApprovalState(artifacts, effects) {
  const currentVersions = currentArtifactVersions(artifacts);
  const sortedEffects = [...effects].sort(compareEffectRecords);
  const approvalsByKey = new Map();
  const carryForwardByPriorKey = new Map();
  const ignoredEffects = [];

  for (const effect of sortedEffects) {
    if (effect.type !== "approval_recorded" && effect.type !== "approval_withdrawn") continue;
    const target = approvalTarget(effect);
    if (target == null) {
      ignoredEffects.push({ effect_id: effect.effect_id, type: effect.type, reason: "missing artifact_id, artifact_version, or scope target" });
      continue;
    }

    if (effect.type === "approval_recorded") {
      const approval = {
        approval_effect_id: effect.effect_id,
        artifact_id: target.artifact_id,
        artifact_version: target.artifact_version,
        scope: target.scope,
        section_path: target.section_path ?? null,
        approver: target.approver,
        status: "active",
        source_thread_id: effect.source_thread_id ?? null,
        source_message_id: effect.source_message_id ?? null,
        recorded_at: effect.created_at,
        carry_forward_from_version: target.carry_forward_from_version,
        current_artifact_version: currentVersions[target.artifact_id]?.version ?? null
      };
      approvalsByKey.set(approvalKey(target), approval);
      if (target.carry_forward_from_version != null) {
        carryForwardByPriorKey.set(carryForwardKey(target, target.carry_forward_from_version), approval);
      }
      continue;
    }

    const existing = approvalsByKey.get(approvalKey(target));
    if (existing) {
      existing.status = "withdrawn";
      existing.withdrawn_effect_id = effect.effect_id;
      existing.withdrawn_at = effect.created_at;
    }
  }

  const approvals = [...approvalsByKey.values()].sort((a, b) => {
    const recordedAt = a.recorded_at.localeCompare(b.recorded_at);
    if (recordedAt !== 0) return recordedAt;
    return a.approval_effect_id.localeCompare(b.approval_effect_id);
  });
  for (const approval of approvals) {
    if (approval.status === "withdrawn") continue;
    const current = currentVersions[approval.artifact_id];
    if (current == null) continue;
    approval.current_artifact_version = current.version;
    if (approval.artifact_version < current.version) {
      const carriedForward = carryForwardByPriorKey.get(carryForwardKey(approval, approval.artifact_version));
      if (carriedForward != null && carriedForward.artifact_version <= current.version) {
        approval.status = "carried_forward";
        approval.carry_forward_to_version = carriedForward.artifact_version;
        approval.carry_forward_effect_id = carriedForward.approval_effect_id;
      } else {
        approval.status = "stale";
        approval.stale_reason = "artifact_version_changed";
      }
    }
  }

  return {
    approvals,
    ignored_effects: ignoredEffects,
    counts: {
      approvals: approvals.length,
      by_status: countBy(approvals, "status"),
      by_scope: countBy(approvals, "scope"),
      by_approver: countBy(approvals, "approver")
    }
  };
}
