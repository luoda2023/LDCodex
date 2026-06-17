import http from "node:http";
import https from "node:https";





import crypto from "node:crypto";




import fs from "node:fs";




import { execSync } from "node:child_process";




import path from "node:path";




import { fileURLToPath } from "node:url";




import dotenv from "dotenv";

import { withSlot, acquireSlot, releaseSlot, getDynMetrics, DYNAMIC_ENABLED, triggerHotRestart, getDrainState } from "./dynamic_limiter.mjs";




dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env') });









// ── Atomic JSON write: write to tmp, then rename (crash-safe) ──




const _atomicWriteCache = new Map(); // path → last written content (for no-op optimization)




function atomicWriteJsonFile(filePath, data) {




  var json = JSON.stringify(data, null, 2);




  // Skip if content unchanged (avoid pointless writes)




  var cached = _atomicWriteCache.get(filePath);




  if (cached === json) return true;




  var dir = path.dirname(filePath);




  var tmp = path.join(dir, '.' + path.basename(filePath) + '.tmp_' + process.pid);




  try {




    fs.writeFileSync(tmp, json, 'utf-8');




    fs.renameSync(tmp, filePath);        // atomic on POSIX; close enough on Windows




    _atomicWriteCache.set(filePath, json);




    return true;




  } catch(e) {




    log.warn('[atomic-write] error on ' + filePath + ':', e.message);




    try { fs.unlinkSync(tmp); } catch(_) {}




    return false;




  }




}









// ── Throttle: minimum ms between writes for high-frequency state ──




var lastHealthPersist = 0;




const HEALTH_PERSIST_INTERVAL_MS = 10000; // at most once every 10s









// ── Flush all state on graceful exit ──




function flushAllState() {




  try {




    var raw = fs.readFileSync(CONFIG_PROXY_FILE, 'utf-8');




    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);




    var cur = JSON.parse(raw);




    cur._fallbackState = fallbackState;




    cur._providerHealth = providerHealth;




    cur._abnormalModels = Array.from(abnormalModels);




    delete cur._enabledProviders;




    atomicWriteJsonFile(CONFIG_PROXY_FILE, cur);




    log.info('[flush] all state persisted on exit');




  } catch(e) { log.warn('[flush] exit flush error:', e.message); }




}




process.on('beforeExit', flushAllState);




process.on('SIGTERM', () => { flushAllState(); process.exit(0); });




process.on('SIGINT',  () => { flushAllState(); process.exit(0); });









process.on("uncaughtException", (err) => {




  log.error("[proxy] uncaught exception:", err.message);




});




process.on("unhandledRejection", (err) => {




  log.error("[proxy] unhandled rejection:", err.message || err);




});









const PORT = process.env.PROXY_PORT || 40000;









// === Logging ===




//




// LOG_LEVEL = silent | error | warn | info (default) | debug




//   silent: nothing




//   error : only console.error wrappers




//   warn  : + warnings




//   info  : + business + access logs (default)




//   debug : + verbose internal traces




// ACCESS_LOG=0 separately suppresses just the per-request access lines.




const LOG_LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };




const LOG_LEVEL = LOG_LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] ?? LOG_LEVELS.info;




const ACCESS_LOG_ON = process.env.ACCESS_LOG !== "0" && LOG_LEVEL >= LOG_LEVELS.info;




const log = {




  error: (...a) => { if (LOG_LEVEL >= LOG_LEVELS.error) console.error(...a); },




  warn:  (...a) => { if (LOG_LEVEL >= LOG_LEVELS.warn)  console.warn(...a); },




  info:  (...a) => { if (LOG_LEVEL >= LOG_LEVELS.info)  console.log(...a); },




  debug: (...a) => { if (LOG_LEVEL >= LOG_LEVELS.debug) console.log(...a); },




  access: (...a) => { if (ACCESS_LOG_ON) console.log(...a); },




};









// === Auto-reload models.json on file change ===




// Track file mtime to detect changes without manual restart




function checkAndReloadModels() {




  try {




    const stats = fs.statSync(MODELS_FILE);




    if (stats.mtimeMs > lastModelsJsonMtime) {




      log.info('[reload] models.json changed - reloading providers...');




      lastModelsJsonMtime = stats.mtimeMs;




      // Clear require cache and reload




      const key = require.resolve(MODELS_FILE);




      delete require.cache[key];




      // Replace MODELS array contents in-place




      const newModels = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf-8'));




      MODELS.length = 0;




      MODELS.push(...newModels);




      rebuildModelProviderMap();




      injectDynamicProviders();




      log.info('[reload] done. ' + MODELS.length + ' providers ready.');




    }




  } catch(e) { /* ignore */ }




}









// === Inbound auth ===




//




// Two env vars, both optional:




//




//   PROXY_AUTH_KEY=sk-xxx                       (legacy, single key, no provider lock)




//   PROXY_KEYS=sk-aaa:deepseek,sk-bbb:mimo,sk-ccc:*   (table, optional provider lock)




//




// Each key in the table either:




//   - locks the request to one provider ("deepseek" / "mimo" / "openai") - body.model




//     must resolve to that provider, otherwise 401. If body.model is empty, the




//     provider's default model is used.




//   - is a wildcard ("*") - model field decides routing, same as legacy behaviour.




//




// PROXY_AUTH_KEY (if set) is appended as a wildcard entry, so existing single-key




// setups keep working untouched.




//




// If both env vars are empty, inbound auth is DISABLED - anyone on localhost can




// hit the proxy. /health is always exempt regardless.









const PROXY_AUTH_KEY = (process.env.PROXY_AUTH_KEY || "").trim();




const PROXY_KEYS_RAW = (process.env.PROXY_KEYS || "").trim();









// Map<key, provider | "*">




const PROXY_KEY_TABLE = new Map();




const VALID_LOCK_PROVIDERS = new Set(["deepseek", "mimo", "openai", "*"]);









function loadProxyKeyTable() {




  for (const entry of parseCsv(PROXY_KEYS_RAW)) {




    const idx = entry.lastIndexOf(":");




    if (idx === -1) {




      log.warn(`[proxy] PROXY_KEYS entry missing ':<provider>': "${entry}" - ignored`);




      continue;




    }




    const key = entry.slice(0, idx).trim();




    const provider = entry.slice(idx + 1).trim().toLowerCase();




    if (!key) {




      log.warn(`[proxy] PROXY_KEYS entry has empty key - ignored`);




      continue;




    }




    if (!VALID_LOCK_PROVIDERS.has(provider)) {




      log.warn(`[proxy] PROXY_KEYS entry has unknown provider "${provider}" (allowed: deepseek, mimo, openai, *) - ignored`);




      continue;




    }




    if (PROXY_KEY_TABLE.has(key)) {




      log.warn(`[proxy] PROXY_KEYS entry duplicates key "${key.slice(0, 12)}..." - last wins`);




    }




    PROXY_KEY_TABLE.set(key, provider);




  }




  if (PROXY_AUTH_KEY) {




    if (!PROXY_KEY_TABLE.has(PROXY_AUTH_KEY)) PROXY_KEY_TABLE.set(PROXY_AUTH_KEY, "*");




  }




}




loadProxyKeyTable();









// AUTH_MODE: 'strict' | 'optional' (default) | 'disabled'




// strict = require auth for all requests; optional = allow empty/unregistered keys as wildcard




const PROXY_AUTH_MODE = (process.env.PROXY_AUTH_MODE || "optional").toLowerCase();




const PROXY_AUTH_ENABLED = (PROXY_AUTH_MODE === "strict" || PROXY_KEY_TABLE.size > 0);




let __lastSwitchNotificationTs = 0; // throttle timestamp for switching notifications (ms)




const SWITCH_NOTIFY_INTERVAL_MS = 60 * 1000; // emit switch notification at most once per 60s









const DEEPSEEK_BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";




const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || "";




const DEEPSEEK_MODELS = parseCsv(process.env.DEEPSEEK_MODELS || "deepseek-v4-pro,deepseek-v4-flash");









const MIMO_BASE = process.env.MIMO_BASE_URL || "https://token-plan-cn.xiaomimimo.com/v1";




const MIMO_KEY = process.env.MIMO_API_KEY || "";




const MIMO_MODELS = parseCsv(process.env.MIMO_MODELS || "mimo-v2.5-pro");









const OPENAI_BASE = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";




const OPENAI_KEY = process.env.OPENAI_API_KEY || "";




// Default empty - OpenAI is opt-in, set OPENAI_MODELS or OPENAI_API_KEY explicitly to enable.




const OPENAI_MODELS = parseCsv(process.env.OPENAI_MODELS || "");




const OPENAI_MODEL_PREFIXES = parseCsv(process.env.OPENAI_MODEL_PREFIXES || "gpt-,o1,o3,o4,codex-,chatgpt-");









const DEFAULT_PROVIDER = (process.env.DEFAULT_PROVIDER || "").trim().toLowerCase();









// GitHub token is fetched lazily on first github.com web_fetch call so we don't




// pay the gh-CLI startup cost during proxy boot. Sentinel "unresolved" means




// "haven't checked yet"; "" means "checked, none available".




let _githubToken = process.env.GITHUB_TOKEN || null; // null = not yet resolved




function getGithubToken() {




  if (_githubToken !== null) return _githubToken;




  try { _githubToken = execSync("gh auth token", { encoding: "utf-8", timeout: 3000 }).trim(); }




  catch { _githubToken = ""; }




  return _githubToken;




}









if (!DEEPSEEK_KEY && !OPENAI_KEY && !MIMO_KEY) {




  console.error("At least one upstream provider key is required: set DEEPSEEK_API_KEY, MIMO_API_KEY, and/or OPENAI_API_KEY");




  process.exit(1);




}









var __dirname_ = path.dirname(fileURLToPath(import.meta.url));









// -- models.json provider loading --




const MODELS_FILE = path.join(__dirname_, "models.json");




// Initialize mtime tracker after MODELS_FILE is defined




let lastModelsJsonMtime = fs.statSync(MODELS_FILE).mtimeMs;




const CONFIG_PROXY_FILE = path.join(__dirname_, "config-proxy.json");




const CONFIG_UI_FILE = path.join(__dirname_, "config-ui.html");




const AUTH_FILE = path.join(__dirname_, "..", ".codex", "auth.json");









function loadModelsJson() {




  try { return JSON.parse(fs.readFileSync(MODELS_FILE, "utf-8")); }




  catch(e) { log.warn("[models] loadModelsJson:", e.message); return []; }




}









function isBuiltin(name) {
  return !MODELS.some(function(m) { return (m.name || "").toLowerCase() === (name || "").toLowerCase(); });
}

function slugify(str) {




  if (!str) return "";




  var pinyinMap = {




    '\u5c1a':'shang','\u7cd6':'tang','\u5802':'tang','\u7845':'gui','\u57fa':'ji',




    '\u6d41':'liu','\u52a8':'dong','\u6a21':'mo','\u578b':'xing','\u6df1':'shen',




    '\u5ea6':'du','\u95ea':'shan','\u706b':'huo','\u6708':'yue','\u661f':'xing',




    '\u4e91':'yun','\u5c71':'shan','\u8c37':'gu','\u963f':'a','\u91cc':'li',




    '\u817e':'teng','\u7f51':'wang','\u8c61':'xiang'




  };




  var r = '';




  for (var i = 0; i < str.length; i++) {




    var ch = str.charAt(i);




    if (pinyinMap[ch] !== undefined) r += pinyinMap[ch];




    else if (/[a-zA-Z0-9]/.test(ch)) r += ch;




    else r += '\\u' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');




  }




  return r.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);




}









function loadConfigProxy() {




  try { return JSON.parse(fs.readFileSync(CONFIG_PROXY_FILE, "utf-8")); }




  catch(e) { log.warn("[config] loadConfigProxy:", e.message); return {}; }




}









const MODELS = loadModelsJson();









// Repair GBK→UTF-8 double-encoding mojibake in model names at startup.




// PowerShell writes JSON in GBK; Node.js reads it as UTF-8 → Chinese chars become




// sequences like "ÃYÃ»Ã\u008B" or "é\u0082\u0093é\u0080\u008B".




// When detected, replace the garbled name with the ASCII slug and persist the fix.




(function repairModelsEncoding() {




  var fixed = false;




  for (const m of MODELS) {




    var name = m.name || '';




    // Detect mojibake: common signs are 'Ã' (from Latin-1→UTF-8 double-encode of Chinese)




    // or 'é'/'è' etc. appearing in what should be Chinese characters.




    // Heuristic: if the name contains 'Ã' (ASCII 195 132 = C3 84) and has no normal




    // Chinese unicode ranges (U+4E00-U+9FFF), treat as garbled.




    var hasGarbled = /Ã/.test(name) || /[^\u0000-\u007F]/.test(name) && !/[\u4e00-\u9fff]/.test(name);




    if (hasGarbled && m.slug) {




      log.info('[repair] fixing garbled name "' + name + '" → "' + m.slug + '" for slug=' + m.slug);




      m.name = m.slug;




      fixed = true;




    }




  }




  if (fixed) {




    try {




      fs.writeFileSync(MODELS_FILE, JSON.stringify(MODELS, null, 2), 'utf-8');




      log.info('[repair] models.json updated with fixed names');




    } catch(e) { log.warn('[repair] failed to write models.json:', e.message); }




  }




})();




const CONFIG_PROXY = loadConfigProxy();









// providerHealth - tracks per-provider consecutive failures for circuit breaker




var providerHealth = {};









// providerSuccessTs - records last successful request timestamp per provider




var providerSuccessTs = {};









// Build provider map from models.json




const modelProviderMap = new Map();




function rebuildModelProviderMap() {




  modelProviderMap.clear();




  for (const m of MODELS) {




    const nameKey = (m.name || "").toLowerCase();




    const slugKey = (m.slug || "").toLowerCase();




    const entry = { base: m.base, key: m.key, modelId: m.id || "", slug: m.slug || "" };




    // Register both name and slug as keys so e.g. "7" and "智谱7" both work




    if (nameKey && m.base && m.key) {




      modelProviderMap.set(nameKey, entry);




      if (slugKey && slugKey !== nameKey) {




        modelProviderMap.set(slugKey, entry);




      }




    }




  }




}




rebuildModelProviderMap();




initProviderHealth();









let FALLBACK_ENABLED = CONFIG_PROXY.fallback_enabled !== false;




let COND_SWITCH_ENABLED = (CONFIG_PROXY.cond_switch_enabled !== undefined) ? CONFIG_PROXY.cond_switch_enabled : (CONFIG_PROXY.disable_condition_switch !== false);




let disabledBuiltins = CONFIG_PROXY.disabled_builtins || [];




let FALLBACK_SEQUENCE_RAW = CONFIG_PROXY.fallback_sequence || "";




let SINGLE_MODEL_CODEX = CONFIG_PROXY.single_model_codex || "";




let SINGLE_MODEL_HERMES = CONFIG_PROXY.single_model_hermes || "";




let VIRTUAL_MODEL_ID = (CONFIG_PROXY.virtual_model_id || "").toLowerCase();




// Last request per client




let LAST_REQUEST = { model: null, provider: null, ts: 0 };




let LAST_REQUEST_CODEX = { model: null, provider: null, ts: 0 };




let LAST_REQUEST_HERMES = { model: null, provider: null, ts: 0 };




// Recent error events for UI display (last 5 per client)




let LAST_ERRORS_CODEX = [];




let LAST_ERRORS_HERMES = [];




const MAX_ERROR_HISTORY = 5;









// Detect which client (CODEX or HERMES) is making the request via X-Client-ID header.




// CODEX Desktop does not send this header by default.




// HERMES Agent can be configured to send it (e.g. via OpenAI compatible `extra_headers`).




// If no header present, defaults to 'CODEX'.




function getClientFromReq(req) {




  var client = (req.headers['x-client-id'] || '').toLowerCase().trim();




  if (client === 'hermes') return 'HERMES';




  if (client === 'codex') return 'CODEX';




  // No explicit header: infer from which single-model config is active.




  // If only HERMES is configured (CODEX is not), assume anonymous requests are from HERMES.




  if (!SINGLE_MODEL_CODEX && SINGLE_MODEL_HERMES) return 'HERMES';




  return 'CODEX';




}




function touchLastRequest(req, model, provider) {




  var entry = { model: model, provider: provider, ts: Date.now() };




  LAST_REQUEST = entry;




  var rawHdr = req.headers['x-client-id'] || '(none)';




  log.info('[touchLastRequest] x-client-id="' + rawHdr + '" client=' + getClientFromReq(req) + ' model=' + model + ' provider=' + provider);




  var client = getClientFromReq(req);




  if (client === 'HERMES') LAST_REQUEST_HERMES = entry;




  else LAST_REQUEST_CODEX = entry;




}




// Record an error event for the given client (CODEX or HERMES)




function recordError(clientId, provider, status, bodyText) {




  var entry = { provider: provider, status: status, message: bodyText, ts: Date.now() };




  if (clientId === 'HERMES') {




    LAST_ERRORS_HERMES.unshift(entry);




    if (LAST_ERRORS_HERMES.length > MAX_ERROR_HISTORY) LAST_ERRORS_HERMES.pop();




  } else {




    LAST_ERRORS_CODEX.unshift(entry);




    if (LAST_ERRORS_CODEX.length > MAX_ERROR_HISTORY) LAST_ERRORS_CODEX.pop();




  }




}









// Parse fallback sequence




const fallbackChain = [];









// Custom error to signal fallback retry on quota/rate-limit




class FallbackSkipError extends Error {




  constructor(provider, status, body) {




    super(`FallbackSkip: ${provider} (${status})`);




    this.name = 'FallbackSkipError';




    this.provider = provider;




    this.status = status;




    this.body = body;




  }




}









// ============================================================




// FALLBACK CHAIN




// ============================================================




// Build module-level fallbackChain at startup from config




(function buildStartupChain() {




  if (!FALLBACK_SEQUENCE_RAW) return;




  var __nl = {}; var __di = {};




  MODELS.forEach(function(m) {




    var n = m.name || '', s = m.slug || '';




    var idx = typeof m.idx === 'number' ? m.idx : 0;




    if (n) { __nl[n.toLowerCase()] = n; __di[n.toLowerCase()] = idx; }




    if (s && n) { __nl[s.toLowerCase()] = s; __di[s.toLowerCase()] = idx; }




    if (s && !n) { __nl[s.toLowerCase()] = s; __di[s.toLowerCase()] = idx; }




  });




  FALLBACK_SEQUENCE_RAW.split(";").forEach(function(entry) {




    var parts = entry.split("|");




    var rawName = (parts[0] || '').trim();




    var modelId = parts[1] ? parts[1].trim() : '';




    var resolvedName = __nl[rawName.toLowerCase()] || rawName;




    var displayIdx = __di[rawName.toLowerCase()] || 0;




    if (resolvedName) {




      if (parts.length >= 2) fallbackChain.push({ name: resolvedName, model: modelId, displayIdx: displayIdx, raw: entry });




      else fallbackChain.push({ name: resolvedName, model: '', displayIdx: displayIdx, raw: entry });




    }




  });




})();









// Sync module-level fallbackChain after FALLBACK_SEQUENCE_RAW changes (e.g., after drag-drop save)




function syncFallbackChain() {




  fallbackChain.length = 0; // clear in-place so const array stays valid




  if (!FALLBACK_SEQUENCE_RAW) return;




  var __nl = {}; var __di = {};




  MODELS.forEach(function(m) {




    var n = m.name || '', s = m.slug || '';




    var idx = typeof m.idx === 'number' ? m.idx : 0;




    if (n) { __nl[n.toLowerCase()] = n; __di[n.toLowerCase()] = idx; }




    if (s && n) { __nl[s.toLowerCase()] = s; __di[s.toLowerCase()] = idx; }




    if (s && !n) { __nl[s.toLowerCase()] = s; __di[s.toLowerCase()] = idx; }




  });




  FALLBACK_SEQUENCE_RAW.split(";").forEach(function(entry) {




    var parts = entry.split("|");




    var rawName = (parts[0] || '').trim();




    var modelId = parts[1] ? parts[1].trim() : '';




    var resolvedName = __nl[rawName.toLowerCase()] || rawName;




    var displayIdx = __di[rawName.toLowerCase()] || 0;




    if (resolvedName) {




      if (parts.length >= 2) fallbackChain.push({ name: resolvedName, model: modelId, displayIdx: displayIdx, raw: entry });




      else fallbackChain.push({ name: resolvedName, model: '', displayIdx: displayIdx, raw: entry });




    }




  });




}









// Fallback state machine




// Load persisted fallback state from disk (survives restarts)




var __savedState = null;




try {




  var __cfg = JSON.parse(fs.readFileSync(CONFIG_PROXY_FILE, 'utf-8'));




  __savedState = __cfg._fallbackState || null;




} catch(e) { /* ignore */ }




let fallbackState = __savedState || { currentIdx: 0, codexIdx: 0, hermesIdx: 1, builtinSince: null, lastReset: null };




if (typeof fallbackState.codexIdx !== 'number') fallbackState.codexIdx = 0;




if (typeof fallbackState.hermesIdx !== 'number') fallbackState.hermesIdx = 1;




// Migrate codexIdx/hermesIdx from displayIdx (buggy pre-fix values) to array index.




// Build a temporary displayIdx→arrayIndex map from FALLBACK_SEQUENCE_RAW + MODELS.




if (FALLBACK_SEQUENCE_RAW && MODELS && MODELS.length > 0) {




  var __migDi = {}; // nameLower → displayIdx




  MODELS.forEach(function(m) {




    var n = m.name || '', s = m.slug || '';




    var idx = typeof m.idx === 'number' ? m.idx : 0;




    if (n) __migDi[n.toLowerCase()] = idx;




    if (s && n) __migDi[s.toLowerCase()] = idx;




    if (s && !n) __migDi[s.toLowerCase()] = idx;




  });




  var __migChain = []; // array of { displayIdx, nameLower }




  FALLBACK_SEQUENCE_RAW.split(";").forEach(function(entry) {




    var parts = entry.split("|");




    var rawName = (parts[0] || '').trim();




    var displayIdx = __migDi[rawName.toLowerCase()] || 0;




    __migChain.push({ displayIdx: displayIdx, nameLower: rawName.toLowerCase() });




  });




  // Migrate codexIdx: if stored displayIdx doesn't match chain[codexIdx].displayIdx, find correct array index




  var curCodex = fallbackState.codexIdx;




  if (__migChain[curCodex] && __migChain[curCodex].displayIdx !== __migDi[__migChain[curCodex].nameLower]) {




    // stored index doesn't point to correct displayIdx — find correct position




    var targetDisplay = curCodex;




    var correctIdx = __migChain.findIndex(function(e) { return e.displayIdx === targetDisplay; });




    if (correctIdx >= 0) { fallbackState.codexIdx = correctIdx; log.info('[migrate] codexIdx', curCodex, '->', correctIdx); }




  }




  var curHermes = fallbackState.hermesIdx;




  if (__migChain[curHermes] && __migChain[curHermes].displayIdx !== __migDi[__migChain[curHermes].nameLower]) {




    var targetDisplayH = curHermes;




    var correctIdxH = __migChain.findIndex(function(e) { return e.displayIdx === targetDisplayH; });




    if (correctIdxH >= 0) { fallbackState.hermesIdx = correctIdxH; log.info('[migrate] hermesIdx', curHermes, '->', correctIdxH); }




  }




}




// Clear stale builtin circuit-breaker on startup (survives restarts)




if (fallbackState.builtinSince && Date.now() - fallbackState.builtinSince > (CONFIG_PROXY.builtin_reset_minutes || 5) * 60000) {




  fallbackState.builtinSince = null;




  fallbackState.lastProviderSwitch = fallbackState.lastProviderSwitch || Date.now();




  persistFallbackState();




}




// ============================================================




// ============================================================




// HEALTH CHECK - background probe for all providers




// Skips unhealthy providers so user requests never hit dead nodes.




// ============================================================









const HEALTH = {




  INTERVAL_MS:      30000,   // probe every 30s




  MAX_FAILURES:     999999,  // disabled - set to high so unhealthy marking never triggers      // 3 consecutive failures → unhealthy




  RECOVERY_MS:      60000,  // after being unhealthy, try again after 60s




  REQUEST_TIMEOUT:  8000,  // 8s per probe




};









