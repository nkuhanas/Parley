import { activationCandidatesForAgent, deferredPhasesForAgent, deriveActivationState } from "../../../core/board/activation_state.js";
import { deriveApprovalState } from "../../../core/board/approval_state.js";
import { deriveCheckpointState, humanCheckpointsForShepherd } from "../../../core/board/checkpoint_state.js";
import {
  listArtifactRecords,
  listEffectRecords,
  listObligationRecords,
  listPlanSetupRecords,
  loadArtifactRecord,
  loadCoordinationObjectRecord,
  loadEffectRecord
} from "../../../core/storage/board_store.js";
import { runtimeObligationsForCaller } from "./obligations.js";
import { decorateBoardObligationItem, obligationPrioritySummary, sortBoardObligationItemsByPriority } from "./obligation_priority.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

const ACTIVE_STATUSES = new Set(["active", "blocking", "waiting", "deferred"]);
const TERMINAL_STATUSES = new Set(["resolved", "cancelled", "superseded"]);
const WHERE_AM_I_VERBOSITIES = Object.freeze(["compact", "full"]);

function normalizeVerbosity(value) {
  if (value == null) return "compact";
  if (typeof value !== "string" || !value.trim()) throw new Error("verbosity must be compact or full");
  const normalized = value.trim();
  if (!WHERE_AM_I_VERBOSITIES.includes(normalized)) throw new Error("verbosity must be compact or full");
  return normalized;
}

function compactRuntimeIdentity(identity) {
  return {
    global_agent_id: identity.global_agent_id,
    display_name: identity.display_name,
    kind: identity.kind,
    default_board: identity.default_board
  };
}

function compactBoardIdentity(identity) {
  return {
    board_id: identity.board_id,
    board_agent_id: identity.board_agent_id,
    roles: identity.membership?.roles ?? [],
    permissions: identity.membership?.permissions ?? null
  };
}

function compactTarget(target = {}) {
  const out = {};
  for (const key of ["kind", "thread_id", "message_id", "object_id", "artifact_id", "artifact_version", "plan_id", "phase_id", "relationship_id", "checkpoint_id", "obligation_id"]) {
    if (target[key] != null) out[key] = target[key];
  }
  return out;
}

function compactRuntimeObligation(obligation) {
  return {
    obligation_id: obligation.obligation_id,
    type: obligation.type,
    status: obligation.status,
    priority: obligation.priority,
    agent: obligation.agent,
    target: compactTarget(obligation.target),
    reason: obligation.reason
  };
}

function compactBoardObligation(item) {
  const obligation = item.obligation;
  return {
    obligation_id: obligation.obligation_id,
    type: obligation.type,
    status: obligation.status,
    priority: obligation.priority,
    agent: obligation.agent,
    scope: obligation.scope ?? null,
    target: compactTarget(obligation.target),
    reason: obligation.reason ?? null,
    source_refs: item.source_refs,
    object: item.object == null ? null : {
      object_id: item.object.object_id,
      kind: item.object.kind,
      title: item.object.title,
      status: item.object.status
    },
    artifact: item.artifact == null ? null : {
      artifact_id: item.artifact.artifact_id,
      kind: item.artifact.kind,
      title: item.artifact.title,
      status: item.artifact.status,
      uri: item.artifact.uri,
      version: item.artifact.version
    }
  };
}

function compactApproval(approval) {
  return {
    approval_id: approval.approval_id ?? null,
    status: approval.status,
    approver: approval.approver,
    scope: approval.scope ?? null,
    artifact_id: approval.artifact_id ?? approval.target?.artifact_id ?? null,
    artifact_version: approval.artifact_version ?? approval.target?.artifact_version ?? null,
    reason: approval.reason ?? null
  };
}

function compactActivationCandidate(candidate) {
  return {
    candidate_key: candidate.candidate_key,
    board_id: candidate.board_id,
    plan_id: candidate.plan_id,
    phase_id: candidate.phase_id,
    artifact_id: candidate.artifact_id,
    artifact_version: candidate.artifact_version,
    plan_title: candidate.plan_title,
    phase_title: candidate.phase_title,
    status: candidate.status,
    attention_owner: candidate.attention_owner,
    review_required_from: candidate.review_required_from ?? [],
    proposed_by: candidate.proposed_by ?? null,
    evidence_count: Array.isArray(candidate.evidence) ? candidate.evidence.length : 0,
    source: candidate.source == null ? null : {
      artifact_id: candidate.source.artifact_id,
      artifact_version: candidate.source.artifact_version,
      uri: candidate.source.uri
    }
  };
}

