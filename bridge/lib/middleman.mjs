/**
 * Middleman — DB → JSON Sync Engine
 *
 * The "middleman" between the admin database and the forwarding proxy.
 *
 * Architecture:
 *   Admin UI → API → admin.db (SQLite)
 *                       ↓ middleman.syncAll()
 *                 models.json + config-proxy.json
 *                       ↓ proxy reads
 *                 Forwarding Proxy (unchanged)
 *
 * How it works:
 *   1. The admin API writes to admin.db via admin-db.mjs
 *   2. After each write, the API calls middleman.syncAll()
 *   3. syncAll() detects which tables changed (via version tracking)
 *   4. For changed tables, it reads from DB and writes the corresponding JSON files
 *   5. After writing, it triggers a proxy reload so the forwarding proxy picks up changes
 *
 * The forwarding proxy never knows about the database. It only reads JSON files.
 * The admin UI never touches JSON files. It only writes to the database.
 * This middleman is the sole bridge between the two.
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { log } from "./logger.mjs";
import { PATHS, CONFIG_PROXY, PORTS } from "./config.mjs";
import {
  initAdminDB, dbGetAllModels, dbGetConfig,
  getTableVersion, hasTableChanged,
} from "./admin-db.mjs";
import { saveConfig } from "./config-store.mjs";

// Track which versions we've already synced
let _lastModelsVer = 0;
let _lastConfigVer = 0;

/**
 * Initialize the middleman. Call once at startup.
 * Does an initial sync from DB → JSON and records the current versions.
 */
export function initMiddleman() {
  initAdminDB();
  _lastModelsVer = getTableVersion("models");
  _lastConfigVer = getTableVersion("config_kv");
  log.info("[middleman] initialized (models_ver=" + _lastModelsVer + ", config_ver=" + _lastConfigVer + ")");
}

/**
 * Sync models from DB → models.json.
 * Rebuilds the entire models.json array from the DB models table.
 */
export function syncModels() {
  const dbModels = dbGetAllModels();
  const modelsArray = dbModels.map(m => ({
    name: m.name,
    slug: m.slug,
    base: m.base,
    key: m.key,
    id: m.model_id,
    models: [m.model_id],
    idx: m.idx,
  }));

  writeJSON(PATHS.models, modelsArray);
  log.info("[middleman] synced " + modelsArray.length + " models → models.json");
}

/**
 * Sync config from DB → config-proxy.json.
 * Rebuilds the entire config-proxy.json from the DB config_kv table,
 * also deriving the fallback_sequence from model ordering.
 */
export function syncConfig() {
  const dbConfig = dbGetConfig();

  // 从所有启用模型获取 slugs
  const dbModels = dbGetAllModels();
  const modelSlugs = dbModels.filter(m => m.enabled).map(m => m.slug);

  // 更新 fallback_sequence：保留现有顺序，追加新模型
  const currentSeq = dbConfig.codex_fallback_sequence || dbConfig.fallback_sequence || "";
  const seqSlugs = currentSeq ? currentSeq.split(";").filter(Boolean) : [];
  // 将不在当前 sequence 中的新模型追加到末尾
  for (const slug of modelSlugs) {
    if (seqSlugs.indexOf(slug) === -1) {
      seqSlugs.push(slug);
    }
  }
  // 剔除已删除的模型（不在 modelSlugs 中的）
  const cleanSeq = seqSlugs.filter(s => modelSlugs.indexOf(s) >= 0);
  dbConfig.codex_fallback_sequence = cleanSeq.join(";");
  dbConfig.fallback_sequence = cleanSeq.join(";");

  // Merge DB config into live CONFIG_PROXY in-place
  // ★ 只更新不删除 — 保留 CONFIG_PROXY 中运行时产生但 DB 尚未同步的键
  // 避免因 syncConfig() 删除运行时键导致状态丢失
  for (const k of Object.keys(dbConfig)) {
    CONFIG_PROXY[k] = dbConfig[k];
  }

  // Also update models.json in-memory reference? No — the proxy reads
  // from provider-registry which gets rebuilt on reload.

  writeJSON(PATHS.configProxy, CONFIG_PROXY);
  // ★ 同步更新 config.db，确保转发平台实时读取最新配置
  try { saveConfig(CONFIG_PROXY); } catch (e) { log.warn("[middleman] saveConfig failed: " + e.message); }
  log.info("[middleman] synced config → config-proxy.json (" + Object.keys(dbConfig).length + " keys)");
}

/**
 * Sync both models and config if they've changed since last sync.
 * Called after every admin API write.
 *
 * @param {boolean} force - If true, sync regardless of version.
 * @returns {boolean} true if anything was synced
 */
export function syncAll(force = false) {
  const modelsVer = getTableVersion("models");
  const configVer = getTableVersion("config_kv");

  let changed = false;

  if (force || modelsVer > _lastModelsVer) {
    syncModels();
    _lastModelsVer = modelsVer;
    changed = true;
    // ★ models 变化时也同步 config（更新 fallback_sequence）
    try { syncConfig(); } catch(e) { log.warn("[middleman] syncConfig failed: " + e.message); }
  }

  if (force || configVer > _lastConfigVer) {
    syncConfig();
    _lastConfigVer = configVer;
    changed = true;
  }

  if (changed) {
    triggerProxyReload();
    triggerProviderReload();
  }

  return changed;
}

/**
 * Trigger the forwarding proxy to reload its config from JSON files.
 */
function triggerProxyReload() {
  try {
    const url = "http://127.0.0.1:" + PORTS.proxy + "/api/reload";
    http.get(url, function (r) { r.resume(); }).on("error", function () { /* proxy not up yet */ });
  } catch (e) { /* silent */ }
}

/**
 * Trigger the config API to re-register custom providers from models.json.
 * This is important because the provider-registry reads from models.json,
 * not from the DB directly.
 */
function triggerProviderReload() {
  try {
    // The config-api server has a reload endpoint on the config port
    // We use an internal HTTP call to trigger re-registration
    const url = "http://127.0.0.1:" + PORTS.config + "/api/reload-providers";
    http.get(url, function (r) { r.resume(); }).on("error", function () { /* not available */ });
  } catch (e) { /* silent */ }
}

/**
 * Write JSON file safely (atomic-ish: write to temp, then rename).
 */
function writeJSON(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    log.warn("[middleman] write failed: " + filePath + " — " + e.message);
    // Fallback: direct write
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (e2) {
      log.error("[middleman] write failed (fallback): " + filePath + " — " + e2.message);
    }
  }
}