// Abnormal detection: 3 consecutive request failures within 48h → mark abnormal, exclude from rotation




const ABNORMAL_MAX_FAILURES = 3;




const ABNORMAL_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours









// abnormalModels Set: manually flagged/abnormal providers excluded from fallback rotation




var abnormalModels = new Set();









function setAbnormal(slug, flag) {
  if (flag) {
    abnormalModels.add(slug);
    var __slug = slug.toLowerCase();
    var __parts = (FALLBACK_SEQUENCE_RAW || "").split(";");
    var __filtered = __parts.filter(function(s) { return s.toLowerCase() !== __slug; });
    if (__filtered.length !== __parts.length) {
      FALLBACK_SEQUENCE_RAW = __filtered.join(";");
      syncFallbackChain();
      log.warn("[abnormal] " + slug + " removed from fallback sequence");
    }
  } else {
    abnormalModels.delete(slug);
    if (FALLBACK_SEQUENCE_RAW) {
      var __existing = FALLBACK_SEQUENCE_RAW.split(";");
      var __exists = __existing.some(function(s) { return s.toLowerCase() === slug.toLowerCase(); });
      if (!__exists) {
        __existing.push(slug);
        FALLBACK_SEQUENCE_RAW = __existing.join(";");
        syncFallbackChain();
        log.info("[abnormal] " + slug + " restored to fallback sequence");
      }
    }
  }
  persistAbnormalModels();
}









function persistAbnormalModels() {




  try {




    var raw = fs.readFileSync(CONFIG_PROXY_FILE, 'utf-8');




    // Strip UTF-8 BOM if present (some editors/scripts write EF BB BF)




    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);




    var cur = JSON.parse(raw);




    cur._abnormalModels = Array.from(abnormalModels);




    // Do NOT persist _enabledProviders — it accumulates corrupted Chinese names and




    // breaks enabledProviders state on restart. Providers are rebuilt from models.json




    // via injectDynamicProviders() every startup.




    delete cur._enabledProviders;




    atomicWriteJsonFile(CONFIG_PROXY_FILE, cur);




  } catch(e) { log.warn('[abnormal] persist error:', e.message); }




}









// providerHealth[providerName] = { consecutiveFailures, firstFailureAt, lastCheck, lastSuccess, status }




// status: 'healthy' | 'unhealthy' | 'unknown' | 'abnormal'




// 'abnormal' = excluded from rotation until manually restored via API









function initProviderHealth() {




  for (const m of MODELS) {




    const key = (m.name || "").toLowerCase();




    if (key) providerHealth[key] = { consecutiveFailures: 0, firstFailureAt: null, lastCheck: null, lastSuccess: null, status: 'unknown' };




  }




  // Load persisted health state




  try {




    var saved = JSON.parse(fs.readFileSync(CONFIG_PROXY_FILE, 'utf-8'));




    if (saved._providerHealth) {




      for (const [k, v] of Object.entries(saved._providerHealth)) {




        if (providerHealth[k]) providerHealth[k] = v;




      }




    }




    // Load abnormal models list




    if (saved._abnormalModels && Array.isArray(saved._abnormalModels)) {




      saved._abnormalModels.forEach(function(k) { abnormalModels.add(k); });




    }




  } catch(e) {}




}









function persistHealthState() {




  var now = Date.now();




  if (now - lastHealthPersist < HEALTH_PERSIST_INTERVAL_MS) return;




  lastHealthPersist = now;




  try {




    var raw = fs.readFileSync(CONFIG_PROXY_FILE, 'utf-8');




    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);




    var cur = JSON.parse(raw);




    cur._providerHealth = providerHealth;




    delete cur._enabledProviders;




    atomicWriteJsonFile(CONFIG_PROXY_FILE, cur);




  } catch(e) { log.warn('[health] persist error:', e.message); }




}









function healthCheckProvider(name, base, key) {
  return new Promise((resolve) => {
    var url = (base || '').replace(/\/$/, '') + '/models';
    var httpMod = url.indexOf('https://') === 0 ? https : http;
    var req = httpMod.get(url, { headers: { 'Authorization': 'Bearer ' + key, 'User-Agent': 'LUODA-healthcheck/1.0' }, timeout: HEALTH.REQUEST_TIMEOUT }, (res) => {




      if (res.statusCode >= 200 && res.statusCode < 300) {




        resolve({ ok: true });




      } else {




        var body = '';




        res.on('data', d => body += d);




        res.on('end', () => resolve({ ok: false, status: res.statusCode, body }));




      }




    });




    req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }); });




    req.on('error', (e) => resolve({ ok: false, reason: e.message }));




  });




}









var _healthTimer = null;
var _fallbackTimer = null;









async function runHealthCheck() {




  log.info('[health] running provider health check...');




  var promises = [];




  for (const m of MODELS) {




    const key = (m.name || "").toLowerCase();




    if (!key || !m.base || !m.key) continue;




    const h = providerHealth[key] || (providerHealth[key] = { consecutiveFailures: 0, firstFailureAt: null, lastCheck: null, lastSuccess: null, status: 'unknown' });









    // If already unhealthy, only retry after RECOVERY_MS




    if (h.status === 'unhealthy' && h.lastCheck && Date.now() - h.lastCheck < HEALTH.RECOVERY_MS) continue;









    promises.push((async () => {




      var result = await healthCheckProvider(key, m.base, m.key);




      h.lastCheck = Date.now();




      if (result.ok) {




        if (h.status !== 'healthy') { h.status = 'healthy'; h.consecutiveFailures = 0; }
        h.quotaFailures = 0; h.firstQuotaFailureAt = null;
        if (abnormalModels.has(key)) {
          setAbnormal(key, false);
          log.info('[health] ' + key + ' auto-restored from abnormal (health check passed)');
        }

        h.lastSuccess = Date.now();




      } else {




        h.consecutiveFailures++;




        var reason = result.reason || ('HTTP ' + result.status);




        log.warn('[health] ' + key + ' FAILED (' + reason + ') - consecutive failures: ' + h.consecutiveFailures);




        if (h.consecutiveFailures >= HEALTH.MAX_FAILURES) {




          if (h.status !== 'unhealthy') {




            h.status = 'unhealthy';




            log.warn('[health] *** ' + key + ' marked UNHEALTHY - will be skipped in fallback chain');




          }




        }




      }




    })());




  }




  await Promise.allSettled(promises);




  persistHealthState();




}









function startHealthCheck() {




  runHealthCheck();




  _healthTimer = setInterval(runHealthCheck, HEALTH.INTERVAL_MS);




  log.info('[health] health check scheduler started (interval: ' + HEALTH.INTERVAL_MS / 1000 + 's)');




}

  _fallbackTimer = setInterval(function() {
    if (!CONFIG_PROXY.fallback_interval_minutes || !COND_SWITCH_ENABLED) return;
    var intervalMs = (CONFIG_PROXY.fallback_interval_minutes || 30) * 60 * 1000;
    ['CODEX', 'HERMES'].forEach(function(cid) {
      var lastKey = 'lastProviderSwitch_' + cid;
      var last = fallbackState[lastKey] || fallbackState.lastProviderSwitch;
      if (last && Date.now() - last > intervalMs) {
        fallbackState[lastKey] = Date.now();
        fallbackState.lastProviderSwitch = Date.now();
        advanceFallback(cid, true);
        persistFallbackState();
        log.info('[fallback] interval timer triggered switch for ' + cid);
      }
    });
  }, 60 * 1000);
  log.info('[fallback] interval fallback scheduler started (check every 60s)');









// Provider health status for API




function getProviderHealthStatus() {




  return providerHealth;




}









// ============================================================




// FALLBACK CHAIN




// ============================================================




// Auto-reset timeout for builtin mode (default 5 minutes)




const BUILTIN_AUTO_RESET_MS = (CONFIG_PROXY.builtin_reset_minutes || 5) * 60000;




function buildFallbackChain(bodyModel, client) {




  var chain = [];




  // Reload FALLBACK_SEQUENCE_RAW so drag-drop reorder takes effect immediately




  try {




    var __cfgFile = JSON.parse(fs.readFileSync(CONFIG_PROXY_FILE, 'utf-8'));




    FALLBACK_SEQUENCE_RAW = __cfgFile.fallback_sequence || "";




  } catch(e) { /* keep existing value */ }









  // Dynamically read max_provider_use_minutes from config (not cached)




  var MAX_PROVIDER_USE_MS = (CONFIG_PROXY.max_provider_use_minutes || 30) * 60000;




  // Determine starting index based on client




  // CODEX uses codexIdx, HERMES uses hermesIdx, others use currentIdx (global fallback)




  // startIdx is now a valid 0-based chain array index - no findIndex lookup needed




  var startIdx = 0;




  if (client === 'CODEX' && typeof fallbackState.codexIdx === 'number') {




    startIdx = fallbackState.codexIdx;




  } else if (client === 'HERMES' && typeof fallbackState.hermesIdx === 'number') {




    startIdx = fallbackState.hermesIdx;




  } else {




    startIdx = fallbackState.currentIdx;




  }




  // Auto-reset builtin cooldown: if builtin took over for > N minutes, retry custom from currentIdx




  if (fallbackState.builtinSince && Date.now() - fallbackState.builtinSince > BUILTIN_AUTO_RESET_MS) {




    log.info('[fallback] builtin auto-reset after ' + ((Date.now() - fallbackState.builtinSince) / 60000).toFixed(1) + 'min - retrying custom providers');




    fallbackState.currentIdx = fallbackState.currentIdx || 0;




    fallbackState.codexIdx = fallbackState.codexIdx || 0;




    // Preserve existing hermesIdx - only initialize to 1 on very first startup




    if (typeof fallbackState.hermesIdx !== 'number') {




      fallbackState.hermesIdx = 1;




    }




    fallbackState.builtinSince = null;




    fallbackState.lastReset = null;




    fallbackState.lastProviderSwitch = Date.now();




    startIdx = fallbackState.codexIdx;




  }




  // Wrap startIdx modulo chain length so we loop forever through all providers




  if (startIdx >= fallbackChain.length) {




    startIdx = startIdx % Math.max(fallbackChain.length, 1);




  }




  // Two-pass circular search: first from startIdx to end, then from 0 to startIdx-1.




  // This ensures that if startIdx lands on an abnormal/unhealthy provider, we still




  // discover and include all healthy providers (wrapping around) before falling back.




  // IMPORTANT: The provider at startIdx is NEVER skipped - it is the user's explicit choice.




  for (let pass = 0; pass < 2; pass++) {




    const s = pass === 0 ? startIdx : 0;




    const e = pass === 0 ? fallbackChain.length : startIdx;




    for (let i = s; i < e; i++) {




      const entry = fallbackChain[i];




      const provKey = entry.name.toLowerCase();




      const prov = modelProviderMap.get(provKey);




      if (!prov) continue;




      // Skip providers marked unhealthy or abnormal UNLESS they are the user's explicit choice (startIdx)




      const h = providerHealth[provKey];




      const isExplicitChoice = (i === startIdx);




      if (!isExplicitChoice && h && (h.status === 'unhealthy' || h.status === 'abnormal')) {
        console.log('[DEBUG buildChain] SKIP ' + h.status + ' provider=' + provKey + ' isExplicitChoice=' + isExplicitChoice + ' h.status=' + h.status);
        continue;
      }




      // Also skip providers in abnormalModels Set (manually flagged)




      if (abnormalModels.has(provKey)) {




        log.debug('[fallback] skipping manually flagged abnormal: ' + provKey);




        continue;




      }




      var resolvedModel = entry.model || prov.modelId || bodyModel;




      console.log('[DEBUG buildChain] INCLUDING provider=' + provKey + ' model=' + resolvedModel + ' entry.model=' + entry.model + ' prov.modelId=' + prov.modelId);




      chain.push({ name: entry.name, base: prov.base, key: prov.key, model: resolvedModel });




    }




    // If we found at least one healthy provider, stop searching




    if (chain.length > 0) break;




  }




  // Only set lastProviderSwitch when we actually chose a provider.




  // This prevents the max-use timer from being reset on every failed request.




  if (chain.length > 0) {




    var maxUseMs = (CONFIG_PROXY.max_provider_use_minutes || 30) * 60000;




    if (!fallbackState.lastProviderSwitch || Date.now() - fallbackState.lastProviderSwitch > maxUseMs) {




      fallbackState.lastProviderSwitch = Date.now();




      persistFallbackState();




    }




  }




  return chain;




}




function advanceFallback(clientId, isCustom) {
  if (isCustom) {
    var chainLen = Math.max(fallbackChain.length, 1);
    var newIdx, healthKey;
    if (clientId === 'CODEX') {
      newIdx = (fallbackState.codexIdx + 1) % chainLen;
      healthKey = (fallbackChain[newIdx] || {}).name || '';
    } else if (clientId === 'HERMES') {
      newIdx = (fallbackState.hermesIdx + 1) % chainLen;
      healthKey = (fallbackChain[newIdx] || {}).name || '';
    } else {
      newIdx = (fallbackState.currentIdx + 1) % chainLen;
      healthKey = (fallbackChain[newIdx] || {}).name || '';
    }
    // Skip unhealthy providers (max 1 full cycle)
    var skipped = 0;
    while (skipped < chainLen) {
      var h = providerHealth[healthKey.toLowerCase()];
      if (!h || (h.status !== 'unhealthy' && h.status !== 'abnormal')) break;
      skipped++;
      newIdx = (newIdx + 1) % chainLen;
      healthKey = (fallbackChain[newIdx] || {}).name || '';
    }
    // Anti-overlap: if newIdx collides with the other client's INDEX, skip one more
    var otherIdx = (clientId === 'CODEX') ? fallbackState.hermesIdx : fallbackState.codexIdx;
    var otherClient = clientId === 'CODEX' ? 'HERMES' : 'CODEX';
    if (newIdx === otherIdx) {
      log.warn('[fallback] index overlap prevented for ' + clientId + ' (target=' + otherIdx + '), skipping one more');
      var ovSkipped = 0;
      while (ovSkipped < chainLen) {
        newIdx = (newIdx + 1) % chainLen;
        healthKey = (fallbackChain[newIdx] || {}).name || '';
        ovSkipped++;
        if (newIdx !== otherIdx) {
          var h2 = providerHealth[healthKey.toLowerCase()];
          if (!h2 || (h2.status !== 'unhealthy' && h2.status !== 'abnormal')) break;
        }
      }
    }
    // Anti-overlap: if new provider serves the SAME MODEL as the other client, skip one more
    var _newEntry = fallbackChain[newIdx] || {};
    var _newProv = modelProviderMap.get(_newEntry.name ? _newEntry.name.toLowerCase() : '');
    var _newModelId = _newProv ? _newProv.modelId : '';
    var _otherIdx = otherIdx;
    var _otherEntry = fallbackChain[_otherIdx] || {};
    var _otherProv = modelProviderMap.get(_otherEntry.name ? _otherEntry.name.toLowerCase() : '');
    var _otherModelId = _otherProv ? _otherProv.modelId : '';
    if (_newModelId && _otherModelId && _newModelId === _otherModelId) {
      log.warn('[fallback] model overlap prevented for ' + clientId + ' (model=' + _newModelId + ' shared with ' + otherClient + '), skipping one more');
      var modelSkip = 0;
      while (modelSkip < chainLen) {
        newIdx = (newIdx + 1) % chainLen;
        healthKey = (fallbackChain[newIdx] || {}).name || '';
        modelSkip++;
        var _checkEntry = fallbackChain[newIdx] || {};
        var _checkProv = modelProviderMap.get(_checkEntry.name ? _checkEntry.name.toLowerCase() : '');
        var _checkModel = _checkProv ? _checkProv.modelId : '';
        if (newIdx !== _otherIdx && _checkModel && _checkModel !== _otherModelId) {
          var h3 = providerHealth[healthKey.toLowerCase()];
          if (!h3 || (h3.status !== 'unhealthy' && h3.status !== 'abnormal')) break;
        }
      }
    }
    if (clientId === 'CODEX') {
      fallbackState.codexIdx = newIdx;
    } else if (clientId === 'HERMES') {
      fallbackState.hermesIdx = newIdx;
    } else {
      fallbackState.currentIdx = newIdx;
      fallbackState.codexIdx = newIdx;
      fallbackState.hermesIdx = newIdx;
    }
    persistFallbackState();
  }
}




function resetFallbackState() { fallbackState = { currentIdx: 0, codexIdx: 0, hermesIdx: 1, builtinSince: null, lastReset: null, lastProviderSwitch: Date.now() }; persistFallbackState(); }









// Persist fallback state to config-proxy.json so it survives restarts




function persistFallbackState() {




  try {




    var raw = fs.readFileSync(CONFIG_PROXY_FILE, 'utf-8');




    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);




    var cur = JSON.parse(raw);




    cur._fallbackState = fallbackState;




    delete cur._enabledProviders;




    atomicWriteJsonFile(CONFIG_PROXY_FILE, cur);




  } catch(e) { log.warn('[fallback] persist state error:', e.message); }




}









// ── Unified persist: write ALL mutable state in ONE atomic operation ──




// Call this when you need to save multiple things at once (e.g. user save).




// For high-frequency calls use the individual persist* functions which are throttled.




var lastAllPersist = 0;




const ALL_PERSIST_INTERVAL_MS = 2000; // at most once every 2s for full flush




function persistAllState() {




  var now = Date.now();




  if (now - lastAllPersist < ALL_PERSIST_INTERVAL_MS) return;




  lastAllPersist = now;




  try {




    var raw = fs.readFileSync(CONFIG_PROXY_FILE, 'utf-8');




    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);




    var cur = JSON.parse(raw);




    cur._fallbackState = fallbackState;




    cur._providerHealth = providerHealth;




    cur._abnormalModels = Array.from(abnormalModels);




    cur.cond_switch_enabled = COND_SWITCH_ENABLED; // preserve user's toggle setting




    delete cur._enabledProviders; // keep it clean — not persisted (see persistAbnormalModels)




    atomicWriteJsonFile(CONFIG_PROXY_FILE, cur);




  } catch(e) { log.warn('[persist-all] error:', e.message); }




}









// Persist disabled builtins list so it survives restarts




function persistDisabledBuiltins() {




  try {




    var raw = fs.readFileSync(CONFIG_PROXY_FILE, 'utf-8');




    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);




    var cur = JSON.parse(raw);




    cur.disabled_builtins = disabledBuiltins;




    delete cur._enabledProviders;




    fs.writeFileSync(CONFIG_PROXY_FILE, JSON.stringify(cur, null, 2), 'utf-8');




  } catch(e) { log.warn('[builtins] persist disabled error:', e.message); }




}









// Check if upstream error indicates quota/rate-limit exhaustion




function isQuotaError(status, bodyText) {




  if (status !== 429 && status !== 402 && status !== 403 && status !== 500 && status !== 503) return false;




  var lower = (bodyText || '').toLowerCase();




  return /quota|rate.?limit|insufficient.*(quota|balance|credit)|exhausted|too many|request.*limit|超出.*(配额|频率)|配额不足|频率限制/.test(lower);




}









// Try fallback chain for virtual model: each provider in order, advance on quota error




async function tryFallbackChain(req, body, res, originalInput, apiType) {




  // Determine client from request headers




  var clientId = getClientFromReq(req);




  // Build chain starting from client-specific index (codexIdx for CODEX, hermesIdx for HERMES)




  var chain = buildFallbackChain(body.model, clientId);




  log.info(`[fallback] tryFallbackChain model=${body.model} client=${clientId} chainLen=${chain.length}`);




  if (chain.length === 0) {




    log.info(`[fallback] chain empty, returning fallbackProvider=${getFallbackProvider()}`);




    // All custom providers skipped or exhausted - fall back to builtin




    body.model = VIRTUAL_MODEL_ID || body.model;




    return getFallbackProvider();




  }




  for (var ei = 0; ei < chain.length; ei++) {




    var entry = chain[ei];




    var pk = entry.name.toLowerCase();




    var pc = OAI_COMPAT_PROVIDERS[pk];




    log.info(`[fallback] trying provider=${pk} cfgKey=${!!pc} cfgKeyMissing=${pc && !pc.key} model=${entry.model}`);




    if (!pc || !pc.key) {




      log.warn('[fallback] ' + pk + ' has no API key, skipping');




      continue;




    }




    body.model = entry.model;




    touchLastRequest(req, entry.model, pk);




    log.info('[fallback] trying ' + pk + ' | model=' + entry.model + ' (' + (ei+1) + '/' + chain.length + ')');




    try {




      if (apiType === 'responses') {




        await handleOaiCompatResponses(req, pk, body, res, originalInput, clientId);




      } else {




        await handleOaiCompatChatCompletions(req, pk, body, res, clientId);




      }




    } catch (e) {




      if (e instanceof FallbackSkipError) {




        // Immediately mark as unhealthy - don't wait for health check




        log.warn('[fallback] ' + pk + ' failed (marking unhealthy), trying next...');




        var prevH = providerHealth[pk] || { consecutiveFailures: 0, firstFailureAt: null };




        var newFailures = (prevH.consecutiveFailures || 0) + 1;




        // Start a new failure window if firstFailureAt is stale (> 48h) or missing




        var windowStart = Date.now() - ABNORMAL_WINDOW_MS;




        var firstAt = prevH.firstFailureAt;




        if (!firstAt || firstAt < windowStart) { firstAt = Date.now(); newFailures = 1; }




        var newStatus = 'unhealthy';




        if (newFailures >= ABNORMAL_MAX_FAILURES && firstAt >= windowStart) {




          newStatus = 'abnormal';




          abnormalModels.add(pk);




          log.warn('[fallback] *** ' + pk + ' marked ABNORMAL - excluded from rotation (5 failures in 48h). Restore via UI.');




        }




        providerHealth[pk] = { consecutiveFailures: newFailures, firstFailureAt: firstAt, lastCheck: Date.now(), lastSuccess: prevH.lastSuccess || null, status: newStatus };




        persistAllState();




        continue; // try next provider




      }




      // Re-throw non-fallback errors




      throw e;




    }




    // Success - record timestamp only (stay on this provider)




    log.info('[fallback] ' + pk + ' succeeded');




    providerSuccessTs[pk] = Date.now();




    if (providerHealth[pk]) {




      providerHealth[pk].lastSuccess = Date.now();




      // Reset failure count on success; abnormal flag stays until manually cleared




      if (providerHealth[pk].status === 'unhealthy') {




        providerHealth[pk].status = 'healthy';




        providerHealth[pk].consecutiveFailures = 0;




      }




      // Auto-restore: if provider succeeds, remove from abnormalModels Set




      if (abnormalModels.has(pk)) {




        abnormalModels.delete(pk);




        providerHealth[pk].status = 'healthy';




        providerHealth[pk].consecutiveFailures = 0;




        log.info('[abnormal] ' + pk + ' auto-restored after success');




      }




      persistAllState();




    }




    return null;




  }




  // All custom providers exhausted - fall back to builtin




  body.model = VIRTUAL_MODEL_ID || body.model;




  log.warn('[fallback] all custom providers exhausted, falling back to builtin');




  return getFallbackProvider();




}









// Inject models.json providers into OAI_COMPAT_PROVIDERS




function injectDynamicProviders() {




  // Clear existing dynamic providers first




  for (const m of MODELS) {




    const n = (m.name || "").toLowerCase();




    const s = (m.slug || "").toLowerCase();




    if (n) {




      enabledProviders.delete(n);




      delete OAI_COMPAT_PROVIDERS[n];




    }




    if (s && s !== n) {




      enabledProviders.delete(s);




      delete OAI_COMPAT_PROVIDERS[s];




    }




  }




  // Re-inject all models from MODELS




  for (const m of MODELS) {




    const n = (m.name || "").toLowerCase();




    const s = (m.slug || "").toLowerCase();




    if (n && m.base && m.key) {




      const modelIds = [m.id || m.slug || m.name].filter(Boolean);




      const entry = { base: m.base, key: m.key, models: modelIds, defaultModel: modelIds[0] || "", envKey: m.name, slug: n };




      // Register by name AND slug so both "智谱7" and "7" work




      OAI_COMPAT_PROVIDERS[n] = entry;




      if (s && s !== n) {




        OAI_COMPAT_PROVIDERS[s] = entry;




      }




      // Skip abnormal providers (manual flag OR auto-detected status)




      const h = providerHealth ? providerHealth[n] : null;




      if (!abnormalModels.has(n) && (!h || h.status !== 'abnormal')) {




        enabledProviders.add(n);




        if (s && s !== n) enabledProviders.add(s);




      }




      for (const modelId of modelIds) { explicitModelProvider.set(normalizeModelId(modelId), n); }




      console.log("[LUODA中转路由] Injected provider " + m.name + "/" + m.slug + " (" + m.base + ")");




    }




  }




}