function compactDeferredPhase(candidate) {
  const phase = candidate.phase ?? {};
  return {
    plan_id: candidate.plan_id,
    phase_id: candidate.phase_id,
    phase_title: candidate.phase_title,
    status: candidate.status,
    owner: candidate.owner ?? phase.owner ?? null,
    attention_owner: candidate.attention_owner ?? null,
    review_required_from: candidate.review_required_from ?? [],
    activation_condition_count: Array.isArray(phase.activation_conditions) ? phase.activation_conditions.length : 0,
    review_trigger_count: Array.isArray(phase.review_trigger) ? phase.review_trigger.length : 0,
    deferral_reason_count: Array.isArray(phase.deferral_reason) ? phase.deferral_reason.length : 0
  };
}

function compactHumanCheckpoint(checkpoint) {
  return {
    checkpoint_id: checkpoint.checkpoint_id,
    title: checkpoint.title,
    kind: checkpoint.kind,
    status: checkpoint.status,
    required_from: checkpoint.required_from,
    shepherd: checkpoint.shepherd,
    trigger: checkpoint.trigger,
    requested_decision: checkpoint.requested_decision,
    artifact_id: checkpoint.artifact_id,
    artifact_version: checkpoint.artifact_version,
    plan_id: checkpoint.plan_id,
    obligation_id: checkpoint.obligation_id ?? null
  };
}

function compactBoardProjection(projection) {
  const blocking = projection.blocking_obligations.map(compactBoardObligation);
  const active = projection.active_obligations.map(compactBoardObligation);
  const waiting = projection.waiting_obligations.map(compactBoardObligation);
  const deferred = projection.deferred_obligations.map(compactBoardObligation);
  const other = projection.other_visible_obligations.map(compactBoardObligation);
  const activationCandidates = projection.activation_candidates_needing_attention.map(compactActivationCandidate);
  const activationProposals = projection.activation_proposals_you_made.map(compactActivationCandidate);
  const deferredPhases = projection.deferred_phases_owned_not_actionable.map(compactDeferredPhase);
  const humanCheckpoints = projection.human_checkpoints_to_shepherd.map(compactHumanCheckpoint);
  return {
    board_id: projection.board_id,
    board_agent_id: projection.board_agent_id,
    counts: projection.counts,
    blocking_obligations: blocking,
    active_obligations: active,
    waiting_obligations: waiting,
    deferred_obligations: deferred,
    other_visible_obligations: other,
    stale_approvals: projection.stale_approvals.map(compactApproval),
    activation_candidates_needing_attention: activationCandidates,
    activation_proposals_you_made: activationProposals,
    deferred_phases_owned_not_actionable: deferredPhases,
    human_checkpoints_to_shepherd: humanCheckpoints,
    next_actions: boardNextActions({ blocking, active, waiting, deferred, activationCandidates, humanCheckpoints, deferredPhases, projection })
  };
}

function boardProjectionObligations(projection) {
  return [
    ...(projection?.blocking_obligations ?? []),
    ...(projection?.active_obligations ?? []),
    ...(projection?.waiting_obligations ?? []),
    ...(projection?.deferred_obligations ?? []),
    ...(projection?.other_visible_obligations ?? [])
  ]
    .map((item) => item.obligation ?? item)
    .filter((obligation) => !TERMINAL_STATUSES.has(obligation?.status));
}

function buildObligationSummary(runtimeObligations, boardProjection = null) {
  const runtimeSummary = obligationPrioritySummary(runtimeObligations);
  const boardObligations = boardProjection == null ? [] : boardProjectionObligations(boardProjection);
  const boardSummary = obligationPrioritySummary(boardObligations);
  return {
    runtime: {
      needs_action: runtimeObligations.length,
      highest_priority: runtimeSummary.highest_priority
    },
    board: boardProjection == null ? undefined : {
      needs_action: boardObligations.length,
      highest_priority: boardSummary.highest_priority
    }
  };
}

