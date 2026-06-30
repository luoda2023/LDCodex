/**
 * Config Module - Unified Configuration Loader
 *
 * Loads .env, models.json, config-proxy.json and provides a centralized
 * configuration object to all other modules.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Load .env manually (zero dependency, no dotenv) ──
function loadEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      // Strip optional quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
    return true;
  } catch (e) {
    if (e.code !== "ENOENT") log.warn("[config] .env load error:", e.message);
    return false;
  }
}

loadEnvFile(path.join(ROOT, ".env"));

// ── File paths ──
export const PATHS = {
  root: ROOT,
  models: path.join(ROOT, "models.json"),
  configProxy: path.join(ROOT, "config-proxy.json"),
  configUI: path.join(ROOT, "config-ui.html"),
  data: path.join(ROOT, "data"),
};

// ── Ports (development defaults) ──
export const PORTS = {
  proxy: parseInt(process.env.PROXY_PORT || "40005", 10),
  config: parseInt(process.env.CONFIG_PORT || "40006", 10),
  admin: parseInt(process.env.ADMIN_PORT || "40007", 10),
};

// ── Proxy auth ──
export const AUTH = (() => {
  const authKey = (process.env.PROXY_AUTH_KEY || "").trim();
  const keysRaw = (process.env.PROXY_KEYS || "").trim();
  const keyTable = new Map();
  const validLocks = new Set(["deepseek", "mimo", "openai", "*"]);

  function parseCsv(str) {
    if (!str) return [];
    return str.split(";").map(s => s.trim()).filter(Boolean);
  }

  for (const entry of parseCsv(keysRaw)) {
    const idx = entry.lastIndexOf(":");
    if (idx === -1) {
      log.warn(`[config] PROXY_KEYS entry missing ':<provider>': "${entry}" - ignored`);
      continue;
    }
    const key = entry.slice(0, idx).trim();
    const provider = entry.slice(idx + 1).trim().toLowerCase();
    if (!key || !validLocks.has(provider)) continue;
    keyTable.set(key, provider);
  }
  if (authKey && !keyTable.has(authKey)) {
    keyTable.set(authKey, "*");
  }

  const mode = (process.env.PROXY_AUTH_MODE || "optional").toLowerCase();
  const enabled = mode !== "disabled" && (mode === "strict" || keyTable.size > 0);

  return { authKey, keyTable, mode, enabled, validLocks };
})();

// ── Upstream timeout (LDCodex 只使用 models.json 中配置的模型) ──
export const UPSTREAM = {
  upstreamTimeout: parseInt(process.env.UPSTREAM_TIMEOUT_MS || "60000", 10),
  codexMaxTokens: parseInt(process.env.CODEX_MAX_TOKENS || "8192", 10),
};

function parseCsv(str) {
  if (!str) return [];
  return str.split(",").map(s => s.trim()).filter(Boolean);
}

// ── Dynamic concurrency settings ──
export const DYN_CONCURRENCY = {
  min: parseInt(process.env.DYN_LIMIT_MIN || "2", 10),
  max: parseInt(process.env.DYN_LIMIT_MAX || "6", 10),
  targetLatency: parseInt(process.env.DYN_TARGET_LATENCY || "20000", 10),
  tuneInterval: parseInt(process.env.DYN_TUNE_INTERVAL || "15000", 10),
};

// ── Load JSON data files ──
export function loadJSON(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (e) {
    if (e.code !== "ENOENT") log.warn(`[config] load ${filePath}: ${e.message}`);
    return fallback;
  }
}

export function saveJSON(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    // Also save to SQLite when saving config-proxy.json
    if (filePath === PATHS.configProxy) {
      import("./config-store.mjs").then(function(mod) {
        try {
          mod.initDB();
          mod.saveConfig(data);
          mod.saveJSONBackup(data);
        } catch(e) { /* silent */ }
      }).catch(function() { /* sqlite not available */ });
    }
    return true;
  } catch (e) {
    log.warn(`[config] save ${filePath}: ${e.message}`);
    return false;
  }
}

// ── Load models & config (SQLite first, JSON fallback) ──
export const MODELS = loadJSON(PATHS.models, []);

// Try SQLite store first, fall back to JSON file
let _configVersion = 0;
let _configFromSQLite = false;

