/**
 * Admin Database Module — SQLite-backed model & config store
 *
 * Proper normalized tables instead of a single JSON blob.
 * The middleman reads from these tables and writes to the JSON files
 * that the forwarding proxy reads.
 *
 * Tables:
 *   models     — individual model records (name, slug, base, key, model_id, idx)
 *   config_kv  — key-value store for all config-proxy settings
 *   db_version — change tracking for middleman sync detection
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { log } from "./logger.mjs";
import { PATHS, loadJSON } from "./config.mjs";

const DB_PATH = path.join(PATHS.data, "admin.db");
let _db = null;

/**
 * Initialize the admin database.
 */
export function initAdminDB() {
  if (_db) return _db;

  try { fs.mkdirSync(path.dirname(DB_PATH), { recursive: true }); } catch (e) { /* exists */ }

  _db = new DatabaseSync(DB_PATH);
  _db.exec("PRAGMA journal_mode=WAL");

  // ── Models table ──
  _db.exec(`CREATE TABLE IF NOT EXISTS models (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL DEFAULT '',
    slug       TEXT UNIQUE NOT NULL,
    base       TEXT NOT NULL DEFAULT '',
    key        TEXT NOT NULL DEFAULT '',
    model_id   TEXT NOT NULL DEFAULT '',
    idx        INTEGER NOT NULL DEFAULT 0,
    enabled    INTEGER NOT NULL DEFAULT 1,
    extra      TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`);

  // ── Config key-value table ──
  _db.exec(`CREATE TABLE IF NOT EXISTS config_kv (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL DEFAULT 0
  )`);

  // ── Provider tokens table (model usage rankings) ──
  _db.exec(`CREATE TABLE IF NOT EXISTS provider_tokens (
    provider_name TEXT PRIMARY KEY,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`);

  // ── Version tracking (middleman polls this to detect changes) ──
  _db.exec(`CREATE TABLE IF NOT EXISTS db_version (
    table_name TEXT PRIMARY KEY,
    version    INTEGER NOT NULL DEFAULT 0
  )`);

  // Ensure version rows exist
  for (const t of ["models", "config_kv"]) {
    const row = _db.prepare("SELECT version FROM db_version WHERE table_name = ?").get(t);
    if (!row) {
      _db.prepare("INSERT INTO db_version (table_name, version) VALUES (?, 0)").run(t);
    }
  }

  // Migrate from JSON if DB is empty
  const modelCount = _db.prepare("SELECT COUNT(*) as cnt FROM models").get().cnt;
  if (modelCount === 0) {
    migrateFromJSON();
  }

  log.info("[admin-db] SQLite ready: " + DB_PATH);
  return _db;
}

// ═══════════════════════════════════════════════════════════════
//  Migration: import existing JSON files into DB on first run
// ═══════════════════════════════════════════════════════════════

