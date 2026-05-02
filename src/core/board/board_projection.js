import { deriveActivationState } from "./activation_state.js";
import { deriveApprovalState } from "./approval_state.js";
import { deriveCheckpointState } from "./checkpoint_state.js";
import {
  listArtifactRecords,
  listCoordinationObjectRecords,
  listEffectRecords,
  listObligationRecords,
  listRelationshipRecords
} from "../storage/board_store.js";
import { buildRelationshipGraph } from "./relationship_graph.js";

const DEFAULT_RECORD_LIMIT = 50;

function increment(counter, key) {
  const normalized = key ?? "unknown";
  counter[normalized] = (counter[normalized] ?? 0) + 1;
}

function countBy(records, fieldName) {
  const counts = {};
  for (const record of records) {
    increment(counts, record?.[fieldName]);
  }
  return counts;
}

function countObligationsByAgent(records) {
  const counts = {};
  for (const record of records) {
    const agent = record.agent ?? "unknown";
    counts[agent] ??= { total: 0, by_status: {}, by_type: {} };
    counts[agent].total += 1;
    increment(counts[agent].by_status, record.status);
    increment(counts[agent].by_type, record.type);
  }
  return counts;
}

function normalizeRecordLimit(value) {
  if (value == null) return DEFAULT_RECORD_LIMIT;
  if (!Number.isInteger(value) || value < 0) throw new Error("recordLimit must be a non-negative integer");
  return value;
}

function limitRecords(records, recordLimit) {
  if (recordLimit === 0) return [];
  return records.slice(0, recordLimit);
}

function summarizeAgents(board) {
  return board.agent_registry.map((agent) => ({
    board_agent_id: agent.board_agent_id,
    display_name: agent.display_name,
    kind: agent.kind,
    roles: agent.roles,
    runtime_ref_count: agent.runtime_refs.length,
    permissions: agent.permissions
  }));
}

export async function buildBoardProjection(pluginConfig, board, options = {}) {
  const recordLimit = normalizeRecordLimit(options.recordLimit);
  const includeRecords = options.includeRecords === true;
  const [artifacts, objects, effects, obligations, relationships] = await Promise.all([
    listArtifactRecords(pluginConfig, board),
    listCoordinationObjectRecords(pluginConfig, board),
    listEffectRecords(pluginConfig, board),
    listObligationRecords(pluginConfig, board),
    listRelationshipRecords(pluginConfig, board)
  ]);
  const approval_state = deriveApprovalState(artifacts, effects);
  const relationship_graph = buildRelationshipGraph(relationships, artifacts, objects);
  const activation_state = await deriveActivationState(board, artifacts, effects);
  const checkpoint_state = await deriveCheckpointState(board, artifacts, obligations);

  return {
    board_id: board.board_id,
    display_name: board.display_name,
    status: board.status,
    projection_type: "minimal_board",
    derived: true,
    agents: summarizeAgents(board),
    counts: {
      agents: board.agent_registry.length,
      artifacts: artifacts.length,
      objects: objects.length,
      effects: effects.length,
      obligations: obligations.length,
      relationships: relationships.length,
      relationship_nodes: relationship_graph.counts.nodes,
      relationship_edges: relationship_graph.counts.edges,
      approvals: approval_state.counts.approvals,
      deferred_phases: activation_state.counts.deferred_phases,
      activation_candidates: activation_state.counts.activation_candidates,
      human_checkpoints: checkpoint_state.counts.human_checkpoints,
      active_human_checkpoint_obligations: checkpoint_state.counts.active_human_checkpoint_obligations,
      stale_approvals: approval_state.counts.by_status.stale ?? 0,
      active_approvals: approval_state.counts.by_status.active ?? 0,
      carried_forward_approvals: approval_state.counts.by_status.carried_forward ?? 0,
      withdrawn_approvals: approval_state.counts.by_status.withdrawn ?? 0,
      artifacts_by_kind: countBy(artifacts, "kind"),
      artifacts_by_status: countBy(artifacts, "status"),
      objects_by_kind: countBy(objects, "kind"),
      objects_by_status: countBy(objects, "status"),
      effects_by_type: countBy(effects, "type"),
      obligations_by_type: countBy(obligations, "type"),
      obligations_by_status: countBy(obligations, "status"),
      obligations_by_agent: countObligationsByAgent(obligations),
      relationships_by_type: relationship_graph.counts.by_type,
      relationships_by_status: relationship_graph.counts.by_status,
      approvals_by_status: approval_state.counts.by_status,
      approvals_by_scope: approval_state.counts.by_scope,
      approvals_by_approver: approval_state.counts.by_approver,
      activation_candidates_by_status: activation_state.counts.candidates_by_status,
      deferred_phases_by_status: activation_state.counts.by_status,
      human_checkpoints_by_status: checkpoint_state.counts.by_status,
      human_checkpoints_by_shepherd: checkpoint_state.counts.by_shepherd
    },
    approval_state,
    activation_state,
    checkpoint_state,
    relationship_graph,
    records: includeRecords
      ? {
          limit: recordLimit,
          truncated: {
            artifacts: artifacts.length > recordLimit,
            objects: objects.length > recordLimit,
            effects: effects.length > recordLimit,
            obligations: obligations.length > recordLimit,
            relationships: relationships.length > recordLimit
          },
          artifacts: limitRecords(artifacts, recordLimit),
          objects: limitRecords(objects, recordLimit),
          effects: limitRecords(effects, recordLimit),
          obligations: limitRecords(obligations, recordLimit),
          relationships: limitRecords(relationships, recordLimit)
        }
      : null
  };
}