// Optional: read MODEL_CATALOG_PATH (the same proxy-models.json Codex uses) so the




// proxy and Codex agree on which models exist. If a model in the catalog has an




// explicit `provider` field, that wins. Otherwise we infer by name (deepseek-* /




// mimo-* / gpt-*). When the file is absent or unreadable we fall back to the




// env-var lists (DEEPSEEK_MODELS, MIMO_MODELS, OPENAI_MODELS) - i.e. backwards




// compatible with the original setup.




const MODEL_CATALOG_PATH = (process.env.MODEL_CATALOG_PATH || "").trim();




function loadCatalogModels(path) {




  try {




    const raw = JSON.parse(fs.readFileSync(path, "utf-8"));




    const out = { deepseek: [], mimo: [], openai: [] };




    for (const m of raw.models || []) {




      if (!m?.slug) continue;




      let p = (m.provider || "").toLowerCase();




      if (!p) {




        const s = m.slug.toLowerCase();




        if (s.startsWith("deepseek")) p = "deepseek";




        else if (s.startsWith("mimo") || s.startsWith("xiaomi")) p = "mimo";




        else if (s.startsWith("gpt-") || s.startsWith("o1") || s.startsWith("o3") || s.startsWith("o4") || s.startsWith("codex-") || s.startsWith("chatgpt-")) p = "openai";




      }




      if (out[p]) out[p].push(m.slug);




    }




    console.log(`[LUODA中转路由] model_catalog: loaded ${path} (deepseek=${out.deepseek.length}, mimo=${out.mimo.length}, openai=${out.openai.length})`);




    return out;




  } catch (err) {




    console.warn(`[LUODA中转路由] model_catalog: ${path} unreadable (${err.message}), falling back to env lists`);




    return null;




  }




}




const CATALOG = MODEL_CATALOG_PATH ? loadCatalogModels(MODEL_CATALOG_PATH) : null;




if (CATALOG) {




  if (CATALOG.deepseek.length) DEEPSEEK_MODELS.splice(0, DEEPSEEK_MODELS.length, ...CATALOG.deepseek);




  if (CATALOG.mimo.length) MIMO_MODELS.splice(0, MIMO_MODELS.length, ...CATALOG.mimo);




  if (CATALOG.openai.length) OPENAI_MODELS.splice(0, OPENAI_MODELS.length, ...CATALOG.openai);




}









// OpenAI-compatible Chat Completions upstreams that share the DeepSeek adapter pipeline




// (Responses-API ⇄ Chat-Completions translation, web_fetch injection, streaming bridge, etc.).




// Add new ones (Kimi, Zhipu, ...) by appending another entry - no other code changes needed.




const OAI_COMPAT_PROVIDERS = {




  deepseek: { base: DEEPSEEK_BASE, key: DEEPSEEK_KEY, models: DEEPSEEK_MODELS, defaultModel: DEEPSEEK_MODELS[0] || "deepseek-v4-pro", envKey: "DEEPSEEK_API_KEY" },




  mimo:     { base: MIMO_BASE,     key: MIMO_KEY,     models: MIMO_MODELS,     defaultModel: MIMO_MODELS[0]     || "mimo-v2.5-pro",   envKey: "MIMO_API_KEY"     },




  neizhi:   { base: MIMO_BASE,     key: MIMO_KEY,     models: MIMO_MODELS,     defaultModel: MIMO_MODELS[0]     || 'mimo-v2.5-pro',   envKey: "MIMO_API_KEY"     },




};









// Resolve a provider-name reference (e.g. "ApiFree") to its actual base URL.




// If the base string is itself a known provider key, look it up; otherwise return as-is.




function resolveProviderBase(base) {




  if (!base) return base;




  var resolved = OAI_COMPAT_PROVIDERS[base];




  return resolved ? resolved.base : base;




}









const enabledProviders = new Set();




for (const [name, cfg] of Object.entries(OAI_COMPAT_PROVIDERS)) {




  if (cfg.key) enabledProviders.add(name);




}




if (OPENAI_KEY) enabledProviders.add("openai");









const providerModels = {




  ...Object.fromEntries(Object.entries(OAI_COMPAT_PROVIDERS).map(([n, c]) => [n, c.models])),




  openai: OPENAI_MODELS,




};









const explicitModelProvider = new Map();




for (const [name, cfg] of Object.entries(OAI_COMPAT_PROVIDERS)) {




  for (const model of cfg.models) explicitModelProvider.set(normalizeModelId(model), name);




}




for (const model of OPENAI_MODELS) explicitModelProvider.set(normalizeModelId(model), "openai");









let modelCatalog = [




  { id: "codexAPI",  object: "model", owned_by: "virtual" },




  { id: "hermesAPI", object: "model", owned_by: "virtual" },




  { id: "neizhiAPI", object: "model", owned_by: "builtin" },




];









// Inject dynamic providers from models.json




injectDynamicProviders();









// NOTE: Built-in provider models (deepseek/mimo/openai) are NO LONGER listed in /v1/models.




// They are routed by name-hint prefix in the completions/responses handlers (deepseek-*, mimo-*, gpt-*).




// The virtual models (codexAPI, hermesAPI, neizhiAPI) are used for platform-managed routing.









// Rebuild modelCatalog when builtin providers change




// Call this after any PUT /api/builtins/:name that affects OAI_COMPAT_PROVIDERS




function rebuildModelCatalog() {




  // Reset to 3 virtual entries only — builtin models are routed by name-hint prefix, not by catalog




  modelCatalog.length = 0;




  modelCatalog.push(




    { id: "codexAPI",  object: "model", owned_by: "virtual" },




    { id: "hermesAPI", object: "model", owned_by: "virtual" },




    { id: "neizhiAPI", object: "model", owned_by: "builtin" }




  );




}









// Restore enabledProviders from saved state.




// NOTE: _enabledProviders is no longer persisted (see persistAbnormalModels).




// enabledProviders is rebuilt from models.json via injectDynamicProviders() each startup.




// Manual toggle state is kept in _toggledProviders (clean names only, no corruption risk).




try {




  var savedToggle = CONFIG_PROXY._toggledProviders;




  if (Array.isArray(savedToggle)) {




    savedToggle.forEach(function(n) {




      // Only restore names that still exist in MODELS (case-insensitive, guards against stale entries)




      if (!abnormalModels.has(n) && MODELS.some(function(m) { return (m.name||'').toLowerCase() === n.toLowerCase(); })) {




        enabledProviders.add(n);




      }




    });




    log.info('[enabledProviders] restored ' + enabledProviders.size + ' toggled providers from saved state');




  }




} catch(e) { /* ignore */ }









// --- Response store for previous_response_id bridging ---









const responseStore = new Map();




const STORE_TTL = Number(process.env.STORE_TTL_MS) || 60 * 60 * 1000; // 1 hour




const STORE_MAX = Number(process.env.STORE_MAX) || 500;




const MAX_CONSECUTIVE_TOOL_CALLS = Number(process.env.MAX_CONSECUTIVE_TOOL_CALLS) || 20; // circuit breaker threshold




const UPSTREAM_TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT_MS) || 60000; // 60s, applies to upstream chat/completions/responses calls









// --- Proxy-side web_fetch tool (bypasses sandbox restrictions) ---









const WEB_FETCH_TOOL = {




  type: "function",




  function: {




    name: "web_fetch",




    description: "Fetch content from a URL over HTTP/HTTPS. Use this when you need to retrieve content from a web URL. Returns HTTP status and response body, with HTML pages converted to clean markdown. Supports all HTTP methods.",




    parameters: {




      type: "object",




      properties: {




        url: { type: "string", description: "The URL to fetch (http:// or https://)" },




        method: { type: "string", enum: ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"], description: "HTTP method (default: GET)" },




        headers: { type: "object", description: "Optional HTTP headers as key-value pairs" },




        body: { type: "string", description: "Request body for POST/PUT/PATCH requests" },




      },




      required: ["url"],




    },




  },




};









// --- Jina Reader integration for clean markdown fetches ---









const JINA_BASE = (process.env.JINA_BASE || "https://r.jina.ai").replace(/\/+$/, "");




const JINA_FETCH_TIMEOUT = Number(process.env.JINA_FETCH_TIMEOUT_MS) || 20000;




const JINA_MAX_BODY = Number(process.env.JINA_MAX_BODY) || 80000;









async function jinaRead(url) {




  const controller = new AbortController();




  const timeout = setTimeout(() => controller.abort(), JINA_FETCH_TIMEOUT);




  try {




    const res = await fetch(`${JINA_BASE}/${url}`, {




      signal: controller.signal,




      headers: {




        "Accept": "text/plain",




        "X-Return-Format": "markdown",




        "User-Agent": "Mozilla/5.0 (compatible; CodexProxy/1.0)",




      },




    });




    clearTimeout(timeout);




    if (!res.ok) {




      const text = await res.text().catch(() => "");




      return `Jina error: ${res.status} ${res.statusText}\n${text}`.slice(0, JINA_MAX_BODY);




    }




    let text = await res.text();




    if (text.length > JINA_MAX_BODY) {




      text = text.slice(0, JINA_MAX_BODY) + `\n...[content truncated, ${text.length - JINA_MAX_BODY} chars omitted]`;




    }




    return text;




  } catch (err) {




    clearTimeout(timeout);




    if (err.name === "AbortError") return "Jina fetch error: request timed out (20s)";




    return `Jina fetch error: ${err.message}`;




  }




}









const MAX_FETCH_LOOPS = Number(process.env.MAX_FETCH_LOOPS) || 5;




const FETCH_TIMEOUT = Number(process.env.FETCH_TIMEOUT_MS) || 15000;




const FETCH_MAX_BODY = Number(process.env.FETCH_MAX_BODY) || 50000;









async function rawFetch(url, method = "GET", headers = {}, reqBody = null) {




  if (!headers["User-Agent"]) headers["User-Agent"] = "Mozilla/5.0 (compatible; CodexProxy/1.0)";




  if (/api\.github\.com/.test(url) && !headers["Authorization"] && !headers["authorization"]) {




    const tok = getGithubToken();




    if (tok) headers["Authorization"] = `Bearer ${tok}`;




  }




  const controller = new AbortController();




  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);




  const fetchOpts = { method, headers, signal: controller.signal, redirect: "follow" };




  // executeWebFetch passes object bodies straight from JSON tool args; coerce to string




  // here so fetch() doesn't get something like "[object Object]" or throw on a Map.




  if (reqBody && /^(POST|PUT|PATCH)$/i.test(method)) {




    if (typeof reqBody === "string" || reqBody instanceof Uint8Array || reqBody instanceof ArrayBuffer) {




      fetchOpts.body = reqBody;




    } else {




      fetchOpts.body = JSON.stringify(reqBody);




      if (!headers["Content-Type"] && !headers["content-type"]) {




        headers["Content-Type"] = "application/json";




      }




    }




  }




  const response = await fetch(url, fetchOpts);




  clearTimeout(timeout);




  const ct = response.headers.get("content-type") || "";




  const status = `HTTP ${response.status} ${response.statusText}`;




  if (/^(HEAD|OPTIONS)$/i.test(method)) {




    const hdrs = [...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");




    return `${status}\n${hdrs}`;




  }




  if (/image|audio|video|octet-stream/.test(ct)) {




    return `${status}\nContent-Type: ${ct}\n(binary content, not shown)`;




  }




  let text = await response.text();




  if (text.length > FETCH_MAX_BODY) {




    text = text.slice(0, FETCH_MAX_BODY) + `\n...[truncated, ${text.length - FETCH_MAX_BODY} chars omitted]`;




  }




  return `${status}\n\n${text}`;




}









async function executeWebFetch(argsStr) {




  try {




    const args = typeof argsStr === "string" ? JSON.parse(argsStr) : argsStr;




    const { url, method = "GET", headers = {}, body: reqBody } = args;




    if (!url) return "Error: no URL provided";




    if (method === "GET") return await jinaRead(url);




    return await rawFetch(url, method, headers, reqBody);




  } catch (err) {




    if (err.name === "AbortError") return "Fetch error: request timed out";




    return `Fetch error: ${err.message}`;




  }




}









function parseCsv(value) {




  // Case-insensitive dedup: keep the first-seen casing of each entry.




  const seen = new Set();




  const out = [];




  for (const raw of String(value || "").split(",")) {




    const trimmed = raw.trim();




    if (!trimmed) continue;




    const k = trimmed.toLowerCase();




    if (seen.has(k)) continue;




    seen.add(k);




    out.push(trimmed);




  }




  return out;




}









function normalizeModelId(model) {




  return String(model || "").trim().toLowerCase();




}









function contentHasUrl(content) {




  if (typeof content === "string") return /https?:\/\//.test(content);




  if (Array.isArray(content)) {




    return content.some((part) => {




      if (typeof part === "string") return /https?:\/\//.test(part);




      if (part && typeof part.text === "string") return /https?:\/\//.test(part.text);




      if (part && typeof part.url === "string") return /https?:\/\//.test(part.url);




      if (part && typeof part.image_url === "string") return /https?:\/\//.test(part.image_url);




      if (part?.image_url?.url && typeof part.image_url.url === "string") return /https?:\/\//.test(part.image_url.url);




      return false;




    });




  }




  return false;




}









function conversationHasUrls(messages) {




  return messages.some((message) => contentHasUrl(message?.content));




}









function ensureWebFetchTool(tools) {




  const list = Array.isArray(tools) ? [...tools] : [];




  const alreadyPresent = list.some((tool) => {




    if (tool?.type !== "function") return false;




    return tool?.function?.name === WEB_FETCH_TOOL.function.name || tool?.name === WEB_FETCH_TOOL.function.name;




  });




  if (!alreadyPresent) list.push(WEB_FETCH_TOOL);




  return list;




}









function ensureWebFetchHint(messages) {




  const hint =




    "[System: You have a `web_fetch` tool available for making HTTP requests. Use it instead of curl, wget, or other shell-based HTTP tools. Call web_fetch with {\"url\": \"...\"} to fetch any URL. It supports GET, HEAD, POST, PUT, DELETE, PATCH, and OPTIONS methods.]";




  const alreadyPresent = messages.some((message) => message?.role === "user" && message?.content === hint);




  if (alreadyPresent) return messages;




  return [...messages, { role: "user", content: hint }];




}









function getFallbackProvider() {




  if (DEFAULT_PROVIDER && enabledProviders.has(DEFAULT_PROVIDER)) return DEFAULT_PROVIDER;




  if (enabledProviders.has("openai")) return "openai";




  for (const name of Object.keys(OAI_COMPAT_PROVIDERS)) {




    if (enabledProviders.has(name)) return name;




  }




  throw new Error("No providers are enabled");




}









// Heuristic name-based routing for OAI-compatible providers when the explicit map misses.




// Order matters: longer/more-specific tokens first so e.g. "deepseek-mimo" wouldn't




// accidentally fall through to MiMo. Keep this list short and add entries when needed.




const OAI_COMPAT_NAME_HINTS = [




  { provider: "deepseek", tokens: ["deepseek"] },




  { provider: "mimo",     tokens: ["mimo", "xiaomi"] },




];









function resolveProviderForModel(model) {




  const normalized = normalizeModelId(model);




  if (normalized) {




    const explicit = explicitModelProvider.get(normalized);




    if (explicit && enabledProviders.has(explicit)) return explicit;




    for (const { provider, tokens } of OAI_COMPAT_NAME_HINTS) {




      if (enabledProviders.has(provider) && tokens.some((t) => normalized.includes(t))) return provider;




    }




    if (enabledProviders.has("openai")) {




      const looksOpenAI = OPENAI_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix.toLowerCase()));




      if (looksOpenAI) return "openai";




    }




  }




  return getFallbackProvider();




}









// Read with LRU bookkeeping: refreshes insertion order so frequently-used roots




// don't get evicted by the eviction loop in storeResponse.




function touchResponse(id) {




  if (!id) return undefined;




  const entry = responseStore.get(id);




  if (!entry) return undefined;




  // Re-insert to move it to the most-recently-used end of the Map.




  responseStore.delete(id);




  responseStore.set(id, entry);




  return entry;




}









function storeResponse(id, data) {




  if (!id) return;









  if (responseStore.size >= STORE_MAX) {




    const now = Date.now();




    for (const [key, val] of responseStore) {




      if (now - val.storedAt > STORE_TTL) responseStore.delete(key);




    }




    if (responseStore.size >= STORE_MAX) {




      // Insertion order = LRU order because every read goes through touchResponse.




      const oldest = responseStore.keys().next().value;




      responseStore.delete(oldest);




    }




  }









  const isToolCallOnly = Array.isArray(data.output) &&




    data.output.length > 0 &&




    data.output.every((o) => o.type === "function_call");









  let consecutiveToolCalls = 0;




  if (data.previousResponseId) {




    const prev = touchResponse(data.previousResponseId);




    if (prev?.breakerFired) {




      // Hard breaker already fired up-chain - counter has been reset; don't propagate.




      consecutiveToolCalls = 0;




    } else if (isToolCallOnly) {




      consecutiveToolCalls = (prev?.consecutiveToolCalls || 0) + 1;




    }




  }









  responseStore.set(id, { ...data, storedAt: Date.now(), consecutiveToolCalls });




  log.info(




    `[proxy] stored response ${id} (provider=${data.provider || "unknown"}, store size: ${responseStore.size}${consecutiveToolCalls > 0 ? `, consecutive_tc: ${consecutiveToolCalls}` : ""})`




  );




}









function resolveResponseChain(previousResponseId) {




  const chain = [];




  let currentId = previousResponseId;




  const visited = new Set();









  while (currentId && !visited.has(currentId)) {




    visited.add(currentId);




    const stored = touchResponse(currentId);




    if (!stored) {




      log.warn(`[proxy] previous_response_id ${currentId} not found in store`);




      break;




    }




    chain.unshift(stored);




    currentId = stored.previousResponseId;




  }









  const items = [];




  for (const entry of chain) {




    if (Array.isArray(entry.input)) items.push(...entry.input);




    if (Array.isArray(entry.output)) items.push(...entry.output);




  }




  return items;




}









function normalizeInputToArray(input) {




  if (Array.isArray(input)) return input;




  if (typeof input === "string") {




    return [{ type: "message", role: "user", content: [{ type: "input_text", text: input }] }];




  }




  return [];




}









function maybeResolvePreviousResponseChain(body, targetProvider) {




  if (!body.previous_response_id) return;









  const previous = responseStore.get(body.previous_response_id);




  if (!previous) {




    if (targetProvider === "deepseek") {




      log.warn(`[proxy] previous_response_id ${body.previous_response_id} missing; DeepSeek request will continue without restored history`);




    }




    return;




  }









  const needsLocalResolution = targetProvider === "deepseek" || previous.provider !== targetProvider;




  if (!needsLocalResolution) return;









  const chainItems = resolveResponseChain(body.previous_response_id);




  if (chainItems.length === 0) return;









  const currentInput = normalizeInputToArray(body.input);




  body.input = [...chainItems, ...currentInput];




  delete body.previous_response_id;




  log.info(`[proxy] locally resolved previous_response_id across provider boundary -> ${targetProvider} (${chainItems.length} items prepended)`);




}









// --- Shared message-list normalisation ---




//




// Both the Responses-API translator and the Chat-Completions handler need to:




//   1. Re-order tool messages to sit immediately after the assistant tool_calls they answer




//   2. Merge consecutive same-role messages




//   3. Drop text-only assistant messages that follow tool_calls




//   4. Drop orphan tool messages




//   5. Coerce tool_call.arguments / tool.content to strings (only used by the CC path)




// They used to maintain two separate copies. This is the single source of truth.




function normalizeMessages(messages, { coerceStrings = false } = {}) {




  // Pass 1: re-order tool replies adjacent to their tool_calls.




  const work = [...messages];




  const fixed = [];




  for (let i = 0; i < work.length; i++) {




    const msg = work[i];




    if (msg === null) continue;




    if (msg.role === "assistant" && msg.tool_calls) {




      fixed.push(msg);




      const callIds = new Set(msg.tool_calls.map((tc) => tc.id));




      for (let j = i + 1; j < work.length; j++) {




        if (work[j]?.role === "tool" && callIds.has(work[j].tool_call_id)) {




          fixed.push(work[j]);




          work[j] = null;




        }




      }




    } else if (msg.role === "tool") {




      const lastTc = [...fixed].reverse().find((m) => m.role === "assistant" && m.tool_calls);




      if (lastTc) {




        let insertIdx = fixed.indexOf(lastTc) + 1;




        while (insertIdx < fixed.length && fixed[insertIdx].role === "tool") insertIdx++;




        fixed.splice(insertIdx, 0, msg);




        work[i] = null;




      }




    } else {




      fixed.push(msg);




    }




  }









  // Pass 2: merge consecutive same-role and drop trailing text-only assistant after tool_calls.




  const merged = [];




  for (const msg of fixed) {




    const prev = merged[merged.length - 1];




    if (




      prev && prev.role === msg.role && msg.role === "user" &&




      typeof prev.content === "string" && typeof msg.content === "string"




    ) {




      prev.content += "\n\n" + msg.content;




    } else if (




      prev && prev.role === msg.role && msg.role === "assistant" &&




      !prev.tool_calls && !msg.tool_calls &&




      typeof prev.content === "string" && typeof msg.content === "string"




    ) {




      prev.content += "\n\n" + msg.content;




    } else if (




      prev && prev.role === "assistant" && msg.role === "assistant" &&




      !prev.tool_calls && msg.tool_calls




    ) {




      merged[merged.length - 1] = msg;




    } else if (




      prev && prev.role === "assistant" && msg.role === "assistant" &&




      prev.tool_calls && !msg.tool_calls




    ) {




      // Drop text-only assistant after tool_calls.




    } else {




      merged.push(msg);




    }




  }









  // Pass 3: drop orphan tool messages.




  const validated = [];




  for (const msg of merged) {




    if (msg.role === "tool") {




      const prev = validated[validated.length - 1];




      if (prev && (prev.role === "tool" || (prev.role === "assistant" && prev.tool_calls))) {




        validated.push(msg);




      }




    } else {




      validated.push(msg);




    }




  }









  // Pass 4 (chat/completions only): coerce tool_call args + tool content to strings.




  if (coerceStrings) {




    for (const msg of validated) {




      if (msg.role === "assistant" && msg.tool_calls) {




        for (const tc of msg.tool_calls) {




          if (!tc.function) continue;




          const args = tc.function.arguments;




          if (args === undefined || args === null || args === "") {




            tc.function.arguments = "{}";




          } else if (typeof args !== "string") {




            tc.function.arguments = JSON.stringify(args);




          } else {




            try {




              JSON.parse(args);




            } catch {




              log.warn(`[proxy] invalid tool_call arguments for ${tc.function.name} (id: ${tc.id}), wrapping as JSON`);




              tc.function.arguments = JSON.stringify({ input: args });




            }




          }




        }




      }




      if (msg.role === "tool" && typeof msg.content !== "string") {




        msg.content = JSON.stringify(msg.content);




      }




    }




  }









  return validated;




}









// --- Request translation: Responses API -> Chat Completions (DeepSeek path only) ---









// Codex CLI's effort enum is: none | minimal | low | medium | high | xhigh.




//




// Each upstream accepts a different subset (verified via probe):




//   DeepSeek (deepseek-v4-*): low | medium | high | max | xhigh




//     - default = thinking ON (no field needed)




//     - to disable thinking: send `thinking: { type: "disabled" }`




//       (NB: `enable_thinking: false` is silently ignored by DeepSeek)




//   MiMo (mimo-v2.5-*):       low | medium | high




//     - same `thinking: { type: "disabled" }` to disable