function migrateFromJSON() {
  // ── Migrate models.json ──
  try {
    const models = loadJSON(PATHS.models, []);
    const insert = _db.prepare(
      "INSERT OR IGNORE INTO models (name, slug, base, key, model_id, idx, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)"
    );
    const now = Date.now();
    for (const m of models) {
      const slug = m.slug || slugify(m.name || "");
      const modelId = m.id || (m.models && m.models[0]) || "";
      insert.run(m.name || "", slug, m.base || "", m.key || "", modelId, m.idx || 0, now, now);
    }
    bumpVersion("models");
    log.info("[admin-db] migrated " + models.length + " models from JSON");
  } catch (e) {
    log.warn("[admin-db] models migration failed: " + e.message);
  }

  // ── Migrate config-proxy.json ──
  try {
    const config = loadJSON(PATHS.configProxy, {});
    const insert = _db.prepare("INSERT OR REPLACE INTO config_kv (key, value, updated_at) VALUES (?, ?, ?)");
    const now = Date.now();
    for (const [k, v] of Object.entries(config)) {
      insert.run(k, JSON.stringify(v), now);
    }
    bumpVersion("config_kv");
    log.info("[admin-db] migrated " + Object.keys(config).length + " config keys from JSON");
  } catch (e) {
    log.warn("[admin-db] config migration failed: " + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
//  Version bump (called after every write to signal middleman)
// ═══════════════════════════════════════════════════════════════

function bumpVersion(table) {
  const now = Date.now();
  _db.prepare("UPDATE db_version SET version = ? WHERE table_name = ?").run(now, table);
}

// ═══════════════════════════════════════════════════════════════
//  Models CRUD
// ═══════════════════════════════════════════════════════════════

/**
 * Get all enabled models ordered by idx.
 */
export function dbGetModels() {
  const db = _db || initAdminDB();
  return db.prepare("SELECT * FROM models WHERE enabled = 1 ORDER BY idx ASC, id ASC").all();
}

/**
 * Get ALL models (including disabled) ordered by idx.
 */
export function dbGetAllModels() {
  const db = _db || initAdminDB();
  return db.prepare("SELECT * FROM models ORDER BY idx ASC, id ASC").all();
}

/**
 * Get a single model by slug.
 */
export function dbGetModel(slug) {
  const db = _db || initAdminDB();
  return db.prepare("SELECT * FROM models WHERE slug = ?").get(slug);
}

/**
 * Add a new model. Returns { ok: true } or { error: string }.
 */
export function dbAddModel(data) {
  const db = _db || initAdminDB();
  const now = Date.now();
  const slug = data.slug || slugify(data.name || "");
  if (!slug) return { error: "name or slug required" };

  // Get next idx
  const maxRow = db.prepare("SELECT MAX(idx) as maxIdx FROM models").get();
  const nextIdx = (maxRow && maxRow.maxIdx !== null) ? maxRow.maxIdx + 1 : 0;

  try {
    db.prepare(
      "INSERT OR IGNORE INTO models (name, slug, base, key, model_id, idx, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)"
    ).run(data.name || "", slug, data.base || "", data.key || "", data.id || "", nextIdx, now, now);
  } catch (e) {
    return { error: e.message };
  }
  bumpVersion("models");
  return { ok: true, slug: slug };
}

/**
 * Update a model by slug.
 */
export function dbUpdateModel(slug, data) {
  const db = _db || initAdminDB();
  const now = Date.now();
  // If name changed and no new slug given, generate new slug
  let newSlug = data.slug || slug;
  if (data.name && !data.slug) {
    // Keep the old slug unless explicitly changed
  }
  db.prepare(
    "UPDATE models SET name=?, slug=?, base=?, key=?, model_id=?, updated_at=? WHERE slug=?"
  ).run(data.name || "", newSlug, data.base || "", data.key || "", data.id || "", now, slug);
  bumpVersion("models");
  return { ok: true };
}

/**
 * Delete a model by slug.
 */
export function dbDeleteModel(slug) {
  const db = _db || initAdminDB();
  db.prepare("DELETE FROM models WHERE slug = ?").run(slug);
  bumpVersion("models");
  return { ok: true };
}

/**
 * Reorder models by providing an array of slugs in the new order.
 */
export function dbReorderModels(slugs) {
  const db = _db || initAdminDB();
  const update = db.prepare("UPDATE models SET idx = ? WHERE slug = ?");
  // Get all current model slugs
  const allSlugs = db.prepare("SELECT slug FROM models ORDER BY idx ASC, id ASC").all().map(r => r.slug);

  // Build the full ordered list: specified slugs first, then remaining in original order
  const specifiedSet = new Set(slugs);
  const remaining = allSlugs.filter(s => !specifiedSet.has(s));
  const fullOrder = [...slugs, ...remaining];

  // Manual transaction
  db.exec("BEGIN");
  try {
    for (let i = 0; i < fullOrder.length; i++) {
      update.run(i, fullOrder[i]);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  bumpVersion("models");
  return { ok: true, sequence: slugs.join(";") };
}

// ═══════════════════════════════════════════════════════════════
//  Config KV CRUD
// ═══════════════════════════════════════════════════════════════

/**
 * Get all config as a plain object (key → parsed value).
 */
export function dbGetConfig() {
  const db = _db || initAdminDB();
  const rows = db.prepare("SELECT key, value FROM config_kv").all();
  const obj = {};
  for (const r of rows) {
    try { obj[r.key] = JSON.parse(r.value); } catch (e) { obj[r.key] = r.value; }
  }
  return obj;
}

/**
 * Get a single config value by key.
 */
export function dbGetConfigKey(key) {
  const db = _db || initAdminDB();
  const row = db.prepare("SELECT value FROM config_kv WHERE key = ?").get(key);
  if (!row) return undefined;
  try { return JSON.parse(row.value); } catch (e) { return row.value; }
}

/**
 * Set a single config key-value pair.
 */
export function dbSetConfigKey(key, value) {
  const db = _db || initAdminDB();
  const now = Date.now();
  db.prepare("INSERT OR REPLACE INTO config_kv (key, value, updated_at) VALUES (?, ?, ?)")
    .run(key, JSON.stringify(value), now);
  bumpVersion("config_kv");
  return { ok: true };
}

/**
 * Set multiple config key-value pairs atomically.
 */
export function dbSetConfigBulk(obj) {
  const db = _db || initAdminDB();
  const now = Date.now();
  const insert = db.prepare("INSERT OR REPLACE INTO config_kv (key, value, updated_at) VALUES (?, ?, ?)");
  // Manual transaction (DatabaseSync doesn't have .transaction())
  db.exec("BEGIN");
  try {
    for (const [k, v] of Object.entries(obj)) {
      insert.run(k, JSON.stringify(v), now);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  bumpVersion("config_kv");
  return { ok: true };
}

/**
 * Delete a config key.
 */
export function dbDeleteConfigKey(key) {
  const db = _db || initAdminDB();
  db.prepare("DELETE FROM config_kv WHERE key = ?").run(key);
  bumpVersion("config_kv");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════
//  Provider Tokens CRUD (for model usage rankings)
// ═══════════════════════════════════════════════════════════════

/**
 * Save a single provider's token count to admin.db.
 */
export function dbSaveProviderToken(name, tokens) {
  const db = _db || initAdminDB();
  const now = Date.now();
  db.prepare(
    "INSERT OR REPLACE INTO provider_tokens (provider_name, total_tokens, updated_at) VALUES (?, ?, ?)"
  ).run(name, tokens, now);
  return { ok: true };
}

/**
 * Get all provider token counts, ordered by total_tokens DESC.
 * Returns [{ provider_name, total_tokens, updated_at }, ...]
 */
export function dbGetAllProviderTokens() {
  const db = _db || initAdminDB();
  return db.prepare("SELECT * FROM provider_tokens ORDER BY total_tokens DESC").all();
}

/**
 * Get a single provider's token count by name.
 * Returns { provider_name, total_tokens, updated_at } or undefined.
 */
export function dbGetProviderToken(name) {
  const db = _db || initAdminDB();
  return db.prepare("SELECT * FROM provider_tokens WHERE provider_name = ?").get(name);
}

/**
 * Bulk save provider tokens (replaces all data).
 * @param {Object} tokenMap - { "providerName": totalTokens, ... }
 */
export function dbBulkSaveProviderTokens(tokenMap) {
  const db = _db || initAdminDB();
  const now = Date.now();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM provider_tokens").run();
    const insert = db.prepare(
      "INSERT INTO provider_tokens (provider_name, total_tokens, updated_at) VALUES (?, ?, ?)"
    );
    for (const [name, tokens] of Object.entries(tokenMap || {})) {
      if (tokens > 0) insert.run(name, tokens, now);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════
//  Version tracking (for middleman change detection)
// ═══════════════════════════════════════════════════════════════

export function getTableVersion(table) {
  const db = _db || initAdminDB();
  const row = db.prepare("SELECT version FROM db_version WHERE table_name = ?").get(table);
  return row ? row.version : 0;
}

export function hasTableChanged(table, sinceVersion) {
  return getTableVersion(table) > sinceVersion;
}

// ═══════════════════════════════════════════════════════════════
//  Slugify helper
// ═══════════════════════════════════════════════════════════════

function slugify(str) {
  if (!str) return "";
  return str.toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}