async function loadConfigFromStore() {
  try {
    const { initDB, loadConfig } = await import("./config-store.mjs");
    initDB();
    const sqliteData = loadConfig();
    if (sqliteData && Object.keys(sqliteData).length > 0) {
      _configFromSQLite = true;
      _configVersion = Date.now();
      return sqliteData;
    }
  } catch (e) {
    // SQLite not available or empty — fall through to JSON
  }
  return null;
}

// Use a sync-like initialization: try import, but if it fails async, fall back to JSON
let sqliteConfig = null;
try {
  // Attempt sync-style — but since import() is async, this won't work in module scope
  // We use a top-level await instead
} catch(e) {}

// Top-level await for SQLite init
const _initPromise = (async () => {
  sqliteConfig = await loadConfigFromStore();
})();
// In module scope, this initializes async — other imports may see JSON first
// CONFIG_PROXY will be updated when SQLite data arrives
export const CONFIG_PROXY = loadJSON(PATHS.configProxy, {});

// Async update: when SQLite data is ready, merge into CONFIG_PROXY
_initPromise.then(() => {
  if (sqliteConfig) {
    for (const k of Object.keys(sqliteConfig)) {
      if (k === '_countdown_start') continue; // ★ 运行时变量
      CONFIG_PROXY[k] = sqliteConfig[k];
    }
    _configVersion = Date.now();
    log.info("[config] SQLite config loaded (" + Object.keys(sqliteConfig).length + " keys)");
  }
}).catch(function(e) {
  log.warn("[config] SQLite merge error: " + e.message);
});

/**
 * Reload config from SQLite into the live CONFIG_PROXY object.
 * Safe to call at any time — all modules see the updated properties.
 * Returns true if config was updated, false if same version or SQLite not available.
 */
export async function reloadConfig() {
  try {
    const { initDB, loadConfig, getConfigVersion } = await import("./config-store.mjs");
    initDB();
    const newVersion = getConfigVersion();
    if (newVersion <= _configVersion) return false;

    const fresh = loadConfig();
    if (!fresh || Object.keys(fresh).length === 0) return false;

    // Update CONFIG_PROXY in-place so all live references see the change
    const keys = new Set([...Object.keys(CONFIG_PROXY), ...Object.keys(fresh)]);
    for (const k of keys) {
      if (k === '_countdown_start') continue; // ★ 运行时变量，不受 DB 影响
      // ★ 如果运行时标记锁已被 fallback 清除，跳过 DB 中的旧值
      if ((k === 'single_model_codex' || k === 'single_model_hermes') && CONFIG_PROXY._lockClearedByFallback) continue;
      if (fresh[k] !== undefined) {
        CONFIG_PROXY[k] = fresh[k];
      } else {
        delete CONFIG_PROXY[k];
      }
    }
    _configVersion = newVersion;
    _configFromSQLite = true;
    log.info("[config] reloaded from SQLite (" + Object.keys(fresh).length + " keys)");
    return true;
  } catch (e) {
    log.warn("[config] reload failed: " + e.message);
    return false;
  }
}

// ── Slugify helper (preserved from original) ──
export function slugify(str) {
  if (!str) return "";
  const pinyinMap = {
    '\u5c1a':'shang','\u7cd6':'tang','u5802':'tang','\u7845':'gui','\u57fa':'ji',
    '\u6d41':'liu','\u52a8':'dong','\u6a21':'mo','\u578b':'xing','\u6df1':'shen',
    '\u5ea6':'du','\u95ea':'shan','\u706b':'huo','\u6708':'yue','\u661f':'xing',
    '\u4e91':'yun','\u5c71':'shan','\u8c37':'gu','\u963f':'a','\u91cc':'li',
    '\u817e':'teng','\u7f51':'wang','\u8c61':'xiang'
  };
  let r = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str.charAt(i);
    if (pinyinMap[ch]) r += pinyinMap[ch];
    else if (/[a-zA-Z0-9]/.test(ch)) r += ch;
    else r += '\\u' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
  }
  return r.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
}

// ★ 调试陷阱：拦截 _countdown_start 的所有写入，定位来源
let _countdown_start_value = CONFIG_PROXY._countdown_start;
Object.defineProperty(CONFIG_PROXY, '_countdown_start', {
  get() { return _countdown_start_value; },
  set(v) {
    var st = new Error().stack;
    var caller = (st && st.split ? st.split('\n').slice(2,5).join(' | ') : 'unknown');
    console.error('[countdown-trap] _countdown_start set to ' + v + ' caller=' + caller);
    _countdown_start_value = v;
  },
  configurable: true,
  enumerable: true,
});