//




// Translation rules (per provider):




//




//   Codex effort       DeepSeek                          MiMo




//   ----------------   --------------------------------  --------------------------------




//   none               thinking:{type:"disabled"}        thinking:{type:"disabled"}




//   minimal            reasoning_effort:"low"            reasoning_effort:"low"




//   low / medium / high reasoning_effort:<same>          reasoning_effort:<same>




//   xhigh              reasoning_effort:"xhigh"          reasoning_effort:"high" (clamped)




//




// `max` is NOT in Codex's enum (Codex would refuse it during config parse), so it




// can't reach the proxy from a Codex client. We still accept it here for direct




// callers that want DeepSeek's extended max tier; MiMo clamps it like xhigh.




// Anything else is passed through as-is and the upstream gets to 400 it.




function applyEffortTranslation(req, effort, provider) {




  if (!effort) return;




  const e = String(effort).toLowerCase().trim();




  if (e === "none") {




    req.thinking = { type: "disabled" };




    return;




  }




  if (e === "minimal") {




    req.reasoning_effort = "low";




    return;




  }




  if (provider === "mimo" && (e === "max" || e === "xhigh")) {




    req.reasoning_effort = "high";




    return;




  }




  req.reasoning_effort = e;




}









function responsesRequestToChatCompletions(body, provider) {




  const messages = [];









  if (body.instructions) {




    messages.push({




      role: "user",




      content: "[System Instructions] " + body.instructions + "\n\nNote: Be efficient with tool calls. Avoid repeating the same tool call unnecessarily.",




    });




  }









  // Build a callId -> reasoning_content map from responseStore. We capture




  // upstream `delta.reasoning_content` on each turn and stash it on the stored




  // entry; here we replay it so DeepSeek's thinking-mode tool-call round-trip




  // doesn't 400 on a missing `reasoning_content`. Scanning all entries is fine




  // because the store is hard-capped (STORE_MAX, default 500). Only build the




  // index for DeepSeek - MiMo / OpenAI don't accept reasoning_content fields.




  const reasoningByCallId = new Map();




  if (provider === "deepseek") {




    for (const entry of responseStore.values()) {




      if (!entry.reasoningContent) continue;




      for (const out of entry.output || []) {




        if (out.type === "function_call" && out.call_id) {




          reasoningByCallId.set(out.call_id, entry.reasoningContent);




        }




      }




    }




  }









  if (typeof body.input === "string") {




    messages.push({ role: "user", content: body.input });




  } else if (Array.isArray(body.input)) {




    let pendingToolCalls = [];




    const flushPendingToolCalls = () => {




      if (pendingToolCalls.length === 0) return;




      const msg = { role: "assistant", content: null, tool_calls: pendingToolCalls };




      // Attach reasoning if any of the calls in this batch has one cached.




      // (DeepSeek emits one reasoning per response, shared by all tool_calls.)




      for (const tc of pendingToolCalls) {




        const r = reasoningByCallId.get(tc.id);




        if (r) { msg.reasoning_content = r; break; }




      }




      messages.push(msg);




      pendingToolCalls = [];




    };









    for (const item of body.input) {




      // Tolerate items without explicit `type`: if it has a role/content shape,




      // treat it as a plain message (Codex CLI / cc-switch health probe sends




      // `[{role,content}]` without setting type, and OpenAI's Responses API




      // accepts that form too).




      const itemType = item.type || (item.role ? "message" : undefined);




      if (itemType === "message") {




        const role = (item.role === "developer" || item.role === "system") ? "user" : item.role;




        let content;









        if (typeof item.content === "string") {




          content = item.content;




        } else if (Array.isArray(item.content)) {




          content = item.content.map((block) => {




            if (block.type === "input_text") return { type: "text", text: block.text };




            if (block.type === "output_text") return { type: "text", text: block.text };




            if (block.type === "input_image") {




              return { type: "image_url", image_url: { url: block.image_url || block.url } };




            }




            return block;




          });




          if (content.length === 1 && content[0].type === "text") {




            content = content[0].text;




          }




        }









        if (pendingToolCalls.length > 0 && role === "assistant") {




          flushPendingToolCalls();




        } else {




          flushPendingToolCalls();




          messages.push({ role, content });




        }




      } else if (itemType === "function_call") {




        pendingToolCalls.push({




          id: item.call_id || item.id,




          type: "function",




          function: { name: item.name, arguments: item.arguments },




        });




      } else if (itemType === "function_call_output") {




        flushPendingToolCalls();




        messages.push({ role: "tool", tool_call_id: item.call_id, content: item.output });




      }




    }









    flushPendingToolCalls();




  }









  const merged = normalizeMessages(messages);









  const TOOL_OUTPUT_MAX = 2000;




  const KEEP_RECENT_FULL = 10;




  for (let i = 0; i < Math.max(0, merged.length - KEEP_RECENT_FULL); i++) {




    const msg = merged[i];




    if (msg.role === "tool" && typeof msg.content === "string" && msg.content.length > TOOL_OUTPUT_MAX) {




      msg.content = msg.content.slice(0, TOOL_OUTPUT_MAX) + "\n...[output truncated, " + (msg.content.length - TOOL_OUTPUT_MAX) + " chars removed]";




    }




  }









  const MAX_MESSAGES = 55;




  let finalMessages = merged;




  if (merged.length > MAX_MESSAGES) {




    const head = merged.slice(0, 2);




    let tail = merged.slice(-(MAX_MESSAGES - 3));




    while (tail.length > 0 && tail[0].role === "tool") tail.shift();




    finalMessages = [




      ...head,




      {




        role: "user",




        content: "[Earlier conversation trimmed. Do not repeat previous statements or tool calls you already made. Continue with the current task. If you have enough information, respond to the user instead of making more tool calls.]",




      },




      ...tail,




    ];




    log.info(`[proxy] trimmed ${merged.length} -> ${finalMessages.length} messages`);




  }









  // After trim we may have left orphan tool messages - re-normalise to drop them.




  if (merged.length > MAX_MESSAGES) {




    finalMessages = normalizeMessages(finalMessages);




  }









  const req = {




    model: body.model,




    messages: finalMessages,




    stream: body.stream || false,




  };









  if (body.temperature != null) req.temperature = body.temperature;




  if (body.top_p != null) req.top_p = body.top_p;




  req.max_tokens = body.max_output_tokens || 16384;









  if (body.tools?.length > 0) {




    const supported = body.tools.filter((t) => t.type === "function");




    if (supported.length > 0) {




      req.tools = supported.map((t) => {




        if (!t.function) {




          return {




            type: "function",




            function: { name: t.name, description: t.description, parameters: t.parameters },




          };




        }




        return t;




      });




    }




  }









  if (body.tool_choice != null) {




    if (typeof body.tool_choice === "object" && body.tool_choice.name) {




      req.tool_choice = { type: "function", function: { name: body.tool_choice.name } };




    } else {




      req.tool_choice = body.tool_choice;




    }




  }









  applyEffortTranslation(req, body.reasoning?.effort, provider);




  if (body.parallel_tool_calls != null) req.parallel_tool_calls = body.parallel_tool_calls;









  // DeepSeek thinking-mode + tool-call round-trip safety net.




  //




  // When DeepSeek runs in thinking mode (the default unless we send




  // `thinking:{type:"disabled"}`), it requires the original `reasoning_content`




  // to be sent back attached to any prior assistant tool_call message; otherwise




  // it 400s with "The `reasoning_content` in the thinking mode must be passed




  // back to the API.". Codex CLI does NOT round-trip `reasoning_content` through




  // this proxy (we strip it from the upstream stream and Codex stores nothing




  // we can replay), so any conversation that includes an assistant tool_call




  // must run with thinking disabled - otherwise the very next turn dies.




  //




  // We trigger this defensively whenever the request body contains an assistant




  // message with `tool_calls` and `req.thinking` isn't already disabled. This




  // also covers the case where the client sends `reasoning:{}` without an




  // explicit effort (then applyEffortTranslation is a no-op and DeepSeek would




  // default to thinking ON).




  if (provider === "deepseek" && req.thinking?.type !== "disabled") {




    const hasAssistantToolCalls = finalMessages.some(




      (m) => m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0 && !m.reasoning_content




    );




    if (hasAssistantToolCalls) {




      req.thinking = { type: "disabled" };




      delete req.reasoning_effort;




      log.info("[proxy] deepseek: assistant tool_calls without reasoning_content -> forcing thinking:disabled");




    }




  }









  return req;




}









// --- Response translation: Chat Completions -> Responses (DeepSeek path) ---









function uid() {




  return crypto.randomBytes(12).toString("base64url");




}









function chatCompletionToResponse(cc, model, previousResponseId, metadata) {




  const responseId = `resp_${uid()}`;




  const output = [];




  const choice = cc.choices?.[0];









  if (!choice) {




    return {




      id: responseId,




      object: "response",




      created_at: cc.created || Math.floor(Date.now() / 1000),




      status: "completed",




      model: model || cc.model,




      output: [],




      usage: translateUsage(cc.usage),




    };




  }









  const msg = choice.message;









  if (msg.tool_calls?.length > 0) {




    for (const tc of msg.tool_calls) {




      output.push({




        type: "function_call",




        id: `fc_${uid()}`,




        call_id: tc.id,




        name: tc.function.name,




        arguments: tc.function.arguments,




        status: "completed",




      });




    }




  }









  let text = msg.content || "";




  text = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();




  if (text) {




    output.push({




      type: "message",




      id: `msg_${uid()}`,




      status: "completed",




      role: "assistant",




      content: [{ type: "output_text", text, annotations: [] }],




    });




  }









  if (msg.refusal) {




    const msgItem = output.find((o) => o.type === "message") || {




      type: "message",




      id: `msg_${uid()}`,




      status: "completed",




      role: "assistant",




      content: [],




    };




    msgItem.content.push({ type: "refusal", refusal: msg.refusal });




    if (!output.find((o) => o.type === "message")) output.push(msgItem);




  }









  let status = "completed";




  let incompleteDetails = null;




  if (choice.finish_reason === "length") {




    status = "incomplete";




    incompleteDetails = { reason: "max_output_tokens" };




  } else if (choice.finish_reason === "content_filter") {




    status = "incomplete";




    incompleteDetails = { reason: "content_filter" };




  }









  return {




    id: responseId,




    object: "response",




    created_at: cc.created || Math.floor(Date.now() / 1000),




    status,




    model: model || cc.model,




    output,




    previous_response_id: previousResponseId || null,




    metadata: metadata || {},




    usage: translateUsage(cc.usage),




    incomplete_details: incompleteDetails,




  };




}









function translateUsage(u) {




  if (!u) return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };




  return {




    input_tokens: u.prompt_tokens || 0,




    output_tokens: u.completion_tokens || 0,




    total_tokens: u.total_tokens || 0,




    input_tokens_details: { cached_tokens: u.prompt_tokens_details?.cached_tokens || 0 },




    output_tokens_details: { reasoning_tokens: u.completion_tokens_details?.reasoning_tokens || 0 },




  };




}









// --- Streaming translation for DeepSeek chat completions -> Responses SSE ---









function buildStreamingResponseEvents(responseId, model, previousResponseId, metadata) {




  const baseResponse = {




    id: responseId,




    object: "response",




    created_at: Math.floor(Date.now() / 1000),




    status: "in_progress",




    model,




    output: [],




    previous_response_id: previousResponseId || null,




    metadata: metadata || {},




    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },




  };









  return {




    created: () => `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: baseResponse })}\n\n`,




    inProgress: () => `event: response.in_progress\ndata: ${JSON.stringify({ type: "response.in_progress", response: baseResponse })}\n\n`,




    outputItemAdded: (index, item) => `event: response.output_item.added\ndata: ${JSON.stringify({ type: "response.output_item.added", output_index: index, item })}\n\n`,




    contentPartAdded: (outIdx, contentIdx, part) => `event: response.content_part.added\ndata: ${JSON.stringify({ type: "response.content_part.added", output_index: outIdx, content_index: contentIdx, part })}\n\n`,




    textDelta: (outIdx, contentIdx, delta) => `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", output_index: outIdx, content_index: contentIdx, delta })}\n\n`,




    textDone: (outIdx, contentIdx, text) => `event: response.output_text.done\ndata: ${JSON.stringify({ type: "response.output_text.done", output_index: outIdx, content_index: contentIdx, text })}\n\n`,




    contentPartDone: (outIdx, contentIdx, part) => `event: response.content_part.done\ndata: ${JSON.stringify({ type: "response.content_part.done", output_index: outIdx, content_index: contentIdx, part })}\n\n`,




    outputItemDone: (outIdx, item) => `event: response.output_item.done\ndata: ${JSON.stringify({ type: "response.output_item.done", output_index: outIdx, item })}\n\n`,




    fnCallArgsDelta: (outIdx, callId, delta) => `event: response.function_call_arguments.delta\ndata: ${JSON.stringify({ type: "response.function_call_arguments.delta", output_index: outIdx, call_id: callId, delta })}\n\n`,




    fnCallArgsDone: (outIdx, callId, args) => `event: response.function_call_arguments.done\ndata: ${JSON.stringify({ type: "response.function_call_arguments.done", output_index: outIdx, call_id: callId, arguments: args })}\n\n`,




    completed: (response) => `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response })}\n\n`,




  };




}









async function handleStreamingResponse(req, upstreamRes, res, model, previousResponseId, metadata, clientId, provider) {




  res.writeHead(200, {




    "Content-Type": "text/event-stream",




    "Cache-Control": "no-cache",




    Connection: "keep-alive",




  });









  const teardown = wireClientCancel(res, upstreamRes);




  const responseId = `resp_${uid()}`;




  const events = buildStreamingResponseEvents(responseId, model, previousResponseId, metadata);




  await writeWithBackpressure(res, events.created());




  await writeWithBackpressure(res, events.inProgress());









  let fullText = "";




  let reasoningContent = "";




  let inThink = false;




  let messageStarted = false;




  let completionSent = false;




  const toolCalls = new Map();




  let outputIndex = 0;




  let textOutputIdx = -1;




  let buffer = "";




  let streamOutput = null;




  const decoder = new TextDecoder();









  try {




    for await (const chunk of upstreamRes.body) {




      if (clientGone(res)) break;




      buffer += decoder.decode(chunk, { stream: true });




      const lines = buffer.split("\n");




      buffer = lines.pop();









      for (const line of lines) {




        if (!line.startsWith("data: ")) continue;




        const data = line.slice(6).trim();




        if (data === "[DONE]") {




          if (!completionSent) {




            completionSent = true;




            streamOutput = await sendCompletion(res, events, responseId, model, fullText, toolCalls, outputIndex, textOutputIdx, null, null, previousResponseId, metadata);




          }




          continue;




        }









        let parsed;




        try {




          parsed = JSON.parse(data);




        } catch {




          continue;




        }









        // Quota/rate-limit error detection in SSE stream




        if (parsed && parsed.error) {




          const errStr = JSON.stringify(parsed.error);




          if (/(?:quota_exceeded_error|429|rate.limit|insufficient|exhausted)/i.test(errStr)) {




            log.warn('[fallback] ' + provider + ' quota error in SSE (Responses streaming): ' + errStr.slice(0, 200));




            teardown();




            res.end();


            recordError(clientId, provider, 429, errStr.slice(0, 200));




            throw new FallbackSkipError(provider, 429, errStr.slice(0, 200));




          }




        }









        const delta = parsed.choices?.[0]?.delta;




        const finishReason = parsed.choices?.[0]?.finish_reason;




        if (!delta && !finishReason) continue;









        if (delta?.tool_calls) {




          for (const tc of delta.tool_calls) {




            const idx = tc.index ?? 0;




            const tcOutIdx = (messageStarted && textOutputIdx === 0) ? outputIndex + idx + 1 : outputIndex + idx;




            if (!toolCalls.has(idx)) {




              const callId = tc.id || `call_${uid()}`;




              const fcId = `fc_${uid()}`;




              toolCalls.set(idx, { id: fcId, callId, name: tc.function?.name || "", arguments: "", outputIdx: tcOutIdx });




              await writeWithBackpressure(res, events.outputItemAdded(tcOutIdx, {




                type: "function_call",




                id: fcId,




                call_id: callId,




                name: tc.function?.name || "",




                arguments: "",




                status: "in_progress",




              }));




            }




            if (tc.function?.arguments) {




              const tcData = toolCalls.get(idx);




              tcData.arguments += tc.function.arguments;




              await writeWithBackpressure(res, events.fnCallArgsDelta(tcData.outputIdx, tcData.callId, tc.function.arguments));




            }




          }




          if (finishReason && !completionSent) {




            completionSent = true;




            streamOutput = await sendCompletion(res, events, responseId, model, fullText, toolCalls, outputIndex, textOutputIdx, finishReason, parsed.usage, previousResponseId, metadata);




          }




          continue;




        }









        if (typeof delta?.reasoning_content === "string") {




          // Capture but don't forward - Codex CLI doesn't round-trip Responses-API




          // reasoning items through this proxy. We stash the raw string on the




          // stored response and replay it on the next turn (see




          // `responsesRequestToChatCompletions`) so DeepSeek's thinking-mode




          // tool-call round-trip doesn't 400 on a missing `reasoning_content`.




          reasoningContent += delta.reasoning_content;




          continue;




        }









        if (delta?.content) {




          let text = delta.content;




          if (text.includes("<think>")) { inThink = true; text = text.replace(/<think>/g, ""); }




          if (text.includes("</think>")) { inThink = false; text = text.replace(/<\/think>/g, ""); }




          if (inThink || !text) continue;









          if (!messageStarted) {




            messageStarted = true;




            textOutputIdx = outputIndex + toolCalls.size;




            await writeWithBackpressure(res, events.outputItemAdded(textOutputIdx, {




              type: "message",




              id: `msg_${uid()}`,




              status: "in_progress",




              role: "assistant",




              content: [],




            }));




            await writeWithBackpressure(res, events.contentPartAdded(textOutputIdx, 0, { type: "output_text", text: "", annotations: [] }));




          }









          fullText += text;




          await writeWithBackpressure(res, events.textDelta(textOutputIdx, 0, text));




        }









        if (finishReason && !completionSent) {




          completionSent = true;




          streamOutput = await sendCompletion(res, events, responseId, model, fullText, toolCalls, outputIndex, textOutputIdx, finishReason, parsed.usage, previousResponseId, metadata);




        }




      }




    }




  } finally {




    teardown();




  }









  if (clientGone(res)) {




    log.warn(`[proxy] client disconnected mid-stream (${responseId})`);




    try { res.end(); } catch { /* ignore */ }




    return { responseId, output: streamOutput || [], reasoningContent };




  }









  if (!completionSent) {




    completionSent = true;




    const wasGenerating = fullText.length > 0 || toolCalls.size > 0;




    const fallbackReason = wasGenerating ? "length" : "stop";




    log.warn(`[proxy] stream ended without finish_reason (wasGenerating=${wasGenerating}, reason=${fallbackReason})`);




    streamOutput = await sendCompletion(res, events, responseId, model, fullText, toolCalls, outputIndex, textOutputIdx, fallbackReason, null, previousResponseId, metadata);




  }









  res.end();




  return { responseId, output: streamOutput || [], reasoningContent };




}









async function sendCompletion(res, events, responseId, model, fullText, toolCalls, outputIndex, textOutputIdx, finishReason, usage, previousResponseId, metadata) {




  for (const [idx, tc] of toolCalls) {




    const tcIdx = tc.outputIdx != null ? tc.outputIdx : outputIndex + idx;




    await writeWithBackpressure(res, events.fnCallArgsDone(tcIdx, tc.callId, tc.arguments));




    await writeWithBackpressure(res, events.outputItemDone(tcIdx, {




      type: "function_call",




      id: tc.id,




      call_id: tc.callId,




      name: tc.name,




      arguments: tc.arguments,




      status: "completed",




    }));




  }









  const msgOutIdx = textOutputIdx >= 0 ? textOutputIdx : outputIndex + toolCalls.size;




  const trimmed = fullText.trim();




  if (trimmed) {




    const donePart = { type: "output_text", text: trimmed, annotations: [] };




    await writeWithBackpressure(res, events.textDone(msgOutIdx, 0, trimmed));




    await writeWithBackpressure(res, events.contentPartDone(msgOutIdx, 0, donePart));




    await writeWithBackpressure(res, events.outputItemDone(msgOutIdx, {




      type: "message",




      id: `msg_${uid()}`,




      status: "completed",




      role: "assistant",




      content: [donePart],




    }));




  }









  const outputItems = [];




  for (const [idx, tc] of toolCalls) {




    const tcIdx = tc.outputIdx != null ? tc.outputIdx : outputIndex + idx;




    outputItems.push({




      sortIdx: tcIdx,




      item: {




        type: "function_call",




        id: tc.id,




        call_id: tc.callId,




        name: tc.name,




        arguments: tc.arguments,




        status: "completed",




      },




    });




  }




  if (trimmed) {




    outputItems.push({




      sortIdx: msgOutIdx,




      item: {




        type: "message",




        id: `msg_${uid()}`,




        status: "completed",




        role: "assistant",




        content: [{ type: "output_text", text: trimmed, annotations: [] }],




      },




    });




  }




  outputItems.sort((a, b) => a.sortIdx - b.sortIdx);




  const finalOutput = outputItems.map((o) => o.item);









  let status = "completed";




  let incompleteDetails = null;




  if (finishReason === "length") {




    status = "incomplete";




    incompleteDetails = { reason: "max_output_tokens" };




  }









  const finalResponse = {




    id: responseId,




    object: "response",




    created_at: Math.floor(Date.now() / 1000),




    status,




    model,




    output: finalOutput,




    previous_response_id: previousResponseId || null,




    metadata: metadata || {},




    usage: translateUsage(usage),




    incomplete_details: incompleteDetails,




  };









  await writeWithBackpressure(res, events.completed(finalResponse));




  return finalOutput;




}









async function sendResponseAsStream(res, response, req) {




  res.writeHead(200, {




    "Content-Type": "text/event-stream",




    "Cache-Control": "no-cache",




    Connection: "keep-alive",




  });









  const events = buildStreamingResponseEvents(response.id, response.model, response.previous_response_id, response.metadata);




  await writeWithBackpressure(res, events.created());




  await writeWithBackpressure(res, events.inProgress());









  for (let i = 0; i < response.output.length; i++) {




    if (clientGone(res)) break;




    const item = response.output[i];




    if (item.type === "function_call") {




      await writeWithBackpressure(res, events.outputItemAdded(i, { ...item, status: "in_progress", arguments: "" }));




      await writeWithBackpressure(res, events.fnCallArgsDelta(i, item.call_id, item.arguments));




      await writeWithBackpressure(res, events.fnCallArgsDone(i, item.call_id, item.arguments));




      await writeWithBackpressure(res, events.outputItemDone(i, item));




    } else if (item.type === "message") {




      await writeWithBackpressure(res, events.outputItemAdded(i, { ...item, status: "in_progress", content: [] }));




      for (let ci = 0; ci < item.content.length; ci++) {




        const part = item.content[ci];




        if (part.type === "output_text") {




          await writeWithBackpressure(res, events.contentPartAdded(i, ci, { type: "output_text", text: "", annotations: [] }));




          const text = part.text;




          for (let c = 0; c < text.length; c += 80) {




            if (clientGone(res)) break;




            await writeWithBackpressure(res, events.textDelta(i, ci, text.slice(c, c + 80)));




          }




          await writeWithBackpressure(res, events.textDone(i, ci, text));




          await writeWithBackpressure(res, events.contentPartDone(i, ci, part));




        }




      }




      await writeWithBackpressure(res, events.outputItemDone(i, item));




    }




  }









  await writeWithBackpressure(res, events.completed(response));




  res.end();




}









// --- Generic upstream helpers ---









function sendJson(res, statusCode, payload) {




  res.writeHead(statusCode, { "Content-Type": "application/json" });




  res.end(JSON.stringify(payload));




}









// Wrap fetch with an AbortController so a stuck upstream eventually fails




// instead of hanging the request forever. Defaults to UPSTREAM_TIMEOUT (env-tunable).




