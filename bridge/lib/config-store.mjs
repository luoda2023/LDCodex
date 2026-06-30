/**
 * Config Store — SQLite-backed persistent configuration
 *
 * Replaces config-proxy.json with atomic SQLite writes.
 * - Single-row: stores the entire config as a JSON blob
 * - updated_at tracks version for proxy hot-reload detection
 * - Auto-migrates from config-proxy.json on first run
 *
 * Node 22+ built-in sqlite module (experimental).
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { log } from "./logger.mjs";
import { PATHS } from "./config.mjs";

const DB_PATH = path.join(PATHS.data, "config.db");
const ADMIN_DB_PATH = path.join(PATHS.data, "admin.db");

let _db = null;
let _adminDb = null; // ★ 复用 admin.db 连接
let _cachedConfig = null;
let _cachedVersion = 0;
let _lastCheckTime = 0;
const CHECK_INTERVAL_MS = 100; // 最少每100ms检查一次版本（避免过于频繁）

/**
 * Initialize the database: open, create table, migrate from JSON if needed.
 */
export function initDB() {
  if (_db) return _db;

  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  } catch (e) {
    // directory exists
  }

  _db = new DatabaseSync(DB_PATH);

  // Enable WAL mode for concurrent reads
  _db.exec("PRAGMA journal_mode=WAL");

  // Create config table (single row, id=1)
  _db.exec(`CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    data TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL DEFAULT 0
  )`);

  _db.exec(`CREATE TABLE IF NOT EXISTS token_daily (
    date TEXT PRIMARY KEY,
    neizhi INTEGER NOT NULL DEFAULT 0,
    codex INTEGER NOT NULL DEFAULT 0,
    hermes INTEGER NOT NULL DEFAULT 0
  )`);

  // ★ token_log — 逐条记录（替代 token-log.json）
  _db.exec(`CREATE TABLE IF NOT EXISTS token_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    neizhi INTEGER NOT NULL DEFAULT 0,
    codex INTEGER NOT NULL DEFAULT 0,
    hermes INTEGER NOT NULL DEFAULT 0
  )`);
  _db.exec("CREATE INDEX IF NOT EXISTS idx_token_log_ts ON token_log(ts)");

  // Ensure row exists
  const row = _db.prepare("SELECT id FROM config WHERE id = 1").get();
  if (!row) {
    _db.prepare("INSERT INTO config (id, data, updated_at) VALUES (1, '{}', 0)").run();
  }

  // Try migrate from JSON file
  const existingRow = _db.prepare("SELECT updated_at FROM config WHERE id = 1").get();
  if (!existingRow || !existingRow.updated_at) {
    migrateFromJSON();
  }

  log.info("[config-store] SQLite ready: " + DB_PATH);
  return _db;
}

/**
 * Load config from SQLite. Returns JSON object or null on failure.
 */
export function loadConfig() {
  try {
    const db = _db || initDB();
    const row = db.prepare("SELECT data FROM config WHERE id = 1").get();
    if (row && row.data) {
      return JSON.parse(row.data);
    }
  } catch (e) {
    log.warn("[config-store] load failed: " + e.message);
  }
  return null;
}

/**
 * 获取视觉模型配置（从 SQLite 读取）
 * @returns {{ visionModel: string, visionBase: string, visionKey: string, visionEnabled: boolean } | null}
 */
export function getVisionModelConfig() {
  try {
    const db = _db || initDB();
    const row = db.prepare("SELECT data FROM config WHERE id = 1").get();
    if (row && row.data) {
      const config = JSON.parse(row.data);
      const visionModel = config.vision_model || "";
      const visionBase = config.vision_base || "";
      const visionKey = config.vision_key || "";
      const visionEnabled = !!(visionModel && visionBase && visionKey);
      return { visionModel, visionBase, visionKey, visionEnabled };
    }
  } catch (e) {
    log.warn("[config-store] getVisionModelConfig failed: " + e.message);
  }
  return null;
}

/**
 * Save entire config to SQLite atomically.
 */