function boardNextActions({ blocking, active, waiting, deferred, activationCandidates, humanCheckpoints, deferredPhases, projection }) {
  const actions = [];
  if (blocking.length > 0) actions.push(`Handle ${blocking.length} blocking board obligation(s).`);
  if (active.length > 0) actions.push(`Handle ${active.length} active board obligation(s).`);
  if (waiting.length > 0) actions.push(`Check ${waiting.length} waiting board obligation(s) if you have new input.`);
  if (deferred.length > 0) actions.push(`${deferred.length} deferred obligation(s) are visible but not immediately actionable.`);
  if (activationCandidates.length > 0) actions.push(`Review ${activationCandidates.length} activation candidate(s) needing your attention.`);
  if (humanCheckpoints.length > 0) actions.push(`Shepherd ${humanCheckpoints.length} human checkpoint(s).`);
  if (actions.length === 0) actions.push(`No active board obligations for ${projection.board_agent_id}.`);
  if (deferredPhases.length > 0) actions.push(`${deferredPhases.length} owned deferred phase(s) are visible for awareness only; use verbosity: "full" for complete phase details.`);
  return actions;
}

async function enrichObligation(pluginConfig, board, obligation) {
  const sourceEffect = obligation.source_effect_id == null ? null : await loadEffectRecord(pluginConfig, board, obligation.source_effect_id);
  const objectId = obligation.target?.object_id ?? sourceEffect?.target?.object_id ?? null;
  const artifactId = obligation.target?.artifact_id ?? sourceEffect?.target?.artifact_id ?? null;
  const object = objectId == null ? null : await loadCoordinationObjectRecord(pluginConfig, board, objectId);
  const artifact = artifactId == null ? null : await loadArtifactRecord(pluginConfig, board, artifactId);
  return {
    obligation,
    source_effect: sourceEffect,
    object,
    artifact,
    source_refs: {
      source_effect_id: obligation.source_effect_id ?? null,
      source_thread_id: sourceEffect?.source_thread_id ?? null,
      source_message_id: sourceEffect?.source_message_id ?? null,
      object_id: objectId,
      artifact_id: artifactId
    }
  };
}

async function boardWhereAmIProjection(api, identity, params) {
  const [obligations, artifacts, effects, plans] = await Promise.all([
    listObligationRecords(api.pluginConfig, identity.board),
    listArtifactRecords(api.pluginConfig, identity.board),
    listEffectRecords(api.pluginConfig, identity.board),
    listPlanSetupRecords(api.pluginConfig, identity.board)
  ]);
  const assigned = obligations.filter((obligation) => obligation.agent === identity.board_agent_id);
  const approvalState = deriveApprovalState(artifacts, effects);
  const activationState = await deriveActivationState(identity.board, artifacts, effects, plans);
  const checkpointState = await deriveCheckpointState(identity.board, artifacts, obligations, plans);
  const staleApprovals = approvalState.approvals.filter((approval) => approval.approver === identity.board_agent_id && approval.status === "stale");
  const activationCandidates = activationCandidatesForAgent(activationState, identity.board_agent_id);
  const deferredPhases = deferredPhasesForAgent(activationState, identity.board_agent_id);
  const humanCheckpoints = humanCheckpointsForShepherd(checkpointState, identity.board_agent_id);
  const visible = params?.includeTerminal === true
    ? assigned
    : assigned.filter((obligation) => !TERMINAL_STATUSES.has(obligation.status));
  const enriched = [];
  for (const obligation of visible) {
    enriched.push(await enrichObligation(api.pluginConfig, identity.board, obligation));
  }
  const triaged = sortBoardObligationItemsByPriority(enriched.map(decorateBoardObligationItem));
  return {
    board_id: identity.board_id,
    board_agent_id: identity.board_agent_id,
    blocking_obligations: triaged.filter((item) => item.obligation.status === "blocking"),
    active_obligations: triaged.filter((item) => item.obligation.status === "active"),
    waiting_obligations: triaged.filter((item) => item.obligation.status === "waiting"),
    deferred_obligations: triaged.filter((item) => item.obligation.status === "deferred"),
    other_visible_obligations: triaged.filter((item) => !ACTIVE_STATUSES.has(item.obligation.status)),
    stale_approvals: staleApprovals,
    activation_candidates_needing_attention: activationCandidates.filter((candidate) => candidate.review_required_from.includes(identity.board_agent_id) || candidate.attention_owner === identity.board_agent_id),
    activation_proposals_you_made: activationCandidates.filter((candidate) => candidate.proposed_by === identity.board_agent_id),
    deferred_phases_owned_not_actionable: deferredPhases,
    human_checkpoints_to_shepherd: humanCheckpoints,
    counts: {
      assigned: assigned.length,
      visible: triaged.length,
      blocking: triaged.filter((item) => item.obligation.status === "blocking").length,
      active: triaged.filter((item) => item.obligation.status === "active").length,
      waiting: triaged.filter((item) => item.obligation.status === "waiting").length,
      deferred: triaged.filter((item) => item.obligation.status === "deferred").length,
      stale_approvals: staleApprovals.length,
      activation_candidates: activationCandidates.length,
      deferred_phases_owned_not_actionable: deferredPhases.length,
      human_checkpoints_to_shepherd: humanCheckpoints.length
    }
  };
}