async function fetchWithTimeout(url, opts, timeoutMs = UPSTREAM_TIMEOUT) {




  const controller = new AbortController();




  const t = setTimeout(() => controller.abort(), timeoutMs);




  // Honour caller-provided signal too (chain abort).




  if (opts.signal) {




    opts.signal.addEventListener("abort", () => controller.abort(), { once: true });




  }




  try {




    return await fetch(url, { ...opts, signal: controller.signal });




  } finally {




    clearTimeout(t);




  }




}









// Wire client-disconnect to upstream cancel so Ctrl+C in Codex CLI doesn't leave




// the upstream stream running. Returns a teardown fn the caller invokes on success.




//




// IMPORTANT: we listen on `res` (ServerResponse), not `req` (IncomingMessage). On




// Node's http server, `req.destroyed` becomes `true` and `req` emits `close` as




// soon as the request body is fully consumed - even while the client is still




// happily waiting for the response. Listening on `req.close` would therefore fire




// a false "client gone" the moment we finished reading the POST body and would




// kill the upstream stream before any chunk got out. `res.close` only fires when




// the underlying socket actually goes away.




//




// `clientGone(res)` is the corresponding "is the socket actually dead?" check




// used inside the SSE loops below; it must NOT consult req.destroyed for the same




// reason.




function wireClientCancel(res, upstreamRes) {




  if (!res || !upstreamRes?.body) return () => {};




  let cancelled = false;




  const onClose = () => {




    if (cancelled) return;




    cancelled = true;




    try { upstreamRes.body.cancel?.(); } catch { /* ignore */ }




  };




  res.once("close", onClose);




  return () => {




    cancelled = true;




    res.off("close", onClose);




  };




}









// True iff the response socket is gone - i.e. the client really disconnected.




// Use this in SSE loops instead of `req.destroyed`, which falsely turns true the




// moment the request body finishes streaming in.




//




// `res.destroyed` flips true on socket teardown. `res.closed` flips true when the




// underlying socket emits 'close'. We deliberately do NOT check `res.writableEnded`




// because that becomes true after our own `res.end()` call - and we don't want




// "we finished writing" to look like "client disappeared".




function clientGone(res) {




  return !!(res && (res.destroyed || res.closed));




}









// Backpressure-aware write. Honours res.write's false return by awaiting drain




// before resolving. Use in SSE loops so slow clients don't blow up memory.




function writeWithBackpressure(res, chunk) {




  if (res.write(chunk)) return;




  return new Promise((resolve) => res.once("drain", resolve));




}









async function readJsonBody(req, res) {




  let rawBody = "";




  for await (const chunk of req) rawBody += chunk;




  try {




    return JSON.parse(rawBody);




  } catch {




    sendJson(res, 400, { error: "Invalid JSON" });




    return null;




  }




}









async function sendUpstreamError(upstreamRes, res, suppressDetails) {




  const errText = await upstreamRes.text();




  log.error(`[proxy] upstream error: ${upstreamRes.status} ${errText}`);




  if (!res.headersSent) {




    // When suppressDetails is true (auto-switch is OFF), never send upstream error details to client




    if (suppressDetails) {
      var _errStatus = upstreamRes.status >= 500 ? 502 : (upstreamRes.status || 500);
      res.writeHead(_errStatus, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: 'request failed', type: 'upstream_error' } }));




    } else {




      res.writeHead(upstreamRes.status, { "Content-Type": upstreamRes.headers.get("content-type") || "application/json" });




      res.end(errText);




    }




  }




}









async function pipeResponsesStreamAndCapture(req, upstreamRes, res, onCompleted) {




  res.writeHead(upstreamRes.status, {




    "Content-Type": "text/event-stream",




    "Cache-Control": "no-cache",




    Connection: "keep-alive",




  });









  const teardown = wireClientCancel(res, upstreamRes);




  let buffer = "";




  const decoder = new TextDecoder();









  const handleBlock = (block) => {




    const lines = block.split("\n");




    let eventType = "";




    const dataLines = [];









    for (const line of lines) {




      if (line.startsWith("event:")) eventType = line.slice(6).trim();




      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());




    }









    const data = dataLines.join("\n");




    if (!data || data === "[DONE]") return;









    try {




      const parsed = JSON.parse(data);




      if (eventType === "response.completed" || parsed.type === "response.completed") {




        onCompleted(parsed.response || parsed);




      }




    } catch {




      // Ignore parse failures in streamed event capture; stream still passes through.




    }




  };









  try {




    for await (const chunk of upstreamRes.body) {




      if (clientGone(res)) break;




      await writeWithBackpressure(res, chunk);




      buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");









      let splitIdx;




      while ((splitIdx = buffer.indexOf("\n\n")) !== -1) {




        const block = buffer.slice(0, splitIdx);




        buffer = buffer.slice(splitIdx + 2);




        handleBlock(block);




      }




    }









    if (buffer.trim()) handleBlock(buffer);




  } finally {




    teardown();




  }




  res.end();




}









async function forwardOpenAIResponses(req, body, res, originalInput, originalPreviousResponseId) {




  // OpenAI Responses API doesn't accept thinking:{type:"disabled"}; "none" means




  // strip the reasoning hint entirely. Other values pass through unchanged




  // (OpenAI accepts the same enum names: minimal/low/medium/high).




  const eff = body.reasoning?.effort;




  if (eff) {




    const e = String(eff).toLowerCase().trim();




    if (e === "none") delete body.reasoning;




    else if (e === "xhigh") body.reasoning = { ...body.reasoning, effort: "high" };




    // minimal / low / medium / high pass through.




  }









  const upstreamRes = await fetchWithTimeout(`${OPENAI_BASE}/responses`, {




    method: "POST",




    headers: {




      "Content-Type": "application/json",




      Authorization: `Bearer ${OPENAI_KEY}`,




    },




    body: JSON.stringify(body),




  });









  if (!upstreamRes.ok) {




    await sendUpstreamError(upstreamRes, res, true);




    return;




  }









  if (body.stream) {




    await pipeResponsesStreamAndCapture(req, upstreamRes, res, (completedResponse) => {




      if (completedResponse?.id && Array.isArray(completedResponse.output)) {




        storeResponse(completedResponse.id, {




          provider: "openai",




          input: originalInput,




          output: completedResponse.output,




          previousResponseId: originalPreviousResponseId || null,




        });




      }




    });




    return;




  }









  const response = await upstreamRes.json();




  if (response?.id && Array.isArray(response.output)) {




    storeResponse(response.id, {




      provider: "openai",




      input: originalInput,




      output: response.output,




      previousResponseId: originalPreviousResponseId || null,




    });




  }




  sendJson(res, upstreamRes.status, response);




}









async function forwardOpenAIChatCompletions(req, body, res) {




  // Same effort normalisation as the responses path. Chat Completions uses the




  // flat `reasoning_effort` field; either form may arrive from callers.




  const eff = body.reasoning_effort || body.reasoning?.effort;




  if (eff) {




    const e = String(eff).toLowerCase().trim();




    delete body.reasoning_effort;




    delete body.reasoning;




    if (e === "none") {




      // Drop entirely - OpenAI doesn't support disabling thinking via a flag.




    } else if (e === "xhigh") {




      body.reasoning_effort = "high";




    } else {




      body.reasoning_effort = e;




    }




  }









  const upstreamRes = await fetchWithTimeout(`${OPENAI_BASE}/chat/completions`, {




    method: "POST",




    headers: {




      "Content-Type": "application/json",




      Authorization: `Bearer ${OPENAI_KEY}`,




    },




    body: JSON.stringify(body),




  });









  if (!upstreamRes.ok) {




    await sendUpstreamError(upstreamRes, res, true);




    return;




  }









  if (body.stream) {




    res.writeHead(upstreamRes.status, {




      "Content-Type": "text/event-stream",




      "Cache-Control": "no-cache",




      Connection: "keep-alive",




    });




    const teardown = wireClientCancel(res, upstreamRes);




    try {




      for await (const chunk of upstreamRes.body) {




        if (clientGone(res)) break;




        await writeWithBackpressure(res, chunk);




      }




    } finally {




      teardown();




    }




    res.end();




    return;




  }









  const response = await upstreamRes.json();




  sendJson(res, upstreamRes.status, response);




}









// Run the model in a loop, feeding back any web_fetch tool_calls it makes until




// either (a) it stops requesting fetches, (b) it asks for the same URL twice in




// a row (stuck loop), or (c) MAX_FETCH_LOOPS is hit. Returns the final upstream




// chat-completions response with web_fetch tool_calls stripped from the message.




//




// `prefix` is just for log lines so callers can distinguish responses-path vs




// chat-completions-path output.




async function runWebFetchLoop({ baseRequest, initialMessages, upstreamUrl, upstreamKey, prefix = "" }) {




  let loopMessages = [...initialMessages];




  let finalCcResponse = null;




  let fetchLoopCount = 0;




  const fetchCache = new Map();




  let prevFetchUrls = "";




  const tag = prefix ? `${prefix}: ` : "";









  for (let loop = 0; loop <= MAX_FETCH_LOOPS; loop++) {




    const loopReq = { ...baseRequest, messages: loopMessages, stream: false };




    const upstreamRes = await fetchWithTimeout(upstreamUrl, {




      method: "POST",




      headers: {




        "Content-Type": "application/json",




        Authorization: `Bearer ${upstreamKey}`,




      },




      body: JSON.stringify(loopReq),




    }, UPSTREAM_TIMEOUT);









    if (!upstreamRes.ok) {




      return { ok: false, errorRes: upstreamRes };




    }









    const ccResponse = await upstreamRes.json();




    const msg = ccResponse.choices?.[0]?.message;




    const webFetchCalls = (msg?.tool_calls || []).filter((tc) => tc.function?.name === "web_fetch");




    const currentFetchUrls = webFetchCalls.map((tc) => {




      try { return JSON.parse(tc.function.arguments).url; }




      catch { return ""; }




    }).sort().join("|");




    const isStuckLoop = webFetchCalls.length > 0 && currentFetchUrls === prevFetchUrls;









    if (webFetchCalls.length === 0 || loop === MAX_FETCH_LOOPS || isStuckLoop) {




      if (isStuckLoop) {




        log.warn(`[proxy] ${tag}web_fetch loop stuck - model re-requested same URL(s), breaking early at loop ${loop + 1}`);




      }




      if (loop === MAX_FETCH_LOOPS && webFetchCalls.length > 0) {




        log.warn(`[proxy] ${tag}web_fetch MAX_FETCH_LOOPS (${MAX_FETCH_LOOPS}) exhausted - stripping remaining fetches`);




      }




      if (msg?.tool_calls) {




        msg.tool_calls = msg.tool_calls.filter((tc) => tc.function?.name !== "web_fetch");




        if (msg.tool_calls.length === 0) {




          delete msg.tool_calls;




          if (ccResponse.choices[0].finish_reason === "tool_calls") {




            ccResponse.choices[0].finish_reason = "stop";




          }




        }




      }




      finalCcResponse = ccResponse;




      fetchLoopCount = loop;




      break;




    }









    prevFetchUrls = currentFetchUrls;




    log.info(`[proxy] ${tag}executing ${webFetchCalls.length} web_fetch call(s) (loop ${loop + 1}/${MAX_FETCH_LOOPS})`);




    const results = await Promise.all(webFetchCalls.map(async (tc) => {




      const fetchUrl = (() => {




        try { return JSON.parse(tc.function.arguments).url; }




        catch { return "unknown"; }




      })();




      if (fetchCache.has(fetchUrl)) {




        log.info(`[proxy] ${tag}web_fetch ${fetchUrl} -> ${fetchCache.get(fetchUrl).length} chars (cached)`);




        return { role: "tool", tool_call_id: tc.id, content: fetchCache.get(fetchUrl) };




      }




      const content = await executeWebFetch(tc.function.arguments);




      fetchCache.set(fetchUrl, content);




      log.info(`[proxy] ${tag}web_fetch ${fetchUrl} -> ${content.length} chars`);




      return { role: "tool", tool_call_id: tc.id, content };




    }));









    loopMessages = [




      ...loopMessages,




      { role: "assistant", content: null, tool_calls: webFetchCalls },




      ...results,




    ];




  }









  if (fetchLoopCount > 0) {




    log.info(`[proxy] ${tag}web_fetch resolved after ${fetchLoopCount} loop(s)`);




  }




  return { ok: true, response: finalCcResponse };




}









// --- OAI-compatible handlers (DeepSeek, MiMo, ...) ---









async function handleOaiCompatResponses(req, provider, body, res, originalInput, clientId) {




  const cfg = OAI_COMPAT_PROVIDERS[provider];




  if (!cfg || !cfg.key) {




    sendJson(res, 400, { error: { message: `${cfg?.envKey || provider.toUpperCase() + "_API_KEY"} is not configured` } });




    return;




  }









  const originalPreviousResponseId = body.previous_response_id || null;




  maybeResolvePreviousResponseChain(body, provider);









  if (originalPreviousResponseId) {




    const prevStored = touchResponse(originalPreviousResponseId);




    const consecutiveTc = prevStored?.consecutiveToolCalls || 0;




    if (consecutiveTc >= MAX_CONSECUTIVE_TOOL_CALLS) {




      log.warn(`[proxy] CIRCUIT BREAKER: ${consecutiveTc} consecutive tool-call-only responses detected - injecting stop-loop nudge`);




      const nudge = {




        type: "message",




        role: "user",




        content: [{




          type: "input_text",




          text: `[SYSTEM: You have made ${consecutiveTc} consecutive tool calls without responding to the user. You MUST now stop making tool calls and provide a text response summarizing your progress, findings, and any remaining work. Do NOT make any more tool calls in this response.]`,




        }],




      };




      const currentInput = normalizeInputToArray(body.input);




      body.input = [...currentInput, nudge];




    } else if (consecutiveTc >= Math.floor(MAX_CONSECUTIVE_TOOL_CALLS * 0.75)) {




      log.warn(`[proxy] tool-call loop warning: ${consecutiveTc}/${MAX_CONSECUTIVE_TOOL_CALLS} consecutive tool-call responses`);




    }




  }









  const chatReq = responsesRequestToChatCompletions(body, provider);




  // Honour the model the client asked for if it belongs to this provider; otherwise fall back to the




  // provider's first configured model. (Codex usually sends the configured `model` field already.)




  const requested = normalizeModelId(chatReq.model);




  const isProviderModel = cfg.models.some((m) => normalizeModelId(m) === requested);




  chatReq.model = isProviderModel ? chatReq.model : cfg.defaultModel;




  const isStream = chatReq.stream;









  const upstreamUrl = `${resolveProviderBase(cfg.base)}/chat/completions`;




  const upstreamKey = cfg.key;




  const routeLabel = `${provider}(${chatReq.model})`;









  let hardBreakerFired = false;




  if (originalPreviousResponseId) {




    const prevStored = touchResponse(originalPreviousResponseId);




    const consecutiveTc = prevStored?.consecutiveToolCalls || 0;




    if (consecutiveTc >= MAX_CONSECUTIVE_TOOL_CALLS + 3) {




      log.warn("[proxy] HARD CIRCUIT BREAKER: stripping all tools to force text response");




      delete chatReq.tools;




      delete chatReq.tool_choice;




      hardBreakerFired = true;




    }




  }









  const hasConversationUrls = conversationHasUrls(chatReq.messages);




  if (hasConversationUrls) {




    chatReq.tools = ensureWebFetchTool(chatReq.tools);




    chatReq.messages = ensureWebFetchHint(chatReq.messages);




  }









  log.info(




    `[proxy] ${routeLabel} | stream=${isStream} | messages=${chatReq.messages.length}${hasConversationUrls ? " | web_fetch_injected" : ""} | roles=[${chatReq.messages.map((m) => m.role + (m.tool_calls ? "(tc)" : "")).join(",")}]`




  );









  if (hasConversationUrls) {




    const result = await runWebFetchLoop({




      baseRequest: chatReq,




      initialMessages: chatReq.messages,




      upstreamUrl,




      upstreamKey,




      prefix: "",




    });




    if (!result.ok) {




      var errText2 = await result.errorRes.clone().text();




      recordError(clientId, provider, result.errorRes.status, errText2);









      // Only switch on real upstream quota/rate-limit errors (429/402/403/500/503 + quota keyword in body).




      // All other errors (400 param, 401 auth, 404 not found, upstream bug) → let CODEX see the error.




      if (isQuotaError(result.errorRes.status, errText2)) {




        // advanceFallback handled by outer catch




        throw new FallbackSkipError(provider, result.errorRes.status, errText2);




      }




      // Non-quota error: throw to let outer catch handler deal with response writing




    }




    const responsesResponse = chatCompletionToResponse(result.response, body.model, originalPreviousResponseId, body.metadata);




    storeResponse(responsesResponse.id, {




      provider,




      input: originalInput,




      output: responsesResponse.output,




      previousResponseId: originalPreviousResponseId,




      breakerFired: hardBreakerFired,




      reasoningContent: result.response?.choices?.[0]?.message?.reasoning_content || "",




    });









    if (isStream) await sendResponseAsStream(res, responsesResponse, req);




    else sendJson(res, 200, responsesResponse);




    return;




  }









  // DEBUG: log what we're about to send to cloudflare




  if (provider === 'cloud1') {




    console.log('[DEBUG cloud1] upstreamUrl=' + upstreamUrl + ' chatReq.model=' + JSON.stringify(chatReq?.model) + ' body=' + JSON.stringify(chatReq).slice(0, 300));




  }




  const upstreamRes = await fetchWithTimeout(upstreamUrl, {




    method: "POST",




    headers: {




      "Content-Type": "application/json",




      Authorization: `Bearer ${upstreamKey}`,




    },




    body: JSON.stringify(chatReq),




  });









  if (!upstreamRes.ok) {




    var __errText = '';




    try { __errText = await upstreamRes.clone().text(); } catch(e) {}




    log.warn('[fallback] upstream HTTP error for ' + provider + ' (Responses, HTTP ' + upstreamRes.status + '): ' + __errText.slice(0, 200));




    recordError(clientId, provider, upstreamRes.status, __errText);




    // Only switch on real quota/rate-limit errors. 400/401/404/upstream bug → propagate error, do not fallback.




    if (isQuotaError(upstreamRes.status, __errText)) {




      // advanceFallback handled by outer catch




      throw new FallbackSkipError(provider, upstreamRes.status, __errText);




    }




    // Non-quota error: let outer catch send the error response to client




    var httpErr = new Error('upstream HTTP ' + upstreamRes.status);




    httpErr.status = upstreamRes.status;




    httpErr.body = __errText;




    throw httpErr;




  }









  if (isStream) {




    const { responseId: streamRespId, output: streamOutput, reasoningContent: streamReasoning } = await handleStreamingResponse(




      req,




      upstreamRes,




      res,




      body.model,




      originalPreviousResponseId,




      body.metadata,




      clientId,




      provider




    );




    storeResponse(streamRespId, {




      provider,




      input: originalInput,




      output: streamOutput,




      previousResponseId: originalPreviousResponseId,




      breakerFired: hardBreakerFired,




      reasoningContent: streamReasoning || "",




    });




    return;




  }









  const ccResponse = await upstreamRes.json();









  // Even on HTTP 200, check if upstream returned a quota/balance error in the body




  if (upstreamRes.status === 200 && /quota|rate.?limit|insufficient|exhausted|429|too many|次数|余额|限额/i.test(JSON.stringify(ccResponse))) {




    log.warn('[fallback] ' + provider + ' quota error in 200 response body (Responses): ' + JSON.stringify(ccResponse).slice(0, 200));




    recordError(clientId, provider, 429, JSON.stringify(ccResponse).slice(0, 200));




    // advanceFallback handled by outer catch




    throw new FallbackSkipError(provider, 200, JSON.stringify(ccResponse).slice(0, 200));




  }









  const responsesResponse = chatCompletionToResponse(ccResponse, body.model, originalPreviousResponseId, body.metadata);




  const nonStreamReasoning = ccResponse.choices?.[0]?.message?.reasoning_content || "";




  storeResponse(responsesResponse.id, {




    provider,




    input: originalInput,




    output: responsesResponse.output,




    reasoningContent: nonStreamReasoning,




    previousResponseId: originalPreviousResponseId,




    breakerFired: hardBreakerFired,




  });




  sendJson(res, 200, responsesResponse);




}









async function handleOaiCompatChatCompletions(req, provider, body, res, clientId) {




  const cfg = OAI_COMPAT_PROVIDERS[provider];




  if (!cfg || !cfg.key) {




    sendJson(res, 400, { error: { message: `${cfg?.envKey || provider.toUpperCase() + "_API_KEY"} is not configured` } });




    return;




  }









  const requested = normalizeModelId(body.model);




  const isProviderModel = body.model && cfg.models.some((m) => normalizeModelId(m) === requested);




  body.model = isProviderModel ? body.model : cfg.defaultModel;




  const isStream = body.stream || false;









  const validated = normalizeMessages(body.messages || [], { coerceStrings: true });




  validated.forEach(function(msg) {




    if (msg.role === "user" && Array.isArray(msg.content)) {




      msg.content = msg.content.map(function(block) {




        if (block && block.type === "input_image") {




          return { type: "image_url", image_url: { url: block.image_url || block.url || "" } };




        }




        return block;




      });




    }




  });




  body.messages = validated;




  if (!body.max_tokens) body.max_tokens = 16384;









  // Translate effort hints on the chat/completions path too. Either:




  //   - body.reasoning_effort (Chat Completions native field)




  //   - body.reasoning?.effort (Responses-style field, in case caller mixes them)




  // are normalised through the same per-provider translator that the responses path uses.




  const ccEffort = body.reasoning_effort || body.reasoning?.effort;




  if (ccEffort) {




    delete body.reasoning_effort;




    delete body.reasoning;




    applyEffortTranslation(body, ccEffort, provider);




  }









  const ccHasUrls = conversationHasUrls(validated);









  if (ccHasUrls) {




    body.tools = ensureWebFetchTool(body.tools);




    body.messages = ensureWebFetchHint(body.messages);




  }









  log.info(`[proxy] chat/completions ${provider}(${body.model}) | stream=${isStream} | messages=${body.messages.length}${ccHasUrls ? " | web_fetch_injected" : ""} | roles=[${body.messages.map((m) => m.role + (m.tool_calls ? "(tc)" : "")).join(",")}]`);









  if (ccHasUrls) {




    const result = await runWebFetchLoop({




      baseRequest: body,




      initialMessages: body.messages,




      upstreamUrl: `${resolveProviderBase(cfg.base)}/chat/completions`,




      upstreamKey: cfg.key,




      prefix: "cc",




    });




    if (!result.ok) {




      var errText3 = '';




      try { errText3 = await result.errorRes.clone().text(); } catch(_){}




      recordError(clientId, provider, result.errorRes.status, errText3);




      // Only switch on real upstream quota/rate-limit. Other errors → let CODEX see the error.




      if (isQuotaError(result.errorRes.status, errText3)) {




        // advanceFallback handled by outer catch




        throw new FallbackSkipError(provider, result.errorRes.status, errText3);




      }




      var httpErr3 = new Error('upstream HTTP ' + result.errorRes.status);




      httpErr3.status = result.errorRes.status;




      httpErr3.body = errText3;




      throw httpErr3;




    }




    const finalCcResponse = result.response;









    if (isStream) {




      res.writeHead(200, {




        "Content-Type": "text/event-stream",




        "Cache-Control": "no-cache",




        Connection: "keep-alive",




      });




      const msg = finalCcResponse.choices?.[0]?.message;




      if (msg?.tool_calls) {




        for (let i = 0; i < msg.tool_calls.length; i++) {




          const tc = msg.tool_calls[i];




          res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: tc.id, type: "function", function: { name: tc.function.name, arguments: "" } }] } }] })}\n\n`);




          res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: i, function: { arguments: tc.function.arguments } }] } }] })}\n\n`);




        }




      }




      if (msg?.content) {




        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: msg.content } }] })}\n\n`);




      }




      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finalCcResponse.choices[0].finish_reason }], usage: finalCcResponse.usage })}\n\n`);




      res.write("data: [DONE]\n\n");




      res.end();




      return;




    }









    sendJson(res, 200, finalCcResponse);




    return;




  }









  // Strip stream_options before forwarding - many upstreams (sensenova, etc.)




  // reject requests that include stream_options without also supporting OpenAI's




  // exact stream_options semantics. The client receives usage via the final [DONE]




  // chunk's `usage` field regardless.




  delete body.stream_options;









  const upstreamRes = await fetchWithTimeout(`${resolveProviderBase(cfg.base)}/chat/completions`, {




    method: "POST",




    headers: {




      "Content-Type": "application/json",




      Authorization: `Bearer ${cfg.key}`,




    },




    body: JSON.stringify(body),




  });









  if (!upstreamRes.ok) {




    var __errText2 = '';




    try { __errText2 = await upstreamRes.clone().text(); } catch(e) {}




    log.warn('[fallback] upstream HTTP error for ' + provider + ' (Chat, HTTP ' + upstreamRes.status + '): ' + __errText2.slice(0, 200));




    recordError(clientId, provider, upstreamRes.status, __errText2);




    // Only switch on real quota/rate-limit. 400/401/404/upstream bug → propagate error, do not fallback.




    if (isQuotaError(upstreamRes.status, __errText2)) {




      // advanceFallback handled by outer catch




      throw new FallbackSkipError(provider, upstreamRes.status, __errText2);




    }




    var httpErr2 = new Error('upstream HTTP ' + upstreamRes.status);




    httpErr2.status = upstreamRes.status;




    httpErr2.body = __errText2;




    throw httpErr2;




  }









  if (isStream) {




    res.writeHead(200, {




      "Content-Type": "text/event-stream",




      "Cache-Control": "no-cache",




      Connection: "keep-alive",




    });




    const teardown = wireClientCancel(res, upstreamRes);




    try {




      for await (const chunk of upstreamRes.body) {




        if (clientGone(res)) break;




        // Sneak peek at first chunk to detect quota errors even in streaming mode




        const chunkText = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');




        if (chunkText.length > 2 && /"error"/.test(chunkText)) {




          // Likely an SSE error chunk - check for quota keywords




          if (/(?:quota_exceeded_error|429|rate.limit|insufficient|exhausted)/i.test(chunkText)) {




            log.warn('[fallback] ' + provider + ' quota error detected in SSE chunk: ' + chunkText.slice(0, 200));




            recordError(clientId, provider, 429, chunkText.slice(0, 200));




            // Write SSE error chunk — always use generic message, never expose upstream details




            var genericErr = JSON.stringify({ error: { message: 'request failed', type: 'upstream_error', status: 429 } });




            try { res.write('data: ' + genericErr + '\n\n'); } catch (_) {}




            res.end();




            teardown();




            // Only advance fallback when auto-switch is ON; otherwise just fail silently




            if (COND_SWITCH_ENABLED) {




              advanceFallback(clientId, true);




              throw new FallbackSkipError(provider, 429, chunkText.slice(0, 200));




            }




            return;




          }




        }




        await writeWithBackpressure(res, chunk);




      }




    } finally {




      teardown();




    }




    res.end();




    return;




  }









  const data = await upstreamRes.json();









  // Even on HTTP 200, check if upstream returned a quota/balance error in the body




  if (upstreamRes.status === 200 && /quota|rate.?limit|insufficient|exhausted|429|too many|次数|余额|限额/i.test(JSON.stringify(data))) {




    log.warn('[fallback] ' + provider + ' quota error in 200 response body: ' + JSON.stringify(data).slice(0, 200));




    recordError(clientId, provider, 429, JSON.stringify(data).slice(0, 200));




    // advanceFallback handled by outer catch




    throw new FallbackSkipError(provider, 200, JSON.stringify(data).slice(0, 200));




  }









  sendJson(res, 200, data);




}









