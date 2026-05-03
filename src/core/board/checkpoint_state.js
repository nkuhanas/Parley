import fs from "node:fs/promises";

import { collectParleyPlanV1Phases, parseParleyPlanV1Document } from "../schema/index.js";
import { isHumanGatePhase } from "../plan/plan_state.js";
import { artifactVisibleForDerivedBoardState, planVisibleForDerivedBoardState } from "./source_visibility.js";

function normalizeCheckpoint(raw, frontmatter, artifact) {
  const phaseId = raw.phase_id ?? raw.checkpoint_id;
  const planId = frontmatter.plan_id;
  const artifactVersion = artifact.version ?? frontmatter.version ?? 1;
  return {
    checkpoint_key: `${frontmatter.board_id}:${planId}:${phaseId}:v${artifactVersion}`,
    board_id: frontmatter.board_id,
    plan_id: planId,
    artifact_id: artifact.artifact_id,
    artifact_version: artifactVersion,
    checkpoint_id: phaseId,
    phase_id: phaseId,
    title: raw.title,
    kind: raw.kind ?? "human_checkpoint",
    required_from: raw.required_from ?? "human",
    shepherd: raw.owner ?? raw.shepherd ?? frontmatter.owner,
    trigger: raw.trigger ?? "manual",
    status: raw.status ?? "active",
    requested_decision: raw.requested_decision ?? (raw.kind === "human_approval_gate" ? "approve_or_request_changes" : "review"),
    due_at: raw.due_at ?? null,
    source: {
      artifact_id: artifact.artifact_id,
      artifact_version: artifactVersion,
      uri: artifact.uri,
      resolved_path: artifact.resolved_path
    }
  };
}

function checkpointsFromPlanState(plan, artifact = null) {
  const sourceArtifact = artifact ?? {
    artifact_id: plan.artifact_id,
    version: plan.version,
    uri: plan.landing?.uri,
    resolved_path: plan.landing?.resolved_path
  };
  return (plan.phases ?? []).filter(isHumanGatePhase).map((phase) => normalizeCheckpoint(phase, plan, sourceArtifact));
}

async function readPlanCheckpoints(artifact) {
  if (artifact.kind !== "plan" || artifact.resolved_path == null || !artifactVisibleForDerivedBoardState(artifact)) return [];
  try {
    const markdown = await fs.readFile(artifact.resolved_path, "utf8");
    const parsed = parseParleyPlanV1Document(markdown);
    if (parsed.frontmatter?.schema !== "parley.plan.v1") return [];
    return collectParleyPlanV1Phases(markdown)
      .filter(isHumanGatePhase)
      .map((phase) => normalizeCheckpoint(phase, parsed.frontmatter, artifact));
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
    (obligation.target?.phase_id === checkpoint.phase_id || obligation.target?.checkpoint_id === checkpoint.checkpoint_id)
    && obligation.target?.plan_id === checkpoint.plan_id
    && obligation.target?.artifact_id === checkpoint.artifact_id
    && obligation.target?.artifact_version === checkpoint.artifact_version
  )) ?? null;
}

export async function deriveCheckpointState(_board, artifacts, obligations, plans = []) {
  const checkpoints = [];
  const artifactById = new Map(artifacts.map((artifact) => [artifact.artifact_id, artifact]));
  for (const plan of plans) {
    const artifact = artifactById.get(plan.artifact_id);
    if (!planVisibleForDerivedBoardState(plan, artifact)) continue;
    checkpoints.push(...checkpointsFromPlanState(plan, artifact));
  }
  if (plans.length === 0) for (const artifact of artifacts) checkpoints.push(...await readPlanCheckpoints(artifact));
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