export function saveConfig(data) {
  try {
    const db = _db || initDB();
    const jsonStr = JSON.stringify(data || {});
    const now = Date.now();
    db.prepare("UPDATE config SET data = ?, updated_at = ? WHERE id = 1").run(jsonStr, now);
    
    // 更新缓存
    _cachedConfig = data;
    _cachedVersion = now;
    
    log.info("[config-store] config saved to DB (version: " + now + ")");
    return true;
  } catch (e) {
    log.warn("[config-store] save failed: " + e.message);
    return false;
  }
}

/**
 * Get the version timestamp (updated_at) of current config.
 * Returns 0 if no config stored.
 */
export function getConfigVersion() {
  try {
    const db = _db || initDB();
    const row = db.prepare("SELECT updated_at FROM config WHERE id = 1").get();
    return (row && row.updated_at) || 0;
  } catch (e) {
    return 0;
  }
}

/**
 * Check if config has changed since a given version.
 * Returns true if newer version exists in SQLite.
 */
export function hasNewerVersion(sinceVersion) {
  const current = getConfigVersion();
  return current > sinceVersion;
}

/**
 * 检查配置是否已变化，如果变化则重新加载
 * 这是核心函数，每次需要配置时都应该调用
 *
 * 性能优化：
 * 1. 检查时间间隔，避免过于频繁（最少100ms一次）
 * 2. 版本未变化时立即返回
 * 3. 版本变化时，同步重新加载配置
 *
 * @returns {object|null} 最新的配置对象，如果版本未变化则返回缓存的配置
 */
export function checkAndReloadIfNeeded() {
  const now = Date.now();

  // 性能优化：最少每100ms检查一次
  if (now - _lastCheckTime < CHECK_INTERVAL_MS && _cachedConfig) {
    return _cachedConfig;
  }
  _lastCheckTime = now;

  const dbVersion = getConfigVersion();
  if (dbVersion <= _cachedVersion && _cachedConfig) {
    return _cachedConfig; // 版本未变化，返回缓存的配置
  }

  // 版本变化，重新加载配置
  const fresh = loadConfig();
  if (!fresh) return _cachedConfig || null;

  // 更新缓存
  _cachedConfig = fresh;
  _cachedVersion = dbVersion;
  
  log.info("[config-store] config reloaded from DB (version: " + dbVersion + ")");
  return fresh;
}

/**
 * Migrate data from config-proxy.json to SQLite.
 * Only runs if SQLite is empty and JSON file exists.
 */
function migrateFromJSON() {
  try {
    if (!fs.existsSync(PATHS.configProxy)) {
      log.info("[config-store] no JSON file to migrate");
      return;
    }
    const jsonData = fs.readFileSync(PATHS.configProxy, "utf-8");
    const data = JSON.parse(jsonData);
    const now = Date.now();
    _db.prepare("UPDATE config SET data = ?, updated_at = ? WHERE id = 1").run(JSON.stringify(data), now);
    log.info("[config-store] migrated from " + PATHS.configProxy + " (" + Object.keys(data).length + " keys)");
  } catch (e) {
    log.warn("[config-store] migration failed: " + e.message);
  }
}

/**
 * Get or create the admin.db connection (reused).
 */
function getAdminDb() {
  if (!_adminDb) {
    _adminDb = new DatabaseSync(ADMIN_DB_PATH);
    // ★ provider_tokens — 按 provider 累计 token（由 server.mjs 的 recordTokenUsage 写入）
    _adminDb.exec(`CREATE TABLE IF NOT EXISTS provider_tokens (
      provider_name TEXT PRIMARY KEY,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )`);
    _adminDb.exec("PRAGMA journal_mode=WAL");
    _adminDb.exec("PRAGMA synchronous=NORMAL");
  }
  return _adminDb;
}

/**
 * Save provider token usage data to SQLite.
 * Each row: provider name → total tokens
 */
export function saveProviderTokens(tokenMap) {
  try {
    const db = getAdminDb();
    const now = Date.now();
    const upsert = db.prepare(
      "INSERT INTO provider_tokens (provider_name, total_tokens, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(provider_name) DO UPDATE SET " +
      "total_tokens = excluded.total_tokens, " +
      "updated_at = MAX(updated_at, excluded.updated_at)"
    );
    let count = 0;
    for (const key of Object.keys(tokenMap || {})) {
      const val = tokenMap[key];
      if (val > 0) { upsert.run(key, val, now); count++; }
    }
    if (count > 0) log.info("[config-store] provider_tokens merged (" + count + " entries)");
    return true;
  } catch (e) {
    log.warn("[config-store] saveProviderTokens failed: " + e.message);
    return false;
  }
}