// --- HTTP server ---














// -- Config API + UI server (port 40001) --




function readJsonFile(filePath) {




  try {




    var content = fs.readFileSync(filePath, "utf-8");




    // Strip UTF-8 BOM if present (e.g., from PowerShell Set-Content which adds EF BB BF)




    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);




    return JSON.parse(content);




  }




  catch(e) { return null; }




}




function writeJsonFile(filePath, data) {




  try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8"); return true; }




  catch(e) { return false; }




}




function startConfigServer() {




  const configPort = parseInt(process.env.CONFIG_PORT || "40001", 10);




  const configSrv = http.createServer(function(req, res) {




    res.setHeader("Access-Control-Allow-Origin", "*");




    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");




    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");




    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }




    var url = new URL(req.url, "http://localhost");




    var pn = url.pathname;




    if (pn === "/" || pn === "/config-ui") {




      try { var html = fs.readFileSync(CONFIG_UI_FILE, "utf-8"); res.writeHead(200, {"Content-Type":"text/html; charset=utf-8"}); res.end(html); }




      catch(e) { res.writeHead(500, {"Content-Type":"text/plain"}); res.end("Config UI not found"); }




      return;




    }




    if (req.method === "GET" && pn === "/api/codex/config") {




      var cfg = readJsonFile(CONFIG_PROXY_FILE) || {};




      cfg.models = MODELS; cfg.fallback_state = fallbackState;




      cfg.fallback_chain = fallbackChain.map(function(e,i){return {name:e.name,model:e.model,displayIdx:e.displayIdx,chainIdx:i,raw:e.raw||e.name};});




      cfg.enabled_providers = Array.from(enabledProviders);




      cfg.default_provider = getFallbackProvider();




      sendJson(res, 200, cfg); return;




    }




    if (req.method === "POST" && pn === "/api/codex/config") {




      var bdy = ""; req.on("data", function(c) { bdy += c; });




      req.on("end", function() {




        try {




          var data = JSON.parse(bdy); var cur = readJsonFile(CONFIG_PROXY_FILE) || {};




          Object.assign(cur, data); atomicWriteJsonFile(CONFIG_PROXY_FILE, cur);




          if (data.fallback_enabled !== undefined) FALLBACK_ENABLED = data.fallback_enabled;




          if (data.disable_condition_switch !== undefined) COND_SWITCH_ENABLED = !data.disable_condition_switch;




          if (data.cond_switch_enabled !== undefined) {




            COND_SWITCH_ENABLED = data.cond_switch_enabled;
// Fix: reset fallback idx when toggle is turned OFF
            if (!COND_SWITCH_ENABLED) {
              fallbackState.codexIdx = 0;
              fallbackState.currentIdx = 0;
              fallbackState.lastProviderSwitch = Date.now();
            }

// Immediately persist toggle change so it survives restarts (persistAllState is throttle to 2s)




            try {




              var __cur = readJsonFile(CONFIG_PROXY_FILE) || {};




              __cur.cond_switch_enabled = COND_SWITCH_ENABLED;




              delete __cur._enabledProviders;




              atomicWriteJsonFile(CONFIG_PROXY_FILE, __cur);




            } catch(e) {}




          }




          if (data.virtual_model_id !== undefined) VIRTUAL_MODEL_ID = String(data.virtual_model_id).toLowerCase();




          if (data.fallback_sequence !== undefined) {




            // Save current CODEX/HERMES provider names so we can restore their positions after reorder




            var prevCodexName = null, prevHermesName = null;




            if (fallbackChain.length > 0) {




              if (typeof fallbackState.codexIdx === 'number' && fallbackChain[fallbackState.codexIdx]) {




                prevCodexName = fallbackChain[fallbackState.codexIdx].name;




              }




              if (typeof fallbackState.hermesIdx === 'number' && fallbackChain[fallbackState.hermesIdx]) {




                prevHermesName = fallbackChain[fallbackState.hermesIdx].name;




              }




            }




            // Update the raw sequence variable AND sync module-level fallbackChain




            FALLBACK_SEQUENCE_RAW = String(data.fallback_sequence);
            // Resolve any Chinese names in the sequence to their slug equivalents
            var __tmpModelsJs = MODELS || [];
            if (__tmpModelsJs.length > 0) {
              var __nameToSlug = {};
              __tmpModelsJs.forEach(function(__m) {
                var __n = __m.name || '', __s = __m.slug || '';
                if (__n && __s && __n !== __s) __nameToSlug[__n] = __s;
              });
              var __parts = FALLBACK_SEQUENCE_RAW.split(';');
              var __hasChinese = false;
              __parts = __parts.map(function(__p) {
                var __replacement = __nameToSlug[__p];
                if (__replacement) { __hasChinese = true; return __replacement; }
                return __p;
              });
              if (__hasChinese) {
                FALLBACK_SEQUENCE_RAW = __parts.join(';');
                log.info('[fallback] auto-resolved Chinese names to slugs in sequence');
              }
            }




            syncFallbackChain();




            // Restore CODEX/HERMES to their provider positions in the NEW chain




            fallbackState.currentIdx = 0;




            fallbackState.codexIdx = 0;




            fallbackState.hermesIdx = fallbackChain.length > 1 ? 1 : 0;




            if (prevCodexName) {




              var ci = fallbackChain.findIndex(function(e) { return e.name === prevCodexName; });




              if (ci >= 0) fallbackState.codexIdx = ci;




            }




            if (prevHermesName) {




              var hi = fallbackChain.findIndex(function(e) { return e.name === prevHermesName; });




              if (hi >= 0) fallbackState.hermesIdx = hi;




            }




            fallbackState.builtinSince = null;




            fallbackState.lastReset = null;




            fallbackState.lastProviderSwitch = Date.now();




            persistFallbackState();




          }




          if (data.single_model_codex !== undefined) SINGLE_MODEL_CODEX = String(data.single_model_codex);




          if (data.single_model_hermes !== undefined) SINGLE_MODEL_HERMES = String(data.single_model_hermes);




          if (data.max_provider_use_minutes !== undefined) CONFIG_PROXY.max_provider_use_minutes = parseInt(data.max_provider_use_minutes) || 30;




          if (data.virtual_model_id !== undefined) CONFIG_PROXY.virtual_model_id = String(data.virtual_model_id).toLowerCase();




          Object.assign(CONFIG_PROXY, { fallback_enabled: FALLBACK_ENABLED, single_model_codex: SINGLE_MODEL_CODEX, single_model_hermes: SINGLE_MODEL_HERMES, virtual_model_id: VIRTUAL_MODEL_ID, fallback_sequence: data.fallback_sequence !== undefined ? data.fallback_sequence : CONFIG_PROXY.fallback_sequence, max_provider_use_minutes: CONFIG_PROXY.max_provider_use_minutes });




          if (data.models) {




            // Auto-add new models to fallback_sequence if not already present




            var existingSeq = (CONFIG_PROXY.fallback_sequence || '').split(';').filter(Boolean);




            var newModels = data.models.filter(function(m) {




              var slug = (m.slug || '').toLowerCase();




              var name = (m.name || '').toLowerCase();




              return !existingSeq.some(function(e) {




                var parts = e.split('|');




                return parts[0].toLowerCase() === name || parts[0].toLowerCase() === slug;




              });




            });




            if (newModels.length > 0) {




              var toAdd = newModels.map(function(m) { return m.name + '|' + m.slug; }).join(';');




              CONFIG_PROXY.fallback_sequence = (CONFIG_PROXY.fallback_sequence || '') + ';' + toAdd;




              log.info('[auto-add] new models added to fallback_sequence:', toAdd);




            }




            MODELS.length = 0;




            Array.prototype.push.apply(MODELS, data.models);




          }




          atomicWriteJsonFile(CONFIG_PROXY_FILE, CONFIG_PROXY);




          sendJson(res, 200, { status: "saved" });




        } catch(e) { sendJson(res, 400, { error: e.message }); }




      }); return;




    }




    if (req.method === "GET" && pn === "/api/models") { sendJson(res, 200, MODELS); return; }




    if (req.method === "GET" && pn === "/api/status") {




      var curSlug = null;




      if (FALLBACK_ENABLED && fallbackChain.length > 0 && fallbackState.currentIdx >= 0 && fallbackState.currentIdx < fallbackChain.length) {




        curSlug = fallbackChain[fallbackState.currentIdx].name;




      }




      // Determine client models




      var codexSlug = null, hermesSlug = null;




      function extractSlug(val) {




        if (!val) return null;




        var parts = String(val).split("|");




        return parts.length > 0 && parts[0] ? parts[0] : null;




      }




      if (FALLBACK_ENABLED) {




        codexSlug = LAST_REQUEST.model || curSlug;




        hermesSlug = LAST_REQUEST.model || curSlug;  // same chain for both




      } else {




        codexSlug = extractSlug(SINGLE_MODEL_CODEX);




        hermesSlug = extractSlug(SINGLE_MODEL_HERMES);




      }




      // Use array index to get actual provider entry (codexIdx/hermesIdx are 0-based array indices, not displayIdx)




      var codexEntry = fallbackChain[fallbackState.codexIdx] || null;




      var hermesEntry = fallbackChain[fallbackState.hermesIdx] || null;




      var actualCodexProvider = codexEntry ? codexEntry.name : curSlug;




      var actualHermesProvider = hermesEntry ? hermesEntry.name : curSlug;




      sendJson(res, 200, {




        fallback_enabled: FALLBACK_ENABLED, fallback_state: fallbackState,




        fallback_sequence: FALLBACK_SEQUENCE_RAW,




        fallback_chain: fallbackChain.map(function(e,i){return {name:e.name,model:e.model,displayIdx:e.displayIdx,chainIdx:i,raw:e.raw||e.name};}),




        fallback_interval_minutes: CONFIG_PROXY.fallback_interval_minutes || 30,




        cond_switch_enabled: COND_SWITCH_ENABLED,




        max_provider_use_minutes: CONFIG_PROXY.max_provider_use_minutes || 30,




        fallback_chain_length: fallbackChain.length,




        enabled_providers: Array.from(enabledProviders),




        default_provider: getFallbackProvider(),




        virtual_model: VIRTUAL_MODEL_ID,




        single_model_codex: SINGLE_MODEL_CODEX,




        single_model_hermes: SINGLE_MODEL_HERMES,




        current: LAST_REQUEST.model ? LAST_REQUEST : { model: codexSlug, ts: Date.now() },




        cur_slug: actualCodexProvider,
        codex_cur_slug: actualCodexProvider,
        hermes_cur_slug: actualHermesProvider,
        codex_actual_model: (function(){var _p=modelProviderMap.get((actualCodexProvider||"").toLowerCase());return _p?_p.modelId:"";})(),
        hermes_actual_model: (function(){var _p=modelProviderMap.get((actualHermesProvider||"").toLowerCase());return _p?_p.modelId:"";})(),
        last_request: LAST_REQUEST,




        clients: { CODEX: { model: codexSlug, ts: LAST_REQUEST_CODEX.ts }, HERMES: { model: hermesSlug, ts: LAST_REQUEST_HERMES.ts } },




        provider_health: getProviderHealthStatus(),




        last_errors: { CODEX: LAST_ERRORS_CODEX.slice(), HERMES: LAST_ERRORS_HERMES.slice() }




      }); return;




    }




    if (req.method === "POST" && pn === "/api/fallback/reset") { resetFallbackState(); sendJson(res, 200, { status: "reset", state: fallbackState }); return; }

    // Clear all provider health: POST /api/provider/health/reset
    if (req.method === "POST" && pn === "/api/provider/health/reset") {
      Object.keys(providerHealth).forEach(function(k) { providerHealth[k] = { status: "healthy", consecutiveFailures: 0, lastSuccess: Date.now(), lastCheck: Date.now(), firstFailureAt: null }; });
      persistAllState();
      sendJson(res, 200, { status: "ok", message: "all provider health cleared" }); return;
    }

    if (req.method === "GET" && pn === "/api/fallback/state") { sendJson(res, 200, fallbackState); return; }




    // Set fallback轮巡间隔: POST /api/fallback/set-interval { minutes }




    if (req.method === "POST" && pn === "/api/fallback/set-interval") {




      var reqBody = ""; req.on("data", function(c) { reqBody += c; });




      req.on("end", function() {




        try {




          var indata = JSON.parse(reqBody);




          var mins = parseInt(indata.minutes, 10) || 30;




          CONFIG_PROXY.fallback_interval_minutes = mins;




          var curCfg = readJsonFile(CONFIG_PROXY_FILE) || {};




          curCfg.fallback_interval_minutes = mins;




          atomicWriteJsonFile(CONFIG_PROXY_FILE, curCfg);
          // Reset countdown: set lastProviderSwitch to now so the countdown restarts from the new interval
          fallbackState.lastProviderSwitch = Date.now();
          persistFallbackState();

          sendJson(res, 200, { status: "ok", minutes: mins });




        } catch(e) { sendJson(res, 400, { error: String(e) }); }




      }); return;




    }




    if (req.method === "POST" && pn === "/api/fallback/set-index") {




      var fbdy = ""; req.on("data", function(c) { fbdy += c; });




      req.on("end", function() {




        try {




          var fd = JSON.parse(fbdy);




          var newDisplayIdx = -1;




          var target = (fd.target || 'CODEX').toUpperCase();




          if (typeof fd.index === "number" && fd.index >= 0) {




            // index is the display idx - verify it exists in chain




            newDisplayIdx = fd.index;




            var exists = fallbackChain.some(function(e){ return e.displayIdx === newDisplayIdx; });




            if (!exists) { sendJson(res, 400, { error: "Invalid display idx: " + newDisplayIdx }); return; }




          } else if (typeof fd.slug === "string") {




            var slugInput = fd.slug.trim().toLowerCase();




            var chainPos = fallbackChain.findIndex(function(e) {




              var nameLower = (e.name||'').toLowerCase();




              var modelLower = (e.model||'').toLowerCase();




              return nameLower === slugInput || modelLower === slugInput;




            });




            if (chainPos >= 0) {




              newDisplayIdx = fallbackChain[chainPos].displayIdx;




            }




          }




          // Auto-append: if slug not in fallbackChain but exists in MODELS, add it with correct name




          if (newDisplayIdx < 0 && slugInput) {




            var mpEntry = MODELS.find(function(m) { return (m.slug||'').toLowerCase() === slugInput || (m.name||'').toLowerCase() === slugInput; });




            if (mpEntry) {




              var newEntryName = mpEntry.name || mpEntry.slug || slugInput;




              var newEntryModel = mpEntry.id || '';




              var newEntryIdx = typeof mpEntry.idx === 'number' ? mpEntry.idx : 0;




              fallbackChain.push({ name: newEntryName, model: newEntryModel, displayIdx: newEntryIdx });




              CONFIG_PROXY.fallback_sequence = (CONFIG_PROXY.fallback_sequence || '').trim();




              if (CONFIG_PROXY.fallback_sequence) CONFIG_PROXY.fallback_sequence += ';';




              CONFIG_PROXY.fallback_sequence += newEntryName + '|' + (mpEntry.slug || slugInput);




              var cfgFile = readJsonFile(CONFIG_PROXY_FILE) || {};




              cfgFile.fallback_sequence = CONFIG_PROXY.fallback_sequence;




              atomicWriteJsonFile(CONFIG_PROXY_FILE, cfgFile);




              newDisplayIdx = newEntryIdx;




              log.info('[set-index] auto-added "' + newEntryName + '" to fallback_sequence (display idx=' + newDisplayIdx + ')');




            }




          }




          if (newDisplayIdx < 0) {




            sendJson(res, 400, { error: "Invalid index or slug: " + (slugInput || fd.index) });




            return;




          }




          // Look up provider key from displayIdx so we can reset its health




          var targetEntry = fallbackChain.find(function(e) { return e.displayIdx === newDisplayIdx; });




          var selectedProvider = targetEntry ? (targetEntry.name || '').toLowerCase() : null;




          // newDisplayIdx is displayIdx (badge number). Convert to chain array index before storing.




          var codexArrayIdx = fallbackChain.findIndex(function(e){ return e.displayIdx === newDisplayIdx; });




          var hermesArrayIdx = fallbackChain.findIndex(function(e){ return e.displayIdx === newDisplayIdx; });




          if (target === 'HERMES') {




            fallbackState.hermesIdx = hermesArrayIdx >= 0 ? hermesArrayIdx : newDisplayIdx;




            console.log('[set-index] HERMES set to display idx:', newDisplayIdx, '-> array idx:', fallbackState.hermesIdx, '-> provider:', selectedProvider);




          } else {




            fallbackState.codexIdx = codexArrayIdx >= 0 ? codexArrayIdx : newDisplayIdx;




            console.log('[set-index] CODEX set to display idx:', newDisplayIdx, '-> array idx:', fallbackState.codexIdx, '-> provider:', selectedProvider);




          }




          // Reset health status of the selected provider so it won't be skipped even if previously unhealthy




          if (selectedProvider && providerHealth[selectedProvider]) {




            log.info('[set-index] resetting health of ' + selectedProvider + ' to unknown (user explicitly selected)');




            providerHealth[selectedProvider] = { status: 'unknown', ts: Date.now(), consecutiveFailures: 0, firstFailureAt: null };




          }




          // Clear SINGLE_MODEL so the fallback chain takes effect when user explicitly switches provider




          if (target === 'HERMES') {




            SINGLE_MODEL_HERMES = '';




          } else {




            SINGLE_MODEL_CODEX = '';




          }




          // Also persist the SINGLE_MODEL clear to config-proxy.json




          try {




            var cur2 = JSON.parse(fs.readFileSync(CONFIG_PROXY_FILE, 'utf-8'));




            if (cur2.charCodeAt(0) === 0xFEFF) cur2 = cur2.slice(1);




            if (target === 'HERMES') { cur2.single_model_hermes = ''; }




            else { cur2.single_model_codex = ''; }




            atomicWriteJsonFile(CONFIG_PROXY_FILE, cur2);




          } catch(e) { log.warn('[set-index] failed to persist SINGLE_MODEL clear: ' + e); }




          fallbackState.lastProviderSwitch = Date.now();




          persistFallbackState();




          sendJson(res, 200, { status: "ok", state: fallbackState });




        } catch(e) { sendJson(res, 400, { error: String(e) }); }




      }); return;




    }




    // ─── Abnormal models: list & restore ──────────────────────




    if (req.method === "GET" && pn === "/api/fallback/abnormal") {




      var abnormalList = [];




      // First add all from providerHealth with status=abnormal




      for (const [k, h] of Object.entries(providerHealth)) {




        if (h.status === 'abnormal') {




          var model = MODELS.find(function(m) { return (m.name || '').toLowerCase() === k; });




          abnormalList.push({




            key: k,




            name: model ? model.name : k,




            base: model ? model.base : (model && model._base) || '',




            keyRaw: model ? model.key : '',




            id: model ? model.id : '',




            idx: model ? model.idx : 0,




            slug: model ? model.slug : k,




            consecutiveFailures: h.consecutiveFailures,




            firstFailureAt: h.firstFailureAt,




            lastCheck: h.lastCheck




          });




        }




      }




      // Also include any entries in the abnormalModels Set that aren't already in the list




      for (const k of abnormalModels) {




        if (!abnormalList.some(function(e) { return e.key === k; })) {




          var model = MODELS.find(function(m) { return (m.name || '').toLowerCase() === k; });




          abnormalList.push({




            key: k,




            name: model ? model.name : k,




            base: model ? model.base : '',




            keyRaw: model ? model.key : '',




            id: model ? model.id : '',




            idx: model ? model.idx : 0,




            slug: model ? model.slug : k,




            consecutiveFailures: 0,




            firstFailureAt: null,




            lastCheck: null




          });




        }




      }




      sendJson(res, 200, { abnormalModels: abnormalList });




      return;




    }




    // Edit an abnormal model and optionally move it back to normal: POST /api/abnormal/edit




    if (req.method === "POST" && pn === "/api/abnormal/edit") {




      var ebody = ""; req.on("data", function(c) { ebody += c; });




      req.on("end", function() {




        try {




          var ed = JSON.parse(ebody);




          var targetKey = (ed.key || '').toLowerCase();




          if (!targetKey) { sendJson(res, 400, { error: "key is required" }); return; }




          var model = MODELS.find(function(m) { return (m.name || '').toLowerCase() === targetKey || (m.slug || '').toLowerCase() === targetKey; });




          if (!model) {




            // Brand-new entry - create a minimal slot; caller must supply name/base/key/id




            model = { name: ed.name || ed.key, slug: ed.key, idx: ed.idx || 1 };




            MODELS.push(model);




          }




          // Apply edits




          if (ed.name) model.name = ed.name;




          if (ed.base) model.base = ed.base;




          if (ed.apiKey) model.key = ed.apiKey;




          if (ed.modelId) model.id = ed.modelId;




          if (typeof ed.idx === 'number') model.idx = ed.idx;




          // Slug is derived from name - update if name changed




          model.slug = slugify(model.name || model.id || targetKey);




          // Rebuild key map so future lookups work




          rebuildModelProviderMap();




          writeJsonFile(MODELS_FILE, MODELS);




          var restored = false;




          if (ed.moveToNormal) {




            abnormalModels.delete(targetKey);




            abnormalModels.delete((model.name || '').toLowerCase());




            var k2 = (model.name || '').toLowerCase();




            if (providerHealth[k2]) {




              providerHealth[k2].status = 'unknown';




              providerHealth[k2].consecutiveFailures = 0;




              providerHealth[k2].firstFailureAt = null;




            }




            // Also clean up any old key under old name




            if (providerHealth[targetKey] && targetKey !== k2) {




              delete providerHealth[targetKey];




            }




            persistHealthState();




            persistAbnormalModels();




            restored = true;




          }




          sendJson(res, 200, { status: restored ? 'restored' : 'updated', model: model, moveToNormal: !!ed.moveToNormal });




        } catch(e) { sendJson(res, 400, { error: String(e) }); }




      }); return;




    }




    // Restore an abnormal model to normal (clears abnormal flag, resets failure count)




    if (req.method === "POST" && pn === "/api/fallback/abnormal/restore") {




      var rbody = ""; req.on("data", function(c) { rbody += c; });




      req.on("end", function() {




        try {




          var rd = JSON.parse(rbody);




          var target = (rd.key || '').toLowerCase();




          if (!target || !providerHealth[target]) { sendJson(res, 400, { error: "Unknown provider: " + rd.key }); return; }




          providerHealth[target] = { consecutiveFailures: 0, firstFailureAt: null, lastCheck: Date.now(), lastSuccess: providerHealth[target].lastSuccess, status: 'unknown' };




          abnormalModels.delete(target); // remove from manual abnormal set




          persistHealthState();




          persistAbnormalModels();




          sendJson(res, 200, { status: "restored", key: target, health: providerHealth[target] });




        } catch(e) { sendJson(res, 400, { error: String(e) }); }




      }); return;




    }




    // Toggle abnormal flag: POST /api/fallback/abnormal/toggle { key, abnormal: bool }




    if (req.method === "POST" && pn === "/api/fallback/abnormal/toggle") {




      var tbody = ""; req.on("data", function(c) { tbody += c; });




      req.on("end", function() {




        try {




          var td = JSON.parse(tbody);




          var target = (td.key || '').toLowerCase();




          if (!target) { sendJson(res, 400, { error: "key is required" }); return; }




          var isAbnormal = td.abnormal === true;




          if (isAbnormal) {




            abnormalModels.add(target);




            if (!providerHealth[target]) { providerHealth[target] = { consecutiveFailures: 0, firstFailureAt: Date.now(), lastCheck: null, lastSuccess: null, status: 'unknown' }; }




            providerHealth[target].status = 'abnormal';




            enabledProviders.delete(target);




            persistHealthState();




            persistAbnormalModels();




          } else {




            abnormalModels.delete(target);




            if (providerHealth[target]) {




              providerHealth[target].status = 'unknown';




              providerHealth[target].consecutiveFailures = 0;




              // Re-add to enabledProviders if it was a custom provider




              if (!isBuiltin(target)) {




                enabledProviders.add(target);




              }




              persistHealthState();




            }




            persistAbnormalModels();




          }




          sendJson(res, 200, { status: isAbnormal ? "marked_abnormal" : "cleared", key: target });




        } catch(e) { sendJson(res, 400, { error: String(e) }); }




      }); return;




    }




    // ─── CRUD: Custom models ──────────────────────────────────




    if (req.method === "POST" && pn === "/api/models") {




      var bdy = ""; req.on("data", function(c) { bdy += c; });




      req.on("end", function() {




        try {




          var d = JSON.parse(bdy);




          if (!d.name || !d.base || !d.key || !d.id) { sendJson(res, 400, { error: "缺少必填字段" }); return; }




          var slug = slugify(d.slug || d.name || d.id).slice(0, 24) || (d.slug || d.name || d.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);




          var idx = d.idx && !isNaN(d.idx) ? parseInt(d.idx, 10) : Math.max.apply(null, MODELS.map(function(m) { return m.idx || 0; })) + 1;




          // Auto-suffix on collision instead of rejecting




          var baseSlug = slug;




          var suffixNum = 2;




          while (MODELS.some(function(m) { return m.slug === slug; })) {




            slug = baseSlug.slice(0, 22) + '-' + suffixNum;




            suffixNum++;




          }




          var entry = { name: d.name, base: d.base, key: d.key, id: d.id, slug: slug, idx: idx };




          MODELS.push(entry);




          atomicWriteJsonFile(MODELS_FILE, MODELS);




          // Optionally inject into OAI_COMPAT_PROVIDERS




          if (!OAI_COMPAT_PROVIDERS[slug]) {




            OAI_COMPAT_PROVIDERS[slug] = { base: d.base, key: d.key, models: [d.id], defaultModel: d.id, envKey: d.name };




          }




          rebuildModelProviderMap();




          // Inject into fallback chain (prevents refreshModelsState dependency)




          injectDynamicProviders();




          // Also register the new model in the health-check map




          if (providerHealth) { providerHealth[slug.toLowerCase()] = { healthy: true, lastCheck: Date.now(), consecutiveFailures: 0 }; }




          sendJson(res, 200, { status: "ok", slug: slug });




        } catch(e) { sendJson(res, 400, { error: e.message }); }




      }); return;




    }




    if (req.method === "PUT" && pn.startsWith("/api/models/")) {




      var slug = decodeURIComponent(pn.slice("/api/models/".length));




      var bdy = ""; req.on("data", function(c) { bdy += c; });




      req.on("end", function() {




        try {




          var d = JSON.parse(bdy);




          var idx = MODELS.findIndex(function(m) { return m.slug === slug; });




          if (idx < 0) { sendJson(res, 404, { error: "模型未找到: " + slug }); return; }




          var entry = MODELS[idx];




          if (d.name != null) entry.name = d.name;




          if (d.base != null) entry.base = d.base;




          if (d.key != null) entry.key = d.key;




          if (d.id != null) entry.id = d.id;




          if (d.idx != null) entry.idx = parseInt(d.idx, 10);




          MODELS[idx] = entry;




          atomicWriteJsonFile(MODELS_FILE, MODELS);




          // Update OAI_COMPAT_PROVIDERS




          if (OAI_COMPAT_PROVIDERS[slug]) {




            OAI_COMPAT_PROVIDERS[slug].base = entry.base;




            OAI_COMPAT_PROVIDERS[slug].key = entry.key;




            OAI_COMPAT_PROVIDERS[slug].models = [entry.id];




            OAI_COMPAT_PROVIDERS[slug].defaultModel = entry.id;




          }




          rebuildModelProviderMap();




          sendJson(res, 200, { status: "ok" });




        } catch(e) { sendJson(res, 400, { error: e.message }); }




      }); return;




    }




    if (req.method === "DELETE" && pn.startsWith("/api/models/")) {




      var id = decodeURIComponent(pn.slice("/api/models/".length));




      var idx = MODELS.findIndex(function(m) { return m.slug === id || m.name === id; });




      if (idx < 0) { sendJson(res, 404, { error: "模型未找到: " + id }); return; }




      var removed = MODELS.splice(idx, 1)[0];




      atomicWriteJsonFile(MODELS_FILE, MODELS);




      // Remove from OAI_COMPAT_PROVIDERS




      delete OAI_COMPAT_PROVIDERS[id];




      delete OAI_COMPAT_PROVIDERS[removed.slug];




      rebuildModelProviderMap();




      sendJson(res, 200, { status: "deleted" });




      return;




    }




    // ─── CRUD: Builtin models ─────────────────────────────────




    if (req.method === "PUT" && pn.startsWith("/api/builtins/")) {




      var name = decodeURIComponent(pn.slice("/api/builtins/".length));




      var bdy = ""; req.on("data", function(c) { bdy += c; });




      req.on("end", function() {




        try {




          var d = JSON.parse(bdy);




          if (!OAI_COMPAT_PROVIDERS[name]) { sendJson(res, 400, { error: "Unknown builtin: " + name }); return; }




          var cfg = OAI_COMPAT_PROVIDERS[name];




          if (d.base) {




            cfg.base = d.base;




            // Also update process.env so any new reads pick it up




            var envBaseKey = (name + '_BASE_URL').toUpperCase().replace(/[^A-Z0-9_]/g, '_');




            process.env[envBaseKey] = d.base;




          }




          if (d.key) {




            cfg.key = d.key;




            var envKeyKey = (name + '_API_KEY').toUpperCase().replace(/[^A-Z0-9_]/g, '_');




            process.env[envKeyKey] = d.key;




          }




          // Handle rename (name change)




          var newName = d.name && d.name.trim && d.name.trim() || '';




          var isRename = newName && newName !== name;




          if (isRename) {




            // Remove old .env lines for old name




            var envFileRename = path.join(__dirname_, '.env');




            var oldEnvLines = fs.existsSync(envFileRename) ? fs.readFileSync(envFileRename, 'utf-8').split('\n') : [];




            var oldEnvKeyPrefix = name.toUpperCase().replace(/[^A-Z0-9]/g, '_');




            var filteredLines = oldEnvLines.filter(function(line) {




              var trim = line.trim();




              if (!trim || trim.startsWith('#')) return true;




              var eq = trim.indexOf('=');




              if (eq < 0) return true;




              var k = trim.slice(0, eq).toUpperCase();




              return !(k === oldEnvKeyPrefix + '_API_KEY' || k === oldEnvKeyPrefix + '_BASE_URL' || k === oldEnvKeyPrefix + '_MODELS');




            });




            // Build new .env entries




            var baseVal = d.base || cfg.base;




            var keyVal = d.key || cfg.key;




            var modelsVal = d.models || (cfg.models || []).join(',');




            var newEnvKeyPrefix = newName.toUpperCase().replace(/[^A-Z0-9]/g, '_');




            filteredLines.push(newEnvKeyPrefix + '_API_KEY=' + keyVal);




            if (baseVal) filteredLines.push(newEnvKeyPrefix + '_BASE_URL=' + baseVal);




            if (modelsVal) filteredLines.push(newEnvKeyPrefix + '_MODELS=' + modelsVal);




            fs.writeFileSync(envFileRename, filteredLines.join('\n'), 'utf-8');




            // Update process.env




            delete process.env[oldEnvKeyPrefix + '_API_KEY'];




            delete process.env[oldEnvKeyPrefix + '_BASE_URL'];




            delete process.env[oldEnvKeyPrefix + '_MODELS'];




            process.env[newEnvKeyPrefix + '_API_KEY'] = keyVal;




            if (baseVal) process.env[newEnvKeyPrefix + '_BASE_URL'] = baseVal;




            if (modelsVal) process.env[newEnvKeyPrefix + '_MODELS'] = modelsVal;




            // Remove old name from all maps




            delete OAI_COMPAT_PROVIDERS[name];




            for (const [mid, prov] of explicitModelProvider) {




              if (prov === name) explicitModelProvider.delete(mid);




            }




            // Create new provider entry




            OAI_COMPAT_PROVIDERS[newName] = {




              base: baseVal,




              key: keyVal,




              models: parseCsv(modelsVal),




              defaultModel: parseCsv(modelsVal)[0] || '',




              envKey: newEnvKeyPrefix + '_API_KEY'




            };




            // Rebuild model→provider map for new name




            for (const mid of parseCsv(modelsVal)) {




              explicitModelProvider.set(normalizeModelId(mid), newName);




            }




            // Update providerModels array (replace old name with new)




            var pi = providerModels.indexOf(name);




            if (pi >= 0) providerModels[pi] = newName;




            // Also update SINGLE_MODEL_CODEX/HERMES if they reference the old name




            if (SINGLE_MODEL_CODEX && SINGLE_MODEL_CODEX.startsWith(name + '|')) {




              SINGLE_MODEL_CODEX = newName + SINGLE_MODEL_CODEX.slice(name.length);




            }




            if (SINGLE_MODEL_HERMES && SINGLE_MODEL_HERMES.startsWith(name + '|')) {




              SINGLE_MODEL_HERMES = newName + SINGLE_MODEL_HERMES.slice(name.length);




            }




            log.info('[builtin] Renamed provider "' + name + '" -> "' + newName + '" in .env, OAI_COMPAT_PROVIDERS, explicitModelProvider, providerModels');




            name = newName; // continue with updated name for base/key/models logic below




          }




          if (d.models) {




            var newModels = parseCsv(d.models);




            // Remove old model→provider mappings




            for (const [mid, prov] of explicitModelProvider) {




              if (prov === name) explicitModelProvider.delete(mid);




            }




            cfg.models = newModels;




            cfg.defaultModel = newModels[0] || '';




            for (const mid of newModels) { explicitModelProvider.set(normalizeModelId(mid), name); }




            var envModelsKey = (name + '_MODELS').toUpperCase().replace(/[^A-Z0-9_]/g, '_');




            process.env[envModelsKey] = d.models;




          }




          // Persist to .env so changes survive restarts




          var envFile = path.join(__dirname_, '.env');




          try {




            var envLines = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf-8').split('\n') : [];




            var updated = false;




            var newLines = [];




            for (var i = 0; i < envLines.length; i++) {




              var line = envLines[i];




              var trimLine = line.trim();




              if (!trimLine || trimLine.startsWith('#')) { newLines.push(line); continue; }




              var eqIdx = trimLine.indexOf('=');




              if (eqIdx < 0) { newLines.push(line); continue; }




              var envKey = trimLine.slice(0, eqIdx).trim();




              var envBaseKey2 = (name + '_BASE_URL').toUpperCase().replace(/[^A-Z0-9_]/g, '_');




              var envKeyKey2 = (name + '_API_KEY').toUpperCase().replace(/[^A-Z0-9_]/g, '_');




              var envModelsKey2 = (name + '_MODELS').toUpperCase().replace(/[^A-Z0-9_]/g, '_');




              var matched = false;




              if (d.base && envKey === envBaseKey2) { newLines.push(envKey + '=' + d.base); updated = true; matched = true; }




              else if (d.key && envKey === envKeyKey2) { newLines.push(envKey + '=' + d.key); updated = true; matched = true; }




              else if (d.models && envKey === envModelsKey2) { newLines.push(envKey + '=' + d.models); updated = true; matched = true; }




              else { newLines.push(line); }




            }




            // Append if not found




            if (!updated) {




              if (d.base) newLines.push((name + '_BASE_URL').toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '=' + d.base);




              if (d.key) newLines.push((name + '_API_KEY').toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '=' + d.key);




              if (d.models) newLines.push((name + '_MODELS').toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '=' + d.models);




            }




            fs.writeFileSync(envFile, newLines.join('\n'), 'utf-8');




            log.info('[builtin] Updated ' + name + ' in .env (file updated, in-memory state also updated)');




          } catch(e) { log.warn('[builtin] Failed to write .env: ' + e.message); }




          rebuildModelCatalog();




          sendJson(res, 200, { status: "ok", note: "已保存并实时生效" });




        } catch(e) { sendJson(res, 400, { error: e.message }); }




      }); return;




    }




    if (req.method === "DELETE" && pn.startsWith("/api/builtins/")) {




      var name = decodeURIComponent(pn.slice("/api/builtins/".length));




      var idx = disabledBuiltins.indexOf(name);




      if (idx >= 0) {




        disabledBuiltins.splice(idx, 1);




        persistDisabledBuiltins();




        sendJson(res, 200, { status: "enabled", name: name });




      } else {




        disabledBuiltins.push(name);




        persistDisabledBuiltins();




        sendJson(res, 200, { status: "disabled", name: name });




      }




      return;




    }




    if (req.method === "GET" && pn === "/api/all") {




      // Build builtin list from env-based providers (not from models.json)




      var builtins = [];




      var injectedNames = new Set(MODELS.map(function(m) { return m.slug || m.name; }));




      var envKeys = ["DEEPSEEK_API_KEY", "MIMO_API_KEY", "OPENAI_API_KEY", "LLAMA_API_KEY"];




      var envLabels = { "DEEPSEEK_API_KEY": "deepseek", "MIMO_API_KEY": "mimo", "OPENAI_API_KEY": "openai", "LLAMA_API_KEY": "llama" };




      var envBases = { "DEEPSEEK_API_KEY": process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1", "MIMO_API_KEY": process.env.MIMO_BASE_URL || "https://token-plan-cn.xiaomimimo.com/v1", "OPENAI_API_KEY": process.env.OPENAI_BASE_URL || "https://api.openai.com/v1", "LLAMA_API_KEY": process.env.LLAMA_BASE_URL || "http://127.0.0.1:8080/v1" };




      var envDefaultModels = { "DEEPSEEK_API_KEY": DEEPSEEK_MODELS, "MIMO_API_KEY": MIMO_MODELS, "OPENAI_API_KEY": parseCsv(process.env.OPENAI_MODELS || ""), "LLAMA_API_KEY": parseCsv(process.env.LLAMA_MODELS || "") };




      envKeys.forEach(function(ek) {




        var label = envLabels[ek];




        if (injectedNames.has(label)) return; // skip if already in models.json




        var keyVal = process.env[ek] || "";




        if (!keyVal) return; // skip unconfigured




        var mods = envDefaultModels[ek];




        if (!mods || !mods.length) return;




        var isDisabled = (disabledBuiltins || []).indexOf(label) >= 0;




        builtins.push({




          name: label,




          base: envBases[ek],




          key: keyVal,




          keyRaw: keyVal,




          models: mods,




          enabled: !isDisabled,




          isCustom: false,




          isBuiltin: true




        });




      });




      // Map custom models from MODELS array




      var customList = MODELS.map(function(m) {




        return {




          name: m.name || m.slug || "",




          slug: m.slug || "",




          base: m.base || "",




          key: m.key || "",




          keyRaw: m.key || "",




          id: m.id || (m.models && m.models[0]) || "",




          models: m.models || [m.id || ""],




          idx: m.idx || 0,




          enabled: true,




          isCustom: true,




          isBuiltin: false




        };




      });




      sendJson(res, 200, { builtin: builtins, custom: customList, disabled_builtins: disabledBuiltins || [] });




      return;




    }




    // ─── File download ──────────────────────────────────────




    if (req.method === "GET" && pn === "/api/files/download") {




      var fpath = url.searchParams.get("path") || "";




      if (!fpath) { sendJson(res, 400, { error: "Missing path" }); return; }




      try {




        var fcontent = fs.readFileSync(fpath, "utf-8");




        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });




        res.end(fcontent);




      } catch(e) { sendJson(res, 404, { error: "File not found: " + fpath }); }




      return;




    }




    // ─── File upload ──────────────────────────────────────────




    if (req.method === "POST" && pn === "/api/files/upload") {




      var fpath = url.searchParams.get("path") || "";




      if (!fpath) { sendJson(res, 400, { error: "Missing path" }); return; }




      var bdy = ""; req.on("data", function(c) { bdy += c; });




      req.on("end", function() {




        try {




          fs.writeFileSync(fpath, bdy, "utf-8");




          sendJson(res, 200, { status: "saved" });




        } catch(e) { sendJson(res, 500, { error: e.message }); }




      });




      return;




    }




    // ─── Auth routes ──────────────────────────────────────────




    if (req.method === "GET" && pn === "/api/codex/auth") {




      var authData = readJsonFile(AUTH_FILE) || {};




      sendJson(res, 200, authData);




      return;




    }




    if (req.method === "POST" && pn === "/api/codex/auth") {




      var bdy = ""; req.on("data", function(c) { bdy += c; });




      req.on("end", function() {




        try {




          var data = JSON.parse(bdy);




          var cur = readJsonFile(AUTH_FILE) || {};




          Object.assign(cur, data);




          atomicWriteJsonFile(AUTH_FILE, cur);




          sendJson(res, 200, { status: "saved" });




        } catch(e) { sendJson(res, 400, { error: e.message }); }




      }); return;




    }




    if (req.method === "DELETE" && pn === "/api/codex/auth") {




      try {




        atomicWriteJsonFile(AUTH_FILE, { auth_mode: "chatgpt" });




        sendJson(res, 200, { status: "cleared" });




      } catch(e) { sendJson(res, 500, { error: e.message }); }




      return;




    }




    if (req.method === "POST" && pn === "/api/test/provider") {




      var bdy = ""; req.on("data", function(c) { bdy += c; });




      req.on("end", async function() {




        try {




          var d = JSON.parse(bdy); var cfg = OAI_COMPAT_PROVIDERS[d.provider.toLowerCase()];




          if (!cfg) { sendJson(res, 404, { error: "Provider not found" }); return; }




          var tr = await fetch(resolveProviderBase(cfg.base) + "/chat/completions", {




            method: "POST", headers: {"Content-Type":"application/json","Authorization":"Bearer "+cfg.key},




            body: JSON.stringify({ model: d.model || cfg.defaultModel || cfg.models[0], messages: [{ role: "user", content: "hi" }], max_tokens: 5 }),




            signal: AbortSignal.timeout(15000)




          });




          sendJson(res, 200, { status: tr.ok ? "ok" : "error", status_code: tr.status, body: await tr.text().catch(function() { return ""; }) });




        } catch(e) { sendJson(res, 500, { error: e.message }); }




      }); return;




    }




    sendJson(res, 404, { error: "Not found on config server" });




  });




  configSrv.on('error', function(e) {




    console.error('[LUODA中转路由] Config server bind error: ' + e.message);




    process.exit(1);




  });




  configSrv.listen(configPort, function() {




    console.log("[LUODA中转路由] Config server on http://localhost:" + configPort);




  });




}









