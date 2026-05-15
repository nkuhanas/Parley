import fs from "node:fs/promises";
import path from "node:path";

import { withFileLock } from "./file_locks.js";
import { getParleySqliteLedger } from "./sqlite_ledger.js";
import { resolveParleyPaths } from "../config.js";
import { createMessageId, createThreadId } from "../ids.js";
import { assertMessageRecord, assertThreadRecord } from "../protocol/schema.js";
import { nowIso } from "../time.js";

const JSON_INDENT = 2;
const FILE_TOKEN_PATTERN = /^[a-z0-9_]+$/;

function assertFileToken(value, fieldName) {
  if (typeof value !== "string" || !FILE_TOKEN_PATTERN.test(value)) {
    throw new Error(`${fieldName} must match ${FILE_TOKEN_PATTERN}`);
  }
  return value;
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, JSON_INDENT)}\n`;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
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

function getThreadPath(pluginConfig, threadId) {
  const { threadsDir } = resolveParleyPaths(pluginConfig);
  return path.join(threadsDir, `${assertFileToken(threadId, "thread_id")}.json`);
}

function getMessagePath(pluginConfig, threadId, messageId) {
  const { messagesDir } = resolveParleyPaths(pluginConfig);
  return path.join(
    messagesDir,
    assertFileToken(threadId, "thread_id"),
    `${assertFileToken(messageId, "message_id")}.json`
  );
}

function getIndexPath(pluginConfig, indexName) {
  const { indexDir } = resolveParleyPaths(pluginConfig);
  return path.join(indexDir, `${assertFileToken(indexName, "index_name")}.json`);
}

function runtimeLedger(pluginConfig) {
  return getParleySqliteLedger(pluginConfig);
}

function runtimeMessageCollection(threadId) {
  return `messages:${assertFileToken(threadId, "thread_id")}`;
}

export async function ensureParleyRuntimeLayout(pluginConfig = {}) {
  const ledger = runtimeLedger(pluginConfig);
  if (ledger != null) return { mode: "service", dbPath: ledger.dbPath };
  const paths = resolveParleyPaths(pluginConfig);
  await Promise.all([ensureDir(paths.runtimeRoot), ensureDir(paths.threadsDir), ensureDir(paths.messagesDir), ensureDir(paths.indexDir)]);
  return paths;
}

export function createThreadRecord(input) {
  const createdAt = input?.created_at ?? nowIso();
  const originKind = input?.origin_kind ?? "agent";
  const reportBackPolicy = input?.report_back_policy ?? "none";
  const humanSummaryAnchor = input?.human_summary_anchor ?? null;
  const requiresHumanSummaryAnchor = originKind === "human" && reportBackPolicy === "summary_to_human";
  const threadRecord = {
    thread_id: input?.thread_id ?? createThreadId(),
    kind: input?.kind,
    control_mode: input?.control_mode,
    initiator: input?.initiator,
    recipient: input?.recipient,
    origin_kind: originKind,
    report_back_policy: reportBackPolicy,
    next_action_owner: input?.next_action_owner,
    last_speaker: input?.last_speaker ?? null,
    meaningful_turn_pending: input?.meaningful_turn_pending ?? true,
    thread_state: input?.thread_state ?? "active",
    created_at: createdAt,
    updated_at: input?.updated_at ?? createdAt,
    opened_by_action: input?.opened_by_action ?? null,
    transport: input?.transport ?? null,
    transport_correlation: input?.transport_correlation ?? null,
    human_summary_anchor: humanSummaryAnchor,
    human_summary_anchor_status: input?.human_summary_anchor_status
      ?? (requiresHumanSummaryAnchor ? (humanSummaryAnchor != null ? "recorded" : "pending_send") : "not_required"),
    human_summary_anchor_request_text: input?.human_summary_anchor_request_text ?? null,
    probe_count: input?.probe_count ?? 0,
    last_claimed_at: input?.last_claimed_at ?? null,
    last_probe_at: input?.last_probe_at ?? null,
    concluded_at: input?.concluded_at ?? null,
    failure_reason: input?.failure_reason ?? null
  };
  return assertThreadRecord(threadRecord);
}

export function createMessageRecord(input) {
  const createdAt = input?.created_at ?? nowIso();
  const messageRecord = {
    message_id: input?.message_id ?? createMessageId(),
    thread_id: input?.thread_id,
    sender: input?.sender,
    message_class: input?.message_class,
    control_marker: input?.control_marker ?? null,
    body_text: input?.body_text ?? null,
    next_action_owner: input?.next_action_owner ?? null,
    created_at: createdAt,
    transport_state: input?.transport_state ?? (input?.transport_message_ref != null ? "accepted" : "not_required"),
    transport_target_session_key: input?.transport_target_session_key ?? null,
    transport_idempotency_key: input?.transport_idempotency_key ?? null,
    transport_message_ref: input?.transport_message_ref ?? null,
    transport_error: input?.transport_error ?? null,
    transport_attempted_at: input?.transport_attempted_at ?? null,
    transport_accepted_at: input?.transport_accepted_at ?? null
  };
  return assertMessageRecord(messageRecord);
}

export async function saveThreadRecord(pluginConfig = {}, record) {
  const validated = assertThreadRecord(record);
  const ledger = runtimeLedger(pluginConfig);
  if (ledger != null) return ledger.put("runtime", "", "threads", validated.thread_id, validated);
  await ensureParleyRuntimeLayout(pluginConfig);
  await writeJsonAtomic(getThreadPath(pluginConfig, validated.thread_id), validated);
  return validated;
}

export async function loadThreadRecord(pluginConfig = {}, threadId) {
  const ledger = runtimeLedger(pluginConfig);
  if (ledger != null) {
    const raw = ledger.get("runtime", "", "threads", assertFileToken(threadId, "thread_id"));
    return raw == null ? null : assertThreadRecord(raw);
  }
  const raw = await readJsonFile(getThreadPath(pluginConfig, threadId));
  return raw == null ? null : assertThreadRecord(raw);
}

export async function listThreadRecords(pluginConfig = {}) {
  const ledger = runtimeLedger(pluginConfig);
  if (ledger != null) {
    return ledger.list("runtime", "", "threads").map(assertThreadRecord).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  const { threadsDir } = resolveParleyPaths(pluginConfig);
  try {
    const entries = await fs.readdir(threadsDir, { withFileTypes: true });
    const threads = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const raw = await readJsonFile(path.join(threadsDir, entry.name));
      if (raw != null) threads.push(assertThreadRecord(raw));
    }
    return threads.sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function saveMessageRecord(pluginConfig = {}, record) {
  const validated = assertMessageRecord(record);
  const ledger = runtimeLedger(pluginConfig);
  if (ledger != null) return ledger.put("runtime", "", runtimeMessageCollection(validated.thread_id), validated.message_id, validated);
  await ensureParleyRuntimeLayout(pluginConfig);
  await writeJsonAtomic(getMessagePath(pluginConfig, validated.thread_id, validated.message_id), validated);
  return validated;
}

export async function loadMessageRecord(pluginConfig = {}, threadId, messageId) {
  const ledger = runtimeLedger(pluginConfig);
  if (ledger != null) {
    const raw = ledger.get("runtime", "", runtimeMessageCollection(threadId), assertFileToken(messageId, "message_id"));
    return raw == null ? null : assertMessageRecord(raw);
  }
  const raw = await readJsonFile(getMessagePath(pluginConfig, threadId, messageId));
  return raw == null ? null : assertMessageRecord(raw);
}

export async function updateMessageTransport(pluginConfig = {}, threadId, messageId, patch) {
  const message = await loadMessageRecord(pluginConfig, threadId, messageId);
  if (!message) {
    throw new Error(`message not found: ${messageId}`);
  }
  return await saveMessageRecord(pluginConfig, {
    ...message,
    ...patch
  });
}

export async function listThreadMessages(pluginConfig = {}, threadId) {
  const ledger = runtimeLedger(pluginConfig);
  if (ledger != null) {
    return ledger.list("runtime", "", runtimeMessageCollection(threadId)).map(assertMessageRecord).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  const { messagesDir } = resolveParleyPaths(pluginConfig);
  const threadDir = path.join(messagesDir, assertFileToken(threadId, "thread_id"));
  try {
    const entries = await fs.readdir(threadDir, { withFileTypes: true });
    const messages = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const fullPath = path.join(threadDir, entry.name);
      const raw = await readJsonFile(fullPath);
      if (raw != null) messages.push(assertMessageRecord(raw));
    }
    return messages.sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function loadIndex(pluginConfig = {}, indexName) {
  const ledger = runtimeLedger(pluginConfig);
  if (ledger != null) return ledger.get("runtime", "", "index", assertFileToken(indexName, "index_name")) ?? {};
  return (await readJsonFile(getIndexPath(pluginConfig, indexName), {})) ?? {};
}

export async function saveIndex(pluginConfig = {}, indexName, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("index value must be an object");
  }
  const ledger = runtimeLedger(pluginConfig);
  if (ledger != null) return ledger.put("runtime", "", "index", assertFileToken(indexName, "index_name"), value);
  await ensureParleyRuntimeLayout(pluginConfig);
  await writeJsonAtomic(getIndexPath(pluginConfig, indexName), value);
  return value;
}

export async function setTransportThreadMapping(pluginConfig = {}, transportKey, threadId) {
  const normalizedTransportKey = typeof transportKey === "string" && transportKey.trim() ? transportKey.trim() : null;
  if (!normalizedTransportKey) throw new Error("transportKey required");
  const normalizedThreadId = assertFileToken(threadId, "thread_id");
  const index = await loadIndex(pluginConfig, "thread_by_transport");
  index[normalizedTransportKey] = normalizedThreadId;
  await saveIndex(pluginConfig, "thread_by_transport", index);
  return normalizedThreadId;
}

export async function getThreadIdByTransport(pluginConfig = {}, transportKey) {
  const normalizedTransportKey = typeof transportKey === "string" && transportKey.trim() ? transportKey.trim() : null;
  if (!normalizedTransportKey) return null;
  const index = await loadIndex(pluginConfig, "thread_by_transport");
  return typeof index[normalizedTransportKey] === "string" ? index[normalizedTransportKey] : null;
}