/**
 * Load provider token usage data from SQLite.
 * Returns { "providerName": totalTokens, ... }
 */
export function loadProviderTokens() {
  try {
    const db = getAdminDb();
    const rows = db.prepare("SELECT provider_name, total_tokens FROM provider_tokens ORDER BY total_tokens DESC").all();
    const result = {};
    for (const row of rows) {
      // ★ 过滤纯数字的 provider_name（阿里云1/2/3 的 slug="1"/"2"/"3"）
      if (/^\d+$/.test(row.provider_name)) continue;
      result[row.provider_name] = row.total_tokens;
    }
    if (Object.keys(result).length > 0) {
      log.info("[config-store] provider_tokens loaded (" + Object.keys(result).length + " entries)");
    }
    return result;
  } catch (e) {
    log.warn("[config-store] loadProviderTokens failed: " + e.message);
    return {};
  }
}

/**
 * For backwards compatibility: also write to JSON file.
 */
export function saveJSONBackup(data) {
  try {
    fs.writeFileSync(PATHS.configProxy, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    log.warn("[config-store] JSON backup failed: " + e.message);
  }
}

/**
 * Convenience: save a single provider's token count (upsert).
 */
export function saveProviderToken(name, tokens) {
  try {
    const db = getAdminDb();
    const now = Date.now();
    db.prepare(
      "INSERT INTO provider_tokens (provider_name, total_tokens, updated_at) VALUES (?, ?, ?) ON CONFLICT(provider_name) DO UPDATE SET total_tokens = ?, updated_at = ?"
    ).run(name, tokens, now, tokens, now);
    return true;
  } catch (e) {
    log.warn("[config-store] saveProviderToken failed: " + e.message);
    return false;
  }
}

/**
 * Increment a provider's cumulative token count by delta.
 * Unlike saveProviderToken(), this ADDS to the existing total.
 */
export function accumulateProviderToken(name, delta) {
  try {
    if (!name || delta <= 0) return false;
    // ★ 统一转小写，避免 ST44 / st44 大小写重复
    const key = name.trim().toLowerCase();
    const db = getAdminDb();
    const now = Date.now();
    db.prepare(
      "INSERT INTO provider_tokens (provider_name, total_tokens, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(provider_name) DO UPDATE SET " +
      "total_tokens = total_tokens + excluded.total_tokens, updated_at = excluded.updated_at"
    ).run(key, delta, now);
    return true;
  } catch (e) {
    log.warn("[config-store] accumulateProviderToken failed: " + e.message);
    return false;
  }
}

/**
 * Convenience: get all provider token counts.
 * Returns { "providerName": totalTokens, ... }
 */
export function getAllProviderTokens() {
  return loadProviderTokens();
}

/**
 * Convenience: get a single provider's token count.
 * Returns number or 0.
 */
export function getProviderToken(name) {
  try {
    const db = getAdminDb();
    const row = db.prepare("SELECT total_tokens FROM provider_tokens WHERE provider_name = ?").get(name);
    return (row && row.total_tokens) || 0;
  } catch (e) {
    log.warn("[config-store] getProviderToken failed: " + e.message);
    return 0;
  }
}

// ════════════════════════════════════════════════════════════
// ★ 以下为 Token 数据的数据库操作（替代 tokens.json / token-log.json）
// ════════════════════════════════════════════════════════════

/**
 * 获取所有 token_daily 数据（替代 tokens.json 的读取）
 * 返回 { labels: string[], neizhi: number[], codex: number[], hermes: number[] }
 */
export function loadTokenDaily() {
  try {
    const db = getAdminDb();
    const rows = db.prepare("SELECT date, neizhi, codex, hermes FROM token_daily ORDER BY date ASC").all();
    const result = { labels: [], neizhi: [], codex: [], hermes: [] };
    for (const row of rows) {
      result.labels.push(row.date);
      result.neizhi.push(row.neizhi);
      result.codex.push(row.codex);
      result.hermes.push(row.hermes);
    }
    return result;
  } catch (e) {
    log.warn("[config-store] loadTokenDaily failed: " + e.message);
    return { labels: [], neizhi: [], codex: [], hermes: [] };
  }
}

/**
 * 追加或累加某天的 token_daily 数据
 */
export function upsertTokenDaily(date, neizhi, codex, hermes) {
  try {
    const db = getAdminDb();
    db.prepare(
      "INSERT INTO token_daily (date, neizhi, codex, hermes) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(date) DO UPDATE SET " +
      "neizhi = neizhi + excluded.neizhi, " +
      "codex = codex + excluded.codex, " +
      "hermes = hermes + excluded.hermes"
    ).run(date, neizhi, codex, hermes);
    return true;
  } catch (e) {
    log.warn("[config-store] upsertTokenDaily failed: " + e.message);
    return false;
  }
}

/**
 * 写入一条 token_log 记录（替代 token-log.json 的追加）
 */
export function insertTokenLog(ts, neizhi, codex, hermes) {
  try {
    const db = getAdminDb();
    db.prepare("INSERT INTO token_log (ts, neizhi, codex, hermes) VALUES (?, ?, ?, ?)").run(ts, neizhi, codex, hermes);
    return true;
  } catch (e) {
    log.warn("[config-store] insertTokenLog failed: " + e.message);
    return false;
  }
}

/**
 * 批量插入 token_log（性能优化）
 */
export function insertTokenLogBatch(entries) {
  let db;
  try {
    db = getAdminDb();
    const ins = db.prepare("INSERT INTO token_log (ts, neizhi, codex, hermes) VALUES (?, ?, ?, ?)");
    db.exec("BEGIN");
    for (const e of entries) {
      ins.run(e.ts, e.neizhi || 0, e.codex || 0, e.hermes || 0);
    }
    db.exec("COMMIT");
    return true;
  } catch (e) {
    try { if (db) db.exec("ROLLBACK"); } catch(ee) {}
    log.warn("[config-store] insertTokenLogBatch failed: " + e.message);
    return false;
  }
}

/**
 * 查询 token_log（按时间范围，替代 token-log.json 的读取）
 * 返回 [{ ts, neizhi, codex, hermes }]
 */
export function queryTokenLog(sinceTs, limit = 10000) {
  try {
    const db = getAdminDb();
    const rows = db.prepare(
      "SELECT ts, neizhi, codex, hermes FROM token_log WHERE ts >= ? ORDER BY ts ASC LIMIT ?"
    ).all(sinceTs, limit);
    return rows;
  } catch (e) {
    log.warn("[config-store] queryTokenLog failed: " + e.message);
    return [];
  }
}

/**
 * 获取 token_log 的总条数和最新时间
 */
export function getTokenLogStats() {
  try {
    const db = getAdminDb();
    const cnt = db.prepare("SELECT COUNT(*) as cnt FROM token_log").get();
    const last = db.prepare("SELECT MAX(ts) as max_ts FROM token_log").get();
    return { count: cnt ? cnt.cnt : 0, lastTs: last ? last.max_ts : 0 };
  } catch (e) {
    return { count: 0, lastTs: 0 };
  }
}

/**
 * 删除旧 token_log（只保留最近 N 条，清理空间）
 */
export function cleanupTokenLog(keepCount = 10000) {
  try {
    const db = getAdminDb();
    const cnt = db.prepare("SELECT COUNT(*) as cnt FROM token_log").get();
    if (cnt && cnt.cnt > keepCount) {
      const deleteCount = cnt.cnt - keepCount;
      db.prepare("DELETE FROM token_log WHERE id IN (SELECT id FROM token_log ORDER BY id ASC LIMIT ?)").run(deleteCount);
      log.info("[config-store] token_log cleaned: deleted " + deleteCount + " old entries");
    }
    return true;
  } catch (e) {
    log.warn("[config-store] cleanupTokenLog failed: " + e.message);
    return false;
  }
}