export function createWhereAmITool(api) {
  return {
    name: "parley_where_am_i",
    label: "Parley Where Am I",
    description: "Recover runtime obligations, board discovery hints, and optional board-local obligations when boardId is supplied. Defaults to compact output; pass verbosity: \"full\" for diagnostic detail.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Optional board id. Omit for runtime-only recovery; pass boardId for runtime plus board-local obligations." },
        includeTerminal: { type: "boolean", description: "Board section only: include resolved/cancelled/superseded obligations. Defaults to false." },
        verbosity: { type: "string", description: "Output detail level: compact or full. Defaults to compact." }
      }
    },
    async execute(_toolCallId, params) {
      const verbosity = normalizeVerbosity(params?.verbosity);
      const runtime = await runtimeObligationsForCaller(api, params);
      const runtimePrioritySummary = obligationPrioritySummary(runtime.obligations);
      const fullRuntimeSection = {
        identity: runtime.identity,
        participant_ids: runtime.participant_ids,
        obligations: runtime.obligations,
        counts: {
          obligations: runtime.obligations.length,
          active: runtime.obligations.filter((obligation) => obligation.status === "active").length,
          blocking: runtime.obligations.filter((obligation) => obligation.status === "blocking").length,
          by_priority: runtimePrioritySummary.by_priority,
          highest_priority: runtimePrioritySummary.highest_priority
        }
      };
      const compactRuntimeSection = {
        identity: compactRuntimeIdentity(runtime.identity),
        participant_ids: runtime.participant_ids,
        obligations: runtime.obligations.map(compactRuntimeObligation),
        counts: fullRuntimeSection.counts
      };
      const fullBoardsSection = {
        default_board: runtime.identity.default_board,
        available: (runtime.identity.boards ?? []).map((board) => board.board_id),
        boards: runtime.identity.boards ?? [],
        hint: "Call parley_where_am_i({ boardId, verbosity: \"full\" }) for full board-local diagnostic detail."
      };
      const compactBoardsSection = {
        default_board: runtime.identity.default_board,
        available: (runtime.identity.boards ?? []).map((board) => board.board_id),
        hint: "Call parley_where_am_i({ boardId }) for compact board-local recovery, or add verbosity: \"full\" for diagnostics."
      };

      if (params?.boardId == null) {
        return boardResult({
          tool: "parley_where_am_i",
          scope: "runtime",
          verbosity,
          runtime: verbosity === "full" ? fullRuntimeSection : compactRuntimeSection,
          boards: verbosity === "full" ? fullBoardsSection : compactBoardsSection,
          obligation_summary: buildObligationSummary(runtime.obligations)
        }, { summarize: verbosity !== "full" });
      }

      const identity = resolveToolCaller(api, params);
      const fullProjection = await boardWhereAmIProjection(api, identity, params);
      const obligationSummary = buildObligationSummary(runtime.obligations, fullProjection);
      if (verbosity === "full") {
        return boardResult({
          tool: "parley_where_am_i",
          scope: "runtime_and_board",
          verbosity,
          runtime: fullRuntimeSection,
          boards: fullBoardsSection,
          obligation_summary: obligationSummary,
          identity,
          projection: fullProjection
        }, { summarize: false });
      }

      const compactIdentity = compactBoardIdentity(identity);
      const compactProjection = compactBoardProjection(fullProjection);
      return boardResult({
        tool: "parley_where_am_i",
        scope: "runtime_and_board",
        verbosity,
        runtime: compactRuntimeSection,
        boards: compactBoardsSection,
        obligation_summary: obligationSummary,
        identity: compactIdentity,
        projection: compactProjection
      });
    }
  };
}
