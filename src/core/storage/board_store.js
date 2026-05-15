import fs from "node:fs/promises";
import path from "node:path";

import { withFileLock } from "./file_locks.js";
import { getParleySqliteLedger } from "./sqlite_ledger.js";
import { assertParleyLocalStateAvailable, resolveParleyBoardRegistry } from "../config.js";
import { compareEffectRecords } from "../effect_ordering.js";
import { createArtifactId, createEffectId, createObjectId, createObligationId, createRelationshipId, createTriggerId } from "../ids.js";
import { assertPlanSetupRecord } from "../plan/plan_state.js";
import { nowIso } from "../time.js";
import {
  assertArtifactRecord,
  assertCoordinationObjectRecord,
  assertBoardAgentId,
  assertEffectRecord,
  assertNonEmptyString,
  assertObligationRecord,
  assertProjectionCheckpointRecord,
  assertRecordId,
  assertRelationshipRecord,
  assertTriggerRecord,
  assertEnum,
  PROJECTION_TYPES
} from "../board/board_schema.js";

const JSON_INDENT = 2;

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, JSON_INDENT)}\n`;
}

async function writeJsonAtomicUnlocked(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${process.hrtime.bigint()}.tmp`;
  await fs.writeFile(tempPath, serializeJson(value), "utf8");
  await fs.rename(tempPath, filePath);
}

async function writeJsonAtomic(filePath, value) {
  return withFileLock(filePath, () => writeJsonAtomicUnlocked(filePath, value));
}

async function readJsonFileUnlocked(filePath, defaultValue = null) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error?.code === "ENOENT") return defaultValue;
    throw error;
  }
}

async function readJsonFile(filePath, defaultValue = null) {
  return withFileLock(filePath, () => readJsonFileUnlocked(filePath, defaultValue));
}

export function boardRecordPath(board, collectionName, recordId) {
  return path.join(board.state_root, collectionName, `${assertRecordId(recordId, "record_id")}.json`);
}

function recordPath(board, collectionName, recordId) {
  return boardRecordPath(board, collectionName, recordId);
}

export function planSetupRecordPath(board, planId) {
  return recordPath(board, "plans", planId);
}

export async function withPlanSetupRecordLock(board, planId, operation) {
  return withFileLock(planSetupRecordPath(board, planId), operation);
}

function checkpointPath(board, boardAgentId, projectionType) {
  const agentId = assertBoardAgentId(boardAgentId);
  const normalizedProjectionType = assertEnum(projectionType, PROJECTION_TYPES, "projection_type");
  return path.join(board.state_root, "checkpoints", `${agentId}__${normalizedProjectionType}.json`);
}

function recordSortKey(record) {
  return record?.effect_id
    ?? record?.artifact_id
    ?? record?.object_id
    ?? record?.obligation_id
    ?? record?.relationship_id
    ?? `${record?.board_agent_id ?? ""}:${record?.projection_type ?? ""}`;
}

function compareRecords(a, b) {
  if (a?.effect_id != null || b?.effect_id != null) return compareEffectRecords(a, b);
  const createdAt = (a.created_at ?? "").localeCompare(b.created_at ?? "");
  if (createdAt !== 0) return createdAt;
  return String(recordSortKey(a)).localeCompare(String(recordSortKey(b)));
}

function boardLedger(pluginConfig) {
  return getParleySqliteLedger(pluginConfig);
}

function boardRecordKey(boardAgentId, projectionType) {
  const agentId = assertBoardAgentId(boardAgentId);
  const normalizedProjectionType = assertEnum(projectionType, PROJECTION_TYPES, "projection_type");
  return `${agentId}__${normalizedProjectionType}`;
}

