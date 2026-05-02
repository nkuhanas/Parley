import fs from "node:fs/promises";

import { parseParleyPlanV1Document } from "../schema/index.js";

function normalizeCheckpoint(raw, frontmatter, artifact) {
  const checkpoint = typeof raw === "string"
    ? { checkpoint_id: raw, title: raw }
    : raw;
  const planId = frontmatter.plan_id;
  const artifactVersion = artifact.version ?? frontmatter.version ?? 1;
  return {
    checkpoint_key: `${frontmatter.board_id}:${planId}:${checkpoint.checkpoint_id}:v${artifactVersion}`,
    board_id: frontmatter.board_id,
    plan_id: planId,
    artifact_id: artifact.artifact_id,
    artifact_version: artifactVersion,
    checkpoint_id: checkpoint.checkpoint_id,
    title: checkpoint.title,
    kind: checkpoint.kind ?? "review",
    required_from: checkpoint.required_from ?? "human",
    shepherd: checkpoint.shepherd ?? frontmatter.owner,
    trigger: checkpoint.trigger ?? "plan_created",
    status: checkpoint.status ?? "pending",
    requested_decision: checkpoint.requested_decision ?? "review",
    due_at: checkpoint.due_at ?? null,
    source: {
      artifact_id: artifact.artifact_id,
      artifact_version: artifactVersion,
      uri: artifact.uri,
      resolved_path: artifact.resolved_path
    }
  };
}

async function readPlanCheckpoints(artifact) {
  if (artifact.kind !== "plan" || artifact.resolved_path == null) return [];
  try {
    const markdown = await fs.readFile(artifact.resolved_path, "utf8");
    const parsed = parseParleyPlanV1Document(markdown);
    if (parsed.frontmatter?.schema !== "parley.plan.v1") return [];
    const checkpoints = parsed.frontmatter.human_checkpoints ?? [];
    if (!Array.isArray(checkpoints)) return [];
    return checkpoints.map((checkpoint) => normalizeCheckpoint(checkpoint, parsed.frontmatter, artifact));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    return [];
  }
}

function countBy(records, fieldName) {
  const counts = {};
  for (const record of records) {
    const key = record[fieldName] ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function matchingObligation(checkpoint, obligations) {
  return obligations.find((obligation) => (
    obligation.target?.checkpoint_id === checkpoint.checkpoint_id
    && obligation.target?.plan_id === checkpoint.plan_id
    && obligation.target?.artifact_id === checkpoint.artifact_id
    && obligation.target?.artifact_version === checkpoint.artifact_version
  )) ?? null;
}

export async function deriveCheckpointState(_board, artifacts, obligations) {
  const checkpoints = [];
  for (const artifact of artifacts) checkpoints.push(...await readPlanCheckpoints(artifact));
  const enriched = checkpoints.map((checkpoint) => {
    const obligation = matchingObligation(checkpoint, obligations);
    return {
      ...checkpoint,
      obligation_id: obligation?.obligation_id ?? null,
      obligation_status: obligation?.status ?? null,
      active_obligation: obligation != null && !["resolved", "cancelled", "superseded"].includes(obligation.status)
    };
  }).sort((a, b) => a.checkpoint_key.localeCompare(b.checkpoint_key));
  return {
    human_checkpoints: enriched,
    counts: {
      human_checkpoints: enriched.length,
      active_human_checkpoint_obligations: enriched.filter((checkpoint) => checkpoint.active_obligation).length,
      by_status: countBy(enriched, "status"),
      by_shepherd: countBy(enriched, "shepherd"),
      by_obligation_status: countBy(enriched, "obligation_status")
    }
  };
}

export function humanCheckpointsForShepherd(checkpointState, boardAgentId) {
  return checkpointState.human_checkpoints.filter((checkpoint) => checkpoint.shepherd === boardAgentId && checkpoint.active_obligation);
}