const server = http.createServer(async (req, res) => {




  // -- Dynamic concurrency: acquire slot (open routes bypass) --
  const _isDynBypass = (
    req.method === "GET" && (
      req.url === "/health" || req.url === "/" ||
      req.url === "/api/status" ||




    req.url === "/api/dynmetrics"
    )
  );
  if (!_isDynBypass) {
    const _acquired = await acquireSlot();
    if (!_acquired) {
      sendJson(res, 503, { error: { message: "Server is draining, try again later", type: "overloaded" } });
      return;
    }
    const _releaseSlot = () => releaseSlot();
    res.once("finish", _releaseSlot);
    res.once("close", _releaseSlot);
  }

    // Lightweight access log so we can see what cc-switch / Codex actually sends.




  // Toggle off by setting ACCESS_LOG=0 in .env.




  if (process.env.ACCESS_LOG !== "0") {




    const ua = req.headers["user-agent"] || "";




    log.access(`[access] ${req.method} ${req.url} ua="${ua.slice(0, 60)}"`);




  }









  // Auto-reload models.json on file change (hot reload)




  checkAndReloadModels();









  // Inbound auth gate. /health, /v1/models and /api/status stay open.




  // On success, req.lockedProvider is set to "deepseek" / "mimo" / "openai" / "*".




  const isOpenRoute = req.method === "GET" && (




    req.url === "/health" || req.url === "/" ||




    req.url === "/v1/models" || req.url === "/models" ||




    req.url === "/api/status" ||
    req.url === "/api/dynmetrics"




  );




  if (!isOpenRoute) {




    req.lockedProvider = "*";




    if (PROXY_AUTH_ENABLED) {




      const header = req.headers["authorization"] || "";




      const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";




      // Allow all requests WITHOUT Bearer token when running locally (CODEX/Hermes connections)




      if (!presented && !header.startsWith("Bearer ")) {




        req.lockedProvider = "*";




        sendJson(res, 401, {




          error: {




            message: "Invalid or missing proxy key. Set Authorization: Bearer <key>.",




            type: "invalid_request_error",




            code: "proxy_auth_required",




          },




        });




        return;




      }




      const lock = presented ? PROXY_KEY_TABLE.get(presented) : undefined;




      if (!lock) {




        if (process.env.ACCESS_LOG !== "0") {




          log.access(`[access] 401 unauthorized (presented=${presented ? presented.slice(0, 8) + "..." : "<none>"})`);




        }




        sendJson(res, 401, {




          error: {




            message: "Invalid or missing proxy key. Set Authorization: Bearer <key> using one of the keys configured in PROXY_KEYS or PROXY_AUTH_KEY.",




            type: "invalid_request_error",




            code: "proxy_auth_required",




          },




        });




        return;




      }




      req.lockedProvider = lock;




    }




  }









  if (req.method === "GET" && req.url === "/api/dynmetrics") {
    try {
      var _dm = getDynMetrics();
      sendJson(res, 200, _dm);
    } catch(e) {
      sendJson(res, 200, { enabled: false, error: String(e) });
    }
    return;
  }

  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {




    sendJson(res, 200, {




      status: "ok",




      proxy: "LUODA中转路由",




      providers: [...enabledProviders],




      default_provider: getFallbackProvider(),




    });




    return;




  }









  if ((req.method === "GET" || req.method === "POST") && req.url.startsWith("/cop")) {




    let url = "";




    let method = "GET";




    let body2 = null;




    let headers2 = {};









    if (req.method === "GET") {




      const parsed = new URL(req.url, "http://localhost");




      url = parsed.searchParams.get("url") || "";




    } else {




      const parsedBody = await readJsonBody(req, res);




      if (!parsedBody) return;




      url = parsedBody.url || "";




      method = parsedBody.method || "GET";




      body2 = parsedBody.body || null;




      headers2 = parsedBody.headers || {};




    }









    if (!url) {




      sendJson(res, 400, { error: "url parameter required" });




      return;




    }









    log.info(`[proxy] /cop ${method} ${url}`);




    const content = await executeWebFetch({ url, method, headers: headers2, body: body2 });




    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });




    res.end(content);




    return;




  }









  if (req.method === "GET" && (req.url === "/v1/models" || req.url === "/models")) {




    sendJson(res, 200, {




      object: "list",




      data: modelCatalog,




      default_provider: getFallbackProvider(),




    });




    return;




  }









  if (req.method === "GET" && req.url === "/api/status") {




    var curSlug = null;




    if (FALLBACK_ENABLED && fallbackChain.length > 0 && fallbackState.currentIdx >= 0 && fallbackState.currentIdx < fallbackChain.length) {




      curSlug = fallbackChain[fallbackState.currentIdx].name;




    }




    var codexEntry = fallbackChain[fallbackState.codexIdx] || null;




    var hermesEntry = fallbackChain[fallbackState.hermesIdx] || null;




    sendJson(res, 200, {




      fallback_enabled: FALLBACK_ENABLED,




      fallback_state: fallbackState,




      fallback_sequence: FALLBACK_SEQUENCE_RAW,




      fallback_chain: fallbackChain.map(function(e,i){return {name:e.name,model:e.model,displayIdx:e.displayIdx,chainIdx:i,raw:e.raw||e.name};}),




      cond_switch_enabled: COND_SWITCH_ENABLED,




      max_provider_use_minutes: CONFIG_PROXY.max_provider_use_minutes || 30,




      enabled_providers: Array.from(enabledProviders),




      default_provider: getFallbackProvider(),




      single_model_codex: SINGLE_MODEL_CODEX,




      single_model_hermes: SINGLE_MODEL_HERMES,




      last_request: LAST_REQUEST,




      cur_slug: codexEntry ? codexEntry.name : curSlug,




      codex_cur_slug: codexEntry ? codexEntry.name : curSlug,




      hermes_cur_slug: hermesEntry ? hermesEntry.name : curSlug,




      provider_health: getProviderHealthStatus(),




      last_errors: { CODEX: LAST_ERRORS_CODEX.slice(), HERMES: LAST_ERRORS_HERMES.slice() }




    }); return;




  }




  if (req.method === "POST" && (req.url === "/v1/responses" || req.url === "/responses")) {




    if (!settingsReady) { sendJson(res, 503, { error: { message: "Proxy still initializing, please retry" } }); return; }




    const body = await readJsonBody(req, res);




    if (!body) return;









    if (process.env.ACCESS_LOG !== "0") {




      const inputType = Array.isArray(body.input) ? `array(${body.input.length})` : typeof body.input;




      log.access(`[access] /v1/responses body keys=${Object.keys(body).join(",")} model=${body.model || "<none>"} input=${inputType} stream=${!!body.stream}`);




    }









    try {




      // If the inbound key locks the request to one provider, fill in the provider's




      // default model when body.model is missing - this lets cc-switch probes (which




      // omit `model` entirely) still get a sensible synthetic response.




      const lock = req.lockedProvider || "*";




      if (lock !== "*" && (!body.model || !String(body.model).trim())) {




        const lockCfg = OAI_COMPAT_PROVIDERS[lock];




        if (lockCfg) body.model = lockCfg.defaultModel;




        else if (lock === "openai") body.model = OPENAI_MODELS[0] || "";




      }









      // -- Virtual model / fallback routing --




      var provider = resolveProviderForModel(body.model);




      var isVirtual = VIRTUAL_MODEL_ID && body.model && body.model.toLowerCase() === VIRTUAL_MODEL_ID;









      // 必须先解析 originalInput,因为 tryFallbackChain 需要它作为参数




      // (原来在 2496 行声明,但被 2438 行提前引用导致 Temporal Dead Zone ReferenceError)




      const originalInput = normalizeInputToArray(body.input);









      // FIX: 无论 isVirtual 是否为 true,只要 FALLBACK_ENABLED 且 chain 不为空,




      // 就把 resolved provider 加入 chain 一起轮循。




      // 这修复了 CODEX/WeChat 发送真实模型名时 fallback 链被绕过的问题。




      var fbChain = null;




      if (FALLBACK_ENABLED && fallbackChain.length > 0) {




        var clientId0 = getClientFromReq(req);




        var chain = buildFallbackChain(body.model, clientId0);




        if (chain.length > 0) {




          fbChain = chain;




        }




      }









      // Health-check / probe short-circuit:









      // Health-check / probe short-circuit: cc-switch (and similar managers) ping the




      // proxy with empty or input-less bodies just to verify reachability. Forwarding




      // those upstream produces a 400 ("Empty input messages") which surfaces in the UI




      // as "供应商拒绝了请求格式". Detect probes (no input AND no previous_response_id)




      // and answer locally without touching the upstream provider.




      const hasInput = originalInput.length > 0 || (typeof body.input === "string" && body.input.trim().length > 0);




      const hasPrevious = !!body.previous_response_id;




      if (!hasInput && !hasPrevious) {




        if (process.env.ACCESS_LOG !== "0") {




          log.access(`[access] /v1/responses probe short-circuit (provider=${provider})`);




        }




        const probeId = `resp_probe_${Math.random().toString(36).slice(2, 12)}`;




        sendJson(res, 200, {




          id: probeId,




          object: "response",




          created_at: Math.floor(Date.now() / 1000),




          status: "completed",




          model: body.model || (OAI_COMPAT_PROVIDERS[provider]?.defaultModel) || "probe",




          output: [




            {




              type: "message",




              id: `msg_probe_${Math.random().toString(36).slice(2, 10)}`,




              status: "completed",




              role: "assistant",




              content: [{ type: "output_text", text: "ok", annotations: [] }],




            },




          ],




          previous_response_id: null,




          metadata: { probe: true },




          usage: {




            input_tokens: 0,




            output_tokens: 0,




            total_tokens: 0,




            input_tokens_details: { cached_tokens: 0 },




            output_tokens_details: { reasoning_tokens: 0 },




          },




          incomplete_details: null,




        });




        return;




      }









      // ------ FALLBACK ROUTING ------




      // fbChain is pre-built: if non-null, fallback is enabled and chain has candidates.




      // The chain always starts from fallbackState.currentIdx so we skip exhausted providers.




      // Priority: SINGLE_MODEL config (per-client, always) > fallback chain (FALLBACK_ENABLED) > virtual model




      var clientId4 = getClientFromReq(req);




      var smCfgR = clientId4 === 'HERMES' ? SINGLE_MODEL_HERMES : SINGLE_MODEL_CODEX;




      var smUsedR = false;




      // Preserve original model before any routing transforms it




      var originalModel = body.model;




      if (smCfgR) {




        var smPartsR = smCfgR.split('|');




        if (smPartsR.length >= 1) {




          var smNameR = smPartsR[0].trim().toLowerCase();




          // Built-in provider check: OAI_COMPAT_PROVIDERS has deepseek/mimo/openai (configured via .env, not models.json)




          var isBuiltinProvider = smNameR && OAI_COMPAT_PROVIDERS[smNameR] && OAI_COMPAT_PROVIDERS[smNameR].key;




          // Custom provider check: modelProviderMap has providers from models.json




          var isCustomProvider = smNameR && modelProviderMap.has(smNameR);




          if (smNameR && (isBuiltinProvider || isCustomProvider)) {




            var smModelR = smPartsR[1] ? smPartsR[1].trim() : (OAI_COMPAT_PROVIDERS[smNameR] ? OAI_COMPAT_PROVIDERS[smNameR].defaultModel : '');




            body.model = smModelR || body.model;








            provider = smNameR;




            touchLastRequest(req, smModelR, smNameR);




            smUsedR = true;




          }




        }




      }




      // Builtin model detection: runs BEFORE custom chain, overrides resolveProviderForModel result.




      // Priority: SINGLE_MODEL > builtin name-hint prefix > custom chain




      // NO key check — deepseek-v4-flash routes to deepseek backend even if DEEPSEEK_API_KEY is not set,




      // producing a clear auth error instead of silently falling back to an unrelated provider.




      if (!smUsedR) {




        var reqModelNR = normalizeModelId(originalModel);




        for (var [bNameR, bCfgR] of Object.entries(OAI_COMPAT_PROVIDERS)) {




          var hintsR = bNameR === 'deepseek' ? ['deepseek']




            : bNameR === 'mimo' ? ['mimo', 'xiaomi']




            : bNameR === 'openai' ? ['gpt-', 'o1-', 'o3-', 'o4-', 'chatgpt-']




            : bNameR === 'neizhi' ? ['neizhi']




            : [];




          if (hintsR.length && hintsR.some(function(h) { return reqModelNR.startsWith(h); })) {




            provider = bNameR;




            smUsedR = true;




            touchLastRequest(req, originalModel, bNameR);








            break;




          }




        }




      }




      if (!smUsedR && fbChain) {




        // Fallback enabled - try chain, fall back to builtin if chain is empty




        provider = await tryFallbackChain(req, body, res, originalInput, 'responses');




        if (!provider) return; // success or builtin already sent response




      }




      // Provider-lock enforcement: the inbound key dictates which upstream is allowed.




      // If body.model resolves to a different provider, refuse (the user almost certainly




      // forgot to /model after switching cc-switch profile, or is reusing a key).




      if (lock !== "*" && provider !== lock) {




        if (process.env.ACCESS_LOG !== "0") {




          log.access(`[access] 401 provider lock mismatch (key locks=${lock}, model=${body.model || "<none>"} -> provider=${provider})`);




        }




        sendJson(res, 401, {




          error: {




            message: `This proxy key is locked to provider "${lock}", but the request model "${body.model || "<none>"}" routes to "${provider}". Either switch model or use a different key.`,




            type: "invalid_request_error",




            code: "proxy_provider_lock",




          },




        });




        return;




      }









      if (provider === "openai") {




        if (!OPENAI_KEY) {




          sendJson(res, 400, { error: { message: "OPENAI_API_KEY is not configured" } });




          return;




        }




        const originalPreviousResponseId = body.previous_response_id || null;




        maybeResolvePreviousResponseChain(body, "openai");




        log.info(`[proxy] responses openai(${body.model || OPENAI_MODELS[0] || "default"}) | stream=${!!body.stream}`);




        await forwardOpenAIResponses(req, body, res, originalInput, originalPreviousResponseId);




        return;




      }









      if (OAI_COMPAT_PROVIDERS[provider]) {




        touchLastRequest(req, body.model, provider);




        await handleOaiCompatResponses(req, provider, body, res, originalInput, getClientFromReq(req));




        return;




      }









      sendJson(res, 400, { error: { message: `Unknown provider resolved: ${provider}` } });




    } catch (err) {




      const isFallback = err instanceof FallbackSkipError;




      const errMsg = err.message || String(err);




      const clientId = getClientFromReq(req);




      log.warn(`[proxy] ${isFallback ? 'upstream' : 'internal'} error:`, errMsg);









      // Only advance fallback for REAL upstream errors (FallbackSkipError).




      // Self-generated errors (network timeout, JSON parse, etc.) do NOT trigger switch.




      if (isFallback && COND_SWITCH_ENABLED) {




        advanceFallback(clientId, true);




      }









      if (!res.headersSent) {




        const accept = (req.headers['accept'] || '').toLowerCase();




        const isStreaming = accept.includes('text/event-stream') || accept.includes('text/stream');




        if (isStreaming) {




          const errEvent = `event: error\ndata: ${JSON.stringify({error: {message: 'request failed', type: 'upstream_error'}})}\n\n`;




          try { res.write(errEvent); } catch (_) {}




          try { res.end(); } catch (_) {}




        } else {




          sendJson(res, 200, {




            error: {




              message: 'request failed',




              type: 'upstream_error',




              status: 200,




            }




          });




        }




      } else {




        try { res.end(); } catch (_) {}




      }



    }




    return;




  }









  if (req.method === "POST" && (req.url === "/v1/chat/completions" || req.url === "/chat/completions")) {




    if (!settingsReady) { sendJson(res, 503, { error: { message: "Proxy still initializing, please retry" } }); return; }




    const body = await readJsonBody(req, res);




    if (!body) return;









    try {




      const lock = req.lockedProvider || "*";




      if (lock !== "*" && (!body.model || !String(body.model).trim())) {




        const lockCfg = OAI_COMPAT_PROVIDERS[lock];




        if (lockCfg) body.model = lockCfg.defaultModel;




        else if (lock === "openai") body.model = OPENAI_MODELS[0] || "";




      }




      // -- Virtual model / fallback routing (chat completions) --




      var provider = resolveProviderForModel(body.model);




      var isVirtual = VIRTUAL_MODEL_ID && body.model && body.model.toLowerCase() === VIRTUAL_MODEL_ID;









      // FIX: same fbChain logic as responses endpoint




      var fbChain2 = null;




      if (FALLBACK_ENABLED && fallbackChain.length > 0) {




        var clientId3 = getClientFromReq(req);




        var chain2 = buildFallbackChain(body.model, clientId3);




        if (chain2.length > 0) {




          fbChain2 = chain2;




        }




      }









      // Priority: SINGLE_MODEL config (per-client, always) > fallback chain (FALLBACK_ENABLED) > virtual model




      var clientId2 = getClientFromReq(req);




      var smCfg = clientId2 === 'HERMES' ? SINGLE_MODEL_HERMES : SINGLE_MODEL_CODEX;




      var smUsed = false;




      var originalModel2 = body.model; // preserve original for builtin detection




      if (smCfg) {




        var smParts2 = smCfg.split('|');




        if (smParts2.length >= 1) {




          var smName2 = smParts2[0].trim().toLowerCase();




          var isBuiltinProvider2 = smName2 && OAI_COMPAT_PROVIDERS[smName2] && OAI_COMPAT_PROVIDERS[smName2].key;




          var isCustomProvider2 = smName2 && modelProviderMap.has(smName2);




          if (smName2 && (isBuiltinProvider2 || isCustomProvider2)) {




            var smModel2 = smParts2[1] ? smParts2[1].trim() : (OAI_COMPAT_PROVIDERS[smName2] ? OAI_COMPAT_PROVIDERS[smName2].defaultModel : '');




            body.model = smModel2 || body.model;








            provider = smName2;




            touchLastRequest(req, smModel2, smName2);




            smUsed = true;




          }




        }




      }




            // Builtin model detection: runs BEFORE custom chain, overrides resolveProviderForModel result.




      // Priority: SINGLE_MODEL > builtin name-hint prefix > custom chain




      // NO key check — deepseek-v4-flash routes to deepseek backend even if DEEPSEEK_API_KEY is not set,




      // producing a clear auth error instead of silently falling back to an unrelated provider (shangtang1).




      if (!smUsed) {




        var reqModelN2 = normalizeModelId(originalModel2);




        for (var [bName2, bCfg2] of Object.entries(OAI_COMPAT_PROVIDERS)) {




          // Name-hint prefix match: deepseek-*, mimo-*, gpt-*, o1-*, etc. — NO bCfg2.key requirement




          var hints2 = bName2 === 'deepseek' ? ['deepseek']




            : bName2 === 'mimo' ? ['mimo', 'xiaomi']




            : bName2 === 'openai' ? ['gpt-', 'o1-', 'o3-', 'o4-', 'chatgpt-']




            : bName2 === 'neizhi' ? ['neizhi']




            : [];




          if (hints2.length && hints2.some(function(h) { return reqModelN2.startsWith(h); })) {




            provider = bName2;




            smUsed = true;




            touchLastRequest(req, originalModel2, bName2);








            break;




          }




        }




      }









      if (!smUsed && fbChain2) {




        provider = await tryFallbackChain(req, body, res, null, 'chat');




        if (!provider) return; // handled (success or fallback to builtin sent response)




      }




      if (lock !== "*" && provider !== lock) {




        if (process.env.ACCESS_LOG !== "0") {




          log.access(`[access] 401 provider lock mismatch (key locks=${lock}, model=${body.model || "<none>"} -> provider=${provider})`);




        }




        sendJson(res, 401, {




          error: {




            message: `This proxy key is locked to provider "${lock}", but the request model "${body.model || "<none>"}" routes to "${provider}". Either switch model or use a different key.`,




            type: "invalid_request_error",




            code: "proxy_provider_lock",




          },




        });




        return;




      }




      if (provider === "openai") {




        if (!OPENAI_KEY) {




          sendJson(res, 400, { error: { message: "OPENAI_API_KEY is not configured" } });




          return;




        }




        log.info(`[proxy] chat/completions openai(${body.model || OPENAI_MODELS[0] || "default"}) | stream=${!!body.stream}`);




        await forwardOpenAIChatCompletions(req, body, res);




        return;




      }









      if (OAI_COMPAT_PROVIDERS[provider]) {




        await handleOaiCompatChatCompletions(req, provider, body, res, getClientFromReq(req));




        return;




      }









      sendJson(res, 400, { error: { message: `Unknown provider resolved: ${provider}` } });




    } catch (err) {




      const isFallback = err instanceof FallbackSkipError;




      const errMsg = err.message || String(err);




      const clientId = getClientFromReq(req);




      log.warn(`[proxy] ${isFallback ? 'upstream' : 'internal'} error:`, errMsg);









      // Only advance fallback for REAL upstream errors (FallbackSkipError).




      // Self-generated errors do NOT trigger switch.




      if (isFallback && COND_SWITCH_ENABLED) {




        advanceFallback(clientId, true);




      }









      if (!res.headersSent) {




        const accept = (req.headers['accept'] || '').toLowerCase();




        const isStreaming = accept.includes('text/event-stream') || accept.includes('text/stream');




        if (isStreaming) {




          const errEvent = `event: error\ndata: ${JSON.stringify({error: {message: 'request failed', type: 'upstream_error'}})}\n\n`;




          try { res.write(errEvent); } catch (_) {}




          try { res.end(); } catch (_) {}




        } else {




          sendJson(res, 200, {




            error: {




              message: 'request failed',




              type: 'upstream_error',




              status: 200,




            }




          });




        }




      } else {




        try { res.end(); } catch (_) {}




      }



    }




    return;




  }









  sendJson(res, 404, { error: "Not found. Use POST /v1/responses" });




});