async function listRecords(pluginConfig, board, collectionName, validator) {
  const ledger = boardLedger(pluginConfig);
  if (ledger != null) {
    return ledger.list("board", board.board_id, collectionName).map(validator).sort(compareRecords);
  }
  const dirPath = path.join(board.state_root, collectionName);
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const records = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const raw = await readJsonFile(path.join(dirPath, entry.name));
      if (raw != null) records.push(validator(raw));
    }
    return records.sort(compareRecords);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function ensureParleyBoardLayout(pluginConfig = {}, board) {
  assertParleyLocalStateAvailable(pluginConfig, { operation: "Parley board file state" });
  const registry = resolveParleyBoardRegistry(pluginConfig);
  const targetBoard = board ?? Object.values(registry.boards)[0];
  if (!targetBoard) throw new Error("Parley requires at least one configured board");
  await Promise.all([
    ensureDir(targetBoard.board_root),
    ensureDir(targetBoard.state_root),
    ensureDir(targetBoard.managed_artifact_root),
    ensureDir(path.join(targetBoard.state_root, "artifacts")),
    ensureDir(path.join(targetBoard.state_root, "objects")),
    ensureDir(path.join(targetBoard.state_root, "effects")),
    ensureDir(path.join(targetBoard.state_root, "obligations")),
    ensureDir(path.join(targetBoard.state_root, "relationships")),
    ensureDir(path.join(targetBoard.state_root, "triggers")),
    ensureDir(path.join(targetBoard.state_root, "plans")),
    ensureDir(path.join(targetBoard.state_root, "checkpoints")),
    ensureDir(path.join(targetBoard.state_root, "index"))
  ]);
  return targetBoard;
}

export function createArtifactRecord(input) {
  const timestamp = input?.created_at ?? nowIso();
  return assertArtifactRecord({
    board_id: input?.board_id,
    artifact_id: input?.artifact_id ?? createArtifactId(),
    kind: input?.kind,
    storage_mode: input?.storage_mode,
    uri: input?.uri ?? null,
    version: input?.version ?? 1,
    status: input?.status ?? "draft",
    title: input?.title ?? null,
    content_hash: input?.content_hash ?? null,
    landing_root: input?.landing_root ?? null,
    resolved_path: input?.resolved_path ?? null,
    created_at: timestamp,
    updated_at: input?.updated_at ?? timestamp
  });
}

export function createCoordinationObjectRecord(input) {
  const timestamp = input?.created_at ?? nowIso();
  return assertCoordinationObjectRecord({
    board_id: input?.board_id,
    object_id: input?.object_id ?? createObjectId(),
    kind: input?.kind,
    title: input?.title,
    status: input?.status ?? "draft",
    artifact_ref: input?.artifact_ref ?? null,
    participants: input?.participants ?? [],
    created_at: timestamp,
    updated_at: input?.updated_at ?? timestamp
  });
}

export function createEffectRecord(input) {
  return assertEffectRecord({
    board_id: input?.board_id,
    effect_id: input?.effect_id ?? createEffectId(),
    type: input?.type,
    actor: input?.actor,
    target: input?.target ?? {},
    payload: input?.payload ?? {},
    source_thread_id: input?.source_thread_id ?? null,
    source_message_id: input?.source_message_id ?? null,
    created_at: input?.created_at ?? nowIso()
  });
}

export function createObligationRecord(input) {
  const timestamp = input?.created_at ?? nowIso();
  return assertObligationRecord({
    board_id: input?.board_id,
    obligation_id: input?.obligation_id ?? createObligationId(),
    agent: input?.agent,
    type: input?.type,
    template_id: input?.template_id ?? null,
    status: input?.status ?? "active",
    resolution: input?.resolution ?? null,
    resolution_note: input?.resolution_note ?? null,
    resolved_at: input?.resolved_at ?? null,
    target: input?.target ?? {},
    scope: input?.scope ?? null,
    reason: input?.reason ?? null,
    source_effect_id: input?.source_effect_id ?? null,
    managedBinding: input?.managedBinding ?? input?.managed_binding ?? null,
    executionPolicy: input?.executionPolicy ?? input?.execution_policy ?? null,
    on_resolve_trigger_ids: input?.on_resolve_trigger_ids ?? [],
    created_at: timestamp,
    updated_at: input?.updated_at ?? timestamp
  });
}

