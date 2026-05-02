import fs from "node:fs/promises";

import { compareEffectRecords } from "./effect_ordering.js";
import { collectParleyPlanV1DeferredPhases, parseParleyPlanV1Document } from "./schemas/index.js";

const ACTIVATION_EFFECT_TYPES = new Set(["activation_proposed", "activation_candidate_dismissed"]);
const ACTIVE_CANDIDATE_STATUSES = new Set(["candidate", "proposed"]);

function candidateKey(boardId, planId, phaseId, artifactVersion) {
  return `${boardId}:${planId}:${phaseId}:v${artifactVersion}`;
}

function normalizeArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

async function readPlanArtifact(artifact) {
  if (artifact.kind !== "plan" || artifact.resolved_path == null) return null;
  try {
    const markdown = await fs.readFile(artifact.resolved_path, "utf8");
    const parsed = parseParleyPlanV1Document(markdown);
    if (parsed.frontmatter?.schema !== "parley.plan.v1") return null;
    return { markdown, frontmatter: parsed.frontmatter };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return null;
  }
}

function deferredPhaseRecord(board, artifact, frontmatter, phase) {
  const planId = frontmatter.plan_id;
  const artifactVersion = artifact.version ?? frontmatter.version ?? 1;
  const key = candidateKey(board.board_id, planId, phase.phase_id, artifactVersion);
  return {
    candidate_key: key,
    board_id: board.board_id,
    plan_id: planId,
    phase_id: phase.phase_id,
    artifact_id: artifact.artifact_id,
    artifact_version: artifactVersion,
    plan_title: frontmatter.title ?? artifact.title ?? null,
    phase_title: phase.title,
    status: "deferred_visible",
    attention_owner: phase.owner ?? frontmatter.owner ?? null,
    review_required_from: normalizeArray(frontmatter.review?.required_reviewers),
    owner: phase.owner ?? null,
    evidence: [],
    phase,
    source: {
      artifact_id: artifact.artifact_id,
      artifact_version: artifactVersion,
      uri: artifact.uri,
      resolved_path: artifact.resolved_path
    }
  };
}

function effectCandidateKey(boardId, effect) {
  const target = effect.target ?? {};
  if (target.plan_id == null || target.phase_id == null || target.artifact_version == null) return null;
  return candidateKey(boardId, target.plan_id, target.phase_id, target.artifact_version);
}

function proposalEvidence(effect) {
  const evidence = Array.isArray(effect.payload?.evidence) ? effect.payload.evidence : [];
  if (evidence.length > 0) return evidence;
  return [{ type: "manual_proposal", source_effect_id: effect.effect_id, confidence: "proposed_not_verified" }];
}

function applyActivationEffects(board, deferredPhases, effects) {
  const byKey = new Map(deferredPhases.map((phase) => [phase.candidate_key, { ...phase }]));
  const effectsByKey = new Map();
  for (const effect of effects.filter((candidate) => ACTIVATION_EFFECT_TYPES.has(candidate.type))) {
    const key = effectCandidateKey(board.board_id, effect);
    if (key == null) continue;
    const list = effectsByKey.get(key) ?? [];
    list.push(effect);
    effectsByKey.set(key, list);
  }

  for (const [key, keyEffects] of effectsByKey.entries()) {
    const base = byKey.get(key);
    if (base == null) continue;
    keyEffects.sort(compareEffectRecords);
    const latest = keyEffects[keyEffects.length - 1];
    const proposalEffects = keyEffects.filter((effect) => effect.type === "activation_proposed");
    const dismissalEffects = keyEffects.filter((effect) => effect.type === "activation_candidate_dismissed");
    const latestProposal = proposalEffects[proposalEffects.length - 1] ?? null;

    const reviewRequiredFrom = normalizeArray(latestProposal?.payload?.review_required_from)
      .concat(normalizeArray(latestProposal?.target?.review_required_from));
    const attentionOwner = latestProposal?.payload?.attention_owner ?? latestProposal?.target?.attention_owner ?? base.attention_owner;

    byKey.set(key, {
      ...base,
      status: latest.type === "activation_candidate_dismissed" ? "dismissed" : "proposed",
      attention_owner: attentionOwner,
      review_required_from: reviewRequiredFrom.length > 0 ? [...new Set(reviewRequiredFrom)] : base.review_required_from,
      evidence: latest.type === "activation_candidate_dismissed"
        ? [{ type: "dismissal", source_effect_id: latest.effect_id, reason: latest.payload?.reason ?? null }]
        : proposalEvidence(latest),
      source_effect_ids: keyEffects.map((effect) => effect.effect_id),
      proposed_by: latestProposal?.actor?.board_agent_id ?? null,
      last_changed_at: latest.created_at,
      last_effect_id: latest.effect_id,
      dismissal: dismissalEffects.length > 0 ? dismissalEffects[dismissalEffects.length - 1] : null
    });
  }

  const allDeferred = [...byKey.values()].sort((a, b) => a.candidate_key.localeCompare(b.candidate_key));
  const activationCandidates = allDeferred.filter((phase) => ["candidate", "proposed", "dismissed", "superseded"].includes(phase.status));
  return { deferred_phases: allDeferred, activation_candidates: activationCandidates };
}

function countBy(records, fieldName) {
  const counts = {};
  for (const record of records) {
    const key = record[fieldName] ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export async function deriveActivationState(board, artifacts, effects) {
  const deferredPhases = [];
  for (const artifact of artifacts) {
    const plan = await readPlanArtifact(artifact);
    if (plan == null) continue;
    for (const phase of collectParleyPlanV1DeferredPhases(plan.markdown)) {
      deferredPhases.push(deferredPhaseRecord(board, artifact, plan.frontmatter, phase));
    }
  }

  const { deferred_phases, activation_candidates } = applyActivationEffects(board, deferredPhases, effects);
  return {
    deferred_phases,
    activation_candidates,
    counts: {
      deferred_phases: deferred_phases.length,
      activation_candidates: activation_candidates.length,
      by_status: countBy(deferred_phases, "status"),
      candidates_by_status: countBy(activation_candidates, "status")
    },
    non_executing: true
  };
}

export function activationCandidatesForAgent(activationState, boardAgentId) {
  return activationState.activation_candidates.filter((candidate) => (
    ACTIVE_CANDIDATE_STATUSES.has(candidate.status)
    && (
      candidate.attention_owner === boardAgentId
      || candidate.proposed_by === boardAgentId
      || candidate.review_required_from.includes(boardAgentId)
    )
  ));
}

export function deferredPhasesForAgent(activationState, boardAgentId) {
  const candidateKeys = new Set(activationState.activation_candidates.map((candidate) => candidate.candidate_key));
  return activationState.deferred_phases.filter((phase) => phase.attention_owner === boardAgentId && !candidateKeys.has(phase.candidate_key));
}