server.timeout = 0;




server.keepAliveTimeout = 300000;




server.headersTimeout = 300000;




server.requestTimeout = 0;









server.on('error', function(e) {




  console.error('[LUODA中转路由] Server bind error: ' + e.message);




  process.exit(1);




});




// -- Graceful shutdown -----------------------------------------
async function gracefulShutdown() {
  console.log("[LUODA中转路由] Draining connections & shutting down...");
  try {
    await triggerHotRestart();
    console.log("[LUODA中转路由] All requests drained, goodbye.");
  } catch {}
  process.exit(0);
}
process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

global.__luodabridge_start = Date.now();

server.listen(PORT, () => {




  console.log(`[LUODA中转路由] Listening on http://localhost:${PORT}`);




  console.log(`[LUODA中转路由] Default provider: ${getFallbackProvider()}`);




  for (const [name, cfg] of Object.entries(OAI_COMPAT_PROVIDERS)) {




    const label = name.charAt(0).toUpperCase() + name.slice(1);




    console.log(`[LUODA中转路由] ${label.padEnd(8)}: ${cfg.key ? `${cfg.base} | models=${cfg.models.join(", ")}` : "DISABLED"}`);




  }




  console.log(`[LUODA中转路由] OpenAI  : ${OPENAI_KEY ? `${OPENAI_BASE} | models=${OPENAI_MODELS.join(", ")}` : "DISABLED"}`);




  console.log(`[LUODA中转路由] GitHub  : ${process.env.GITHUB_TOKEN ? "authenticated (env)" : "lazy (will run `gh auth token` on first api.github.com fetch)"}`);




  if (!PROXY_AUTH_ENABLED) {




    console.log(`[LUODA中转路由] Inbound : OPEN - anyone on localhost can use this proxy (set PROXY_AUTH_KEY or PROXY_KEYS to lock down)`);




  } else {




    console.log(`[LUODA中转路由] Inbound : auth required (${PROXY_KEY_TABLE.size} key${PROXY_KEY_TABLE.size === 1 ? "" : "s"} loaded)`);




    for (const [key, lock] of PROXY_KEY_TABLE) {




      const lockLabel = lock === "*" ? "any provider" : `locked to ${lock}`;




      console.log(`[LUODA中转路由]           ${key.slice(0, 16)}... (${key.length} chars) - ${lockLabel}`);




    }




  }




});









// Load settings BEFORE servers start - eliminates startup 503 race




let settingsReady = false;




function loadSettings() {




  try {




    const cfg = loadConfigProxy();




    Object.assign(CONFIG_PROXY, cfg);




    if (cfg.fallback_enabled !== undefined) FALLBACK_ENABLED = cfg.fallback_enabled;




    if (cfg.single_model_codex !== undefined) SINGLE_MODEL_CODEX = String(cfg.single_model_codex);




    if (cfg.single_model_hermes !== undefined) SINGLE_MODEL_HERMES = String(cfg.single_model_hermes);




    if (cfg.virtual_model_id !== undefined) VIRTUAL_MODEL_ID = String(cfg.virtual_model_id).toLowerCase();




    if (cfg.fallback_sequence) {




      // Build name→displayName lookup from MODELS




      var __nl2 = {};




      var __di2 = {};




      MODELS.forEach(function(m) {




        var n = m.name || '', s = m.slug || '';




        var di = typeof m.idx === 'number' ? m.idx : 0;




        if (n) { __nl2[n.toLowerCase()] = n; __di2[n.toLowerCase()] = di; }




        if (s && n) { __nl2[s.toLowerCase()] = n; __di2[s.toLowerCase()] = di; }




        if (s && !n) { __nl2[s.toLowerCase()] = s; __di2[s.toLowerCase()] = di; }




      });




      fallbackChain.length = 0;




      String(cfg.fallback_sequence).split(";").forEach(function(e) {




        var p = e.split("|");




        var raw = p[0] ? p[0].trim() : '';




        var resolved = __nl2[raw.toLowerCase()] || raw;




        if (!resolved) return;




        var di2 = __di2[raw.toLowerCase()] || 0;




        if (p.length === 2) fallbackChain.push({ name: resolved, model: p[1].trim(), displayIdx: di2 });




        else if (p.length === 1 && raw) fallbackChain.push({ name: resolved, model: '', displayIdx: di2 });




      });




    }




    if (cfg._fallbackState) {




      fallbackState.currentIdx = cfg._fallbackState.currentIdx || 0;




      fallbackState.builtinSince = cfg._fallbackState.builtinSince || null;




      fallbackState.lastReset = cfg._fallbackState.lastReset || null;




    }




  } catch(e) { log.warn("[settings] reload error:", e.message); }




  settingsReady = true;




}




loadSettings(); // MUST be before startConfigServer - servers refuse requests until ready









// Start background health check + servers - AFTER settings loaded




startHealthCheck();




startConfigServer();









// Guard: block requests until initial loadSettings has run (fixes startup race)