export function createTriggerRecord(input) {
  const timestamp = input?.created_at ?? nowIso();
  return assertTriggerRecord({
    board_id: input?.board_id,
    trigger_id: input?.trigger_id ?? createTriggerId(),
    title: input?.title,
    status: input?.status ?? "active",
    source: input?.source,
    condition: input?.condition ?? {},
    action: input?.action,
    fire_policy: input?.fire_policy ?? "once",
    created_at: timestamp,
    updated_at: input?.updated_at ?? timestamp
  });
}

export function createRelationshipRecord(input) {
  const timestamp = input?.created_at ?? nowIso();
  return assertRelationshipRecord({
    board_id: input?.board_id,
    relationship_id: input?.relationship_id ?? createRelationshipId(),
    type: input?.type,
    from: input?.from,
    to: input?.to,
    status: input?.status ?? "active",
    actor: input?.actor,
    reason: input?.reason ?? null,
    source_effect_id: input?.source_effect_id ?? null,
    removed_effect_id: input?.removed_effect_id ?? null,
    removed_at: input?.removed_at ?? null,
    correction_of: input?.correction_of ?? null,
    replaces_relationship_id: input?.replaces_relationship_id ?? null,
    created_at: timestamp,
    updated_at: input?.updated_at ?? timestamp
  });
}

export function createProjectionCheckpointRecord(input) {
  const timestamp = input?.created_at ?? nowIso();
  return assertProjectionCheckpointRecord({
    board_id: input?.board_id,
    board_agent_id: input?.board_agent_id,
    projection_type: input?.projection_type,
    cursor: input?.cursor,
    last_seen_at: input?.last_seen_at ?? timestamp,
    last_seen_by_runtime_ref: input?.last_seen_by_runtime_ref,
    created_at: timestamp,
    updated_at: input?.updated_at ?? timestamp
  });
}

async function saveRecord(pluginConfig, board, collectionName, recordId, record, validator, options = {}) {
  const validated = validator(record);
  const ledger = boardLedger(pluginConfig);
  if (ledger != null) return ledger.put("board", board.board_id, collectionName, recordId, validated, options);
  const targetBoard = await ensureParleyBoardLayout(pluginConfig, board);
  const filePath = recordPath(targetBoard, collectionName, recordId);
  if (options.appendOnly === true) {
    return withFileLock(filePath, async () => {
      const existing = await readJsonFileUnlocked(filePath);
      if (existing != null) throw new Error(`${collectionName} record already exists: ${recordId}`);
      await writeJsonAtomicUnlocked(filePath, validated);
      return validated;
    });
  }
  await writeJsonAtomic(filePath, validated);
  return validated;
}

async function loadRecord(pluginConfig, board, collectionName, recordId, validator) {
  const ledger = boardLedger(pluginConfig);
  if (ledger != null) {
    const raw = ledger.get("board", board.board_id, collectionName, recordId);
    return raw == null ? null : validator(raw);
  }
  const raw = await readJsonFile(recordPath(board, collectionName, recordId));
  return raw == null ? null : validator(raw);
}

export async function saveArtifactRecord(pluginConfig, board, record) {
  const validated = assertArtifactRecord(record);
  return saveRecord(pluginConfig, board, "artifacts", validated.artifact_id, validated, assertArtifactRecord);
}

export async function saveCoordinationObjectRecord(pluginConfig, board, record) {
  const validated = assertCoordinationObjectRecord(record);
  return saveRecord(pluginConfig, board, "objects", validated.object_id, validated, assertCoordinationObjectRecord);
}

export async function saveEffectRecord(pluginConfig, board, record) {
  const validated = assertEffectRecord(record);
  return saveRecord(pluginConfig, board, "effects", validated.effect_id, validated, assertEffectRecord, { appendOnly: true });
}

export async function saveObligationRecord(pluginConfig, board, record) {
  const validated = assertObligationRecord(record);
  return saveRecord(pluginConfig, board, "obligations", validated.obligation_id, validated, assertObligationRecord);
}

export async function saveTriggerRecord(pluginConfig, board, record) {
  const validated = assertTriggerRecord(record);
  return saveRecord(pluginConfig, board, "triggers", validated.trigger_id, validated, assertTriggerRecord);
}

