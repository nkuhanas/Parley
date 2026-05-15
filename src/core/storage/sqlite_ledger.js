import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { resolveParleyRuntimeConfig } from "../config.js";

const ledgerCache = new Map();

export const PARLEY_SQLITE_LEDGER_MIGRATIONS = Object.freeze([
  {
    version: 1,
    name: "create_generic_record_ledger",
    sql: `
      CREATE TABLE IF NOT EXISTS parley_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS parley_records (
        scope TEXT NOT NULL,
        board_id TEXT NOT NULL DEFAULT '',
        collection TEXT NOT NULL,
        record_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope, board_id, collection, record_id)
      );

      CREATE INDEX IF NOT EXISTS idx_parley_records_collection
        ON parley_records(scope, board_id, collection, updated_at);
    `
  }
]);

function nowIso() {
  return new Date().toISOString();
}

function boardKey(boardId) {
  return boardId ?? "";
}

function parseRecordJson(row) {
  return row == null ? null : JSON.parse(row.record_json);
}

function runtimeConfigForStorage(pluginConfig = {}, options = {}) {
  return resolveParleyRuntimeConfig({
    surface: options.surface ?? pluginConfig.__parleySurface ?? "core",
    pluginConfig,
    env: options.env
  });
}

export function resolveParleyServiceLedgerConfig(pluginConfig = {}, options = {}) {
  const runtimeConfig = runtimeConfigForStorage(pluginConfig, options);
  return runtimeConfig.storageMode === "service-db" ? runtimeConfig : null;
}

export function isParleyServiceLedgerStorage(pluginConfig = {}, options = {}) {
  return resolveParleyServiceLedgerConfig(pluginConfig, options) != null;
}

function openDatabase(dbPath) {
  const cached = ledgerCache.get(dbPath);
  if (cached != null) return cached;
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  const ledger = new ParleySqliteLedger(dbPath, db);
  ledgerCache.set(dbPath, ledger);
  return ledger;
}

export async function migrateParleySqliteLedger(pluginConfig = {}, options = {}) {
  const runtimeConfig = runtimeConfigForStorage(pluginConfig, options);
  if (runtimeConfig.storageMode !== "service-db") {
    throw new Error(`Parley SQLite migrations require service-db storage; got ${runtimeConfig.storageMode}`);
  }
  await fs.mkdir(path.dirname(runtimeConfig.dbPath), { recursive: true });
  const ledger = openDatabase(runtimeConfig.dbPath);
  const applied = [];
  const skipped = [];
  ledger.db.exec(`
    CREATE TABLE IF NOT EXISTS parley_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  for (const migration of PARLEY_SQLITE_LEDGER_MIGRATIONS) {
    const existing = ledger.db.prepare("SELECT version FROM parley_schema_migrations WHERE version = ?").get(migration.version);
    if (existing != null) {
      skipped.push(migration.version);
      continue;
    }
    ledger.db.exec("BEGIN IMMEDIATE");
    try {
      ledger.db.exec(migration.sql);
      ledger.db.prepare("INSERT INTO parley_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, nowIso());
      ledger.db.exec("COMMIT");
      applied.push(migration.version);
    } catch (error) {
      ledger.db.exec("ROLLBACK");
      throw error;
    }
  }
  return {
    status: "ok",
    dbPath: runtimeConfig.dbPath,
    applied,
    skipped,
    migrationCount: PARLEY_SQLITE_LEDGER_MIGRATIONS.length
  };
}


export function closeParleySqliteLedger(dbPath) {
  const ledger = ledgerCache.get(dbPath);
  if (ledger == null) return false;
  ledger.db.close();
  ledgerCache.delete(dbPath);
  return true;
}

export function closeAllParleySqliteLedgers() {
  for (const ledger of ledgerCache.values()) ledger.db.close();
  ledgerCache.clear();
}

export function getParleySqliteLedger(pluginConfig = {}, options = {}) {
  const runtimeConfig = resolveParleyServiceLedgerConfig(pluginConfig, options);
  if (runtimeConfig == null) return null;
  return openDatabase(runtimeConfig.dbPath);
}

export async function withParleyServiceLedgerTransaction(pluginConfig = {}, operation, options = {}) {
  const ledger = getParleySqliteLedger(pluginConfig, options);
  if (ledger == null) return operation();
  return ledger.transaction(operation);
}

export class ParleySqliteLedger {
  constructor(dbPath, db) {
    this.dbPath = dbPath;
    this.db = db;
    this.transactionDepth = 0;
  }

  async transaction(operation) {
    if (this.transactionDepth > 0) return operation();
    this.db.exec("BEGIN IMMEDIATE");
    this.transactionDepth += 1;
    try {
      const result = await operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  get(scope, boardId, collection, recordId) {
    const row = this.db.prepare(`
      SELECT record_json FROM parley_records
      WHERE scope = ? AND board_id = ? AND collection = ? AND record_id = ?
    `).get(scope, boardKey(boardId), collection, recordId);
    return parseRecordJson(row);
  }

  list(scope, boardId, collection) {
    const rows = this.db.prepare(`
      SELECT record_json FROM parley_records
      WHERE scope = ? AND board_id = ? AND collection = ?
      ORDER BY created_at ASC, record_id ASC
    `).all(scope, boardKey(boardId), collection);
    return rows.map(parseRecordJson);
  }

  put(scope, boardId, collection, recordId, record, options = {}) {
    if (options.appendOnly === true && this.get(scope, boardId, collection, recordId) != null) {
      throw new Error(`${collection} record already exists: ${recordId}`);
    }
    const timestamp = nowIso();
    const recordJson = JSON.stringify(record);
    this.db.prepare(`
      INSERT INTO parley_records(scope, board_id, collection, record_id, record_json, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(scope, board_id, collection, record_id) DO UPDATE SET
        record_json = excluded.record_json,
        version = parley_records.version + 1,
        updated_at = excluded.updated_at
    `).run(scope, boardKey(boardId), collection, recordId, recordJson, timestamp, timestamp);
    return record;
  }
}
