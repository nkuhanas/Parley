import { activationCandidatesForAgent, deferredPhasesForAgent, deriveActivationState } from "../../../core/board/activation_state.js";
import { deriveApprovalState } from "../../../core/board/approval_state.js";
import { deriveCheckpointState, humanCheckpointsForShepherd } from "../../../core/board/checkpoint_state.js";
import {
  listArtifactRecords,
  listEffectRecords,
  listObligationRecords,
  loadArtifactRecord,
  loadCoordinationObjectRecord,
  loadEffectRecord
} from "../../../core/storage/board_store.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

const ACTIVE_STATUSES = new Set(["active", "blocking", "waiting", "deferred"]);
const TERMINAL_STATUSES = new Set(["resolved", "cancelled", "superseded"]);

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

export function createWhereAmITool(api) {
  return {
    name: "parley_where_am_i",
    label: "Parley Where Am I",
    description: "Resolve the caller to a board-local Parley identity and return current obligations for that agent.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Optional board override. Normal MVP use derives the board from callerRuntimeRef." },
        includeTerminal: { type: "boolean", description: "Include resolved/cancelled/superseded obligations. Defaults to false." }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const [obligations, artifacts, effects] = await Promise.all([
        listObligationRecords(api.pluginConfig, identity.board),
        listArtifactRecords(api.pluginConfig, identity.board),
        listEffectRecords(api.pluginConfig, identity.board)
      ]);
      const assigned = obligations.filter((obligation) => obligation.agent === identity.board_agent_id);
      const approvalState = deriveApprovalState(artifacts, effects);
      const activationState = await deriveActivationState(identity.board, artifacts, effects);
      const checkpointState = await deriveCheckpointState(identity.board, artifacts, obligations);
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
      return boardResult({
        tool: "parley_where_am_i",
        identity,
        projection: {
          board_id: identity.board_id,
          board_agent_id: identity.board_agent_id,
          blocking_obligations: enriched.filter((item) => item.obligation.status === "blocking"),
          active_obligations: enriched.filter((item) => item.obligation.status === "active"),
          waiting_obligations: enriched.filter((item) => item.obligation.status === "waiting"),
          deferred_obligations: enriched.filter((item) => item.obligation.status === "deferred"),
          other_visible_obligations: enriched.filter((item) => !ACTIVE_STATUSES.has(item.obligation.status)),
          stale_approvals: staleApprovals,
          activation_candidates_needing_attention: activationCandidates.filter((candidate) => candidate.review_required_from.includes(identity.board_agent_id) || candidate.attention_owner === identity.board_agent_id),
          activation_proposals_you_made: activationCandidates.filter((candidate) => candidate.proposed_by === identity.board_agent_id),
          deferred_phases_owned_not_actionable: deferredPhases,
          human_checkpoints_to_shepherd: humanCheckpoints,
          counts: {
            assigned: assigned.length,
            visible: enriched.length,
            blocking: enriched.filter((item) => item.obligation.status === "blocking").length,
            active: enriched.filter((item) => item.obligation.status === "active").length,
            waiting: enriched.filter((item) => item.obligation.status === "waiting").length,
            deferred: enriched.filter((item) => item.obligation.status === "deferred").length,
            stale_approvals: staleApprovals.length,
            activation_candidates: activationCandidates.length,
            deferred_phases_owned_not_actionable: deferredPhases.length,
            human_checkpoints_to_shepherd: humanCheckpoints.length
          }
        }
      });
    }
  };
}
