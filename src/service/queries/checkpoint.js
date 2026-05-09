import {
  createProjectionCheckpointRecord,
  loadProjectionCheckpointRecord,
  saveProjectionCheckpointRecord
} from "../../core/storage/board_store.js";
import {
  buildProjectionCursor,
  compareProjectionCursors,
  normalizeProjectionType
} from "../../core/board/projection_checkpoint.js";
import { nowIso } from "../../core/time.js";
import { normalizeServiceRequest } from "../context.js";
import { SERVICE_ERROR_CODES, serviceError } from "../errors.js";
import { resolveServiceCallerIdentity } from "../identity.js";
import { queryResponse } from "../responses.js";
import { getBoardProjection } from "./board.js";
import { whereAmI } from "./adapter_bridge.js";

function value(input, snakeName, camelName = snakeName) {
  return input?.[snakeName] ?? input?.[camelName];
}

function summarizeIdentity(identity) {
  return {
    board_id: identity.board_id,
    global_agent_id: identity.global_agent_id,
    board_agent_id: identity.board_agent_id
  };
}

function normalizeCheckpointProjectionType(input) {
  try {
    return normalizeProjectionType(value(input, "projection_type", "projectionType"));
  } catch (error) {
    throw serviceError(SERVICE_ERROR_CODES.VALIDATION_FAILED, error.message, { cause: error });
  }
}

async function buildProjectionForCheckpoint({ caller, input, identity, projectionType }, deps) {
  if (projectionType === "where_am_i") {
    const response = await whereAmI({
      caller,
      input: {
        board_id: identity.board_id,
        include_terminal: value(input, "include_terminal", "includeTerminal")
      }
    }, deps);
    return response.data.projection;
  }

  const response = await getBoardProjection({
    caller,
    input: {
      board_id: identity.board_id,
      include_records: false
    }
  }, deps);
  return response.data.projection;
}

export async function checkpointProjection(request = {}, deps = {}) {
  const { caller, input } = normalizeServiceRequest(request);
  const identity = resolveServiceCallerIdentity(deps.pluginConfig, caller, input);
  const projectionType = normalizeCheckpointProjectionType(input);
  const previousCheckpoint = await loadProjectionCheckpointRecord(
    deps.pluginConfig,
    identity.board,
    identity.board_agent_id,
    projectionType
  );
  const projection = await buildProjectionForCheckpoint({ caller, input, identity, projectionType }, deps);
  const currentCursor = buildProjectionCursor(projectionType, projection);
  const comparison = compareProjectionCursors(previousCheckpoint?.cursor ?? null, currentCursor);

  let checkpoint = previousCheckpoint;
  if (value(input, "advance") === true) {
    const timestamp = nowIso();
    checkpoint = await saveProjectionCheckpointRecord(
      deps.pluginConfig,
      identity.board,
      createProjectionCheckpointRecord({
        board_id: identity.board_id,
        board_agent_id: identity.board_agent_id,
        projection_type: projectionType,
        cursor: currentCursor,
        last_seen_at: timestamp,
        last_seen_by_runtime_ref: identity.runtime_ref,
        created_at: previousCheckpoint?.created_at ?? timestamp,
        updated_at: timestamp
      })
    );
  }

  return queryResponse({
    data: {
      tool: "parley_checkpoint_projection",
      identity: summarizeIdentity(identity),
      projection_type: projectionType,
      advanced: value(input, "advance") === true,
      comparison,
      previous_checkpoint: previousCheckpoint,
      current_cursor: currentCursor,
      checkpoint
    }
  });
}