export async function saveRelationshipRecord(pluginConfig, board, record) {
  const validated = assertRelationshipRecord(record);
  return saveRecord(pluginConfig, board, "relationships", validated.relationship_id, validated, assertRelationshipRecord);
}

export async function saveProjectionCheckpointRecord(pluginConfig, board, record) {
  const validated = assertProjectionCheckpointRecord(record);
  const ledger = boardLedger(pluginConfig);
  if (ledger != null) {
    return ledger.put("board", board.board_id, "checkpoints", boardRecordKey(validated.board_agent_id, validated.projection_type), validated);
  }
  const targetBoard = await ensureParleyBoardLayout(pluginConfig, board);
  await writeJsonAtomic(checkpointPath(targetBoard, validated.board_agent_id, validated.projection_type), validated);
  return validated;
}

export async function savePlanSetupRecord(pluginConfig, board, record) {
  const validated = assertPlanSetupRecord(record);
  return saveRecord(pluginConfig, board, "plans", validated.plan_id, validated, assertPlanSetupRecord);
}

export async function loadArtifactRecord(pluginConfig, board, artifactId) {
  return loadRecord(pluginConfig, board, "artifacts", artifactId, assertArtifactRecord);
}

export async function loadCoordinationObjectRecord(pluginConfig, board, objectId) {
  return loadRecord(pluginConfig, board, "objects", objectId, assertCoordinationObjectRecord);
}

export async function loadEffectRecord(pluginConfig, board, effectId) {
  return loadRecord(pluginConfig, board, "effects", effectId, assertEffectRecord);
}

export async function loadObligationRecord(pluginConfig, board, obligationId) {
  return loadRecord(pluginConfig, board, "obligations", obligationId, assertObligationRecord);
}

export async function loadTriggerRecord(pluginConfig, board, triggerId) {
  return loadRecord(pluginConfig, board, "triggers", triggerId, assertTriggerRecord);
}

export async function loadRelationshipRecord(pluginConfig, board, relationshipId) {
  return loadRecord(pluginConfig, board, "relationships", relationshipId, assertRelationshipRecord);
}

export async function loadProjectionCheckpointRecord(pluginConfig, board, boardAgentId, projectionType) {
  const ledger = boardLedger(pluginConfig);
  if (ledger != null) {
    const raw = ledger.get("board", board.board_id, "checkpoints", boardRecordKey(boardAgentId, projectionType));
    return raw == null ? null : assertProjectionCheckpointRecord(raw);
  }
  const raw = await readJsonFile(checkpointPath(board, boardAgentId, projectionType));
  return raw == null ? null : assertProjectionCheckpointRecord(raw);
}

export async function loadPlanSetupRecord(pluginConfig, board, planId) {
  return loadRecord(pluginConfig, board, "plans", planId, assertPlanSetupRecord);
}

export async function listArtifactRecords(pluginConfig, board) {
  return listRecords(pluginConfig, board, "artifacts", assertArtifactRecord);
}

export async function listCoordinationObjectRecords(pluginConfig, board) {
  return listRecords(pluginConfig, board, "objects", assertCoordinationObjectRecord);
}

export async function listEffectRecords(pluginConfig, board) {
  return listRecords(pluginConfig, board, "effects", assertEffectRecord);
}

export async function listObligationRecords(pluginConfig, board) {
  return listRecords(pluginConfig, board, "obligations", assertObligationRecord);
}

export async function listTriggerRecords(pluginConfig, board) {
  return listRecords(pluginConfig, board, "triggers", assertTriggerRecord);
}

export async function listRelationshipRecords(pluginConfig, board) {
  return listRecords(pluginConfig, board, "relationships", assertRelationshipRecord);
}

export async function listProjectionCheckpointRecords(pluginConfig, board) {
  return listRecords(pluginConfig, board, "checkpoints", assertProjectionCheckpointRecord);
}

export async function listPlanSetupRecords(pluginConfig, board) {
  return listRecords(pluginConfig, board, "plans", assertPlanSetupRecord);
}

export function normalizeArtifactRef(artifact, version = null) {
  return {
    artifact_id: assertNonEmptyString(artifact.artifact_id, "artifact.artifact_id"),
    version: version ?? artifact.version
  };
}
