/**
 * Fallback / Failover Module
 *
 * Manages two independent fallback chains:
 *   - CODEX chain (fallbackChain from codex_fallback_sequence)
 *   - HERMES chain (hermesChain from hermes_fallback_sequence)
 * Each client has its own idx pointer for independent rotation.
 * Both share the same countdown timer (switched together on auto-rotate).
 */

import { log } from "./logger.mjs";
import { CONFIG_PROXY, saveJSON, PATHS, MODELS } from "./config.mjs";
import { getAll, find } from "./provider-registry.mjs";
import { dbGetAllModels } from "./admin-db.mjs";
import { initAbnormalState, isAbnormal, addAbnormal, removeAbnormal, getAbnormalList, getAbnormalReasons, getReason, syncFromRaw } from "./abnormal-state.mjs";

// ── Config version tracker (kept for backward compat, no longer used for gate) ──
let _lastConfigVersion = 0;

function syncFromConfig() {
  // ★ 移除 updated_at 版本检查：CONFIG_PROXY 可能被 SQLite 异步更新，
  //   但 updated_at 是独立的列不在 JSON data 中，导致版本检查永远无法通过。
  //   改为每次调用都重新读取，确保单例模式等设置始终锁定。
  _fallbackEnabled = CONFIG_PROXY.fallback_enabled !== false;
  _condSwitchEnabled = CONFIG_PROXY.cond_switch_enabled !== undefined
    ? !!CONFIG_PROXY.cond_switch_enabled : true;
  _singleModelCodex = CONFIG_PROXY.single_model_codex || "";
  _singleModelHermes = CONFIG_PROXY.single_model_hermes || "";
  // ★ 恢复持久化的锁定模型额度耗尽状态，防止重启后回到已耗尽的锁定模型
  if (CONFIG_PROXY._lockExhaustedUntil && typeof CONFIG_PROXY._lockExhaustedUntil === 'object') {
    for (var _lk in CONFIG_PROXY._lockExhaustedUntil) {
      if (CONFIG_PROXY._lockExhaustedUntil[_lk] > Date.now()) {
        _lockExhaustedUntil[_lk] = CONFIG_PROXY._lockExhaustedUntil[_lk];
      }
    }
  }
  const rawCodex = CONFIG_PROXY.codex_fallback_sequence || CONFIG_PROXY.fallback_sequence || "";
  const rawHermes = CONFIG_PROXY.hermes_fallback_sequence || rawCodex;
  
  // ★ 自动从 models.json 重建序列：模型重命名/增删后自动生效（30s 节流）
  if (!CONFIG_PROXY._autoRebuiltAt || Date.now() - CONFIG_PROXY._autoRebuiltAt >= 30000) {
    autoRebuildSequences(rawCodex, rawHermes);
  }
  
  // Use possibly-rebuilt values for chain building
  var rebuiltCodex = CONFIG_PROXY.codex_fallback_sequence || CONFIG_PROXY.fallback_sequence || "";
  var rebuiltHermes = CONFIG_PROXY.hermes_fallback_sequence || rebuiltCodex;
  
  // ★ 用统一 abnormal-state 模块做兼容映射，保留用户原始输入
  syncFromRaw(CONFIG_PROXY.abnormal_models || [], CONFIG_PROXY._abnormal_reasons || {});

  // 从 DB 构建 name→slug 映射（链存名称如"智谱2"，异常列表存 slug 如"zhipu2"）
  var nameToSlug = {};
  try {
    var dbModels = dbGetAllModels() || [];
    dbModels.forEach(function(m){
      if (m.name && m.slug) nameToSlug[m.name.toLowerCase()] = m.slug.toLowerCase();
    });
  } catch(e) { /* fall through */ }

  // ★ 自动检查到期的模型并标记异常
  _checkExpiredModels();

  function filterAbnormal(raw) {
    return raw.split(";").filter(function(s){
      if (!s) return false;
      var key = s.trim();
      if (!key) return false;
      if (isAbnormal(key)) return false;
      var mapped = nameToSlug[key.toLowerCase()];
      if (mapped && isAbnormal(mapped)) return false;
      return true;
    }).join(";");
  }
  var hermesSet = {};
  hermesChain.forEach(function(e){ hermesSet[e.name.toLowerCase()] = true; });
  var codexResolved = {};
  fallbackChain.forEach(function(e){ codexResolved[e.name.toLowerCase()] = true; });
  // buildChain called below with the rebuilt sequences
  // (the two declarations above are unused remnants and kept for compat)
  buildChain(fallbackChain, filterAbnormal(rebuiltCodex));
  buildChain(hermesChain, filterAbnormal(rebuiltHermes));
  
  // ★ 去掉 CODEX 中与 HERMES 重复的模型（优先保留 HERMES）
  var hermesNames = {};
  hermesChain.forEach(function(e){ hermesNames[e.name.toLowerCase()] = true; });
  for (var i = fallbackChain.length - 1; i >= 0; i--) {
    if (hermesNames[fallbackChain[i].name.toLowerCase()]) {
      fallbackChain.splice(i, 1);
    }
  }
}

/**
 * Auto-rebuild fallback sequences from models.json when models are renamed/added/removed.
 * Runs inside syncFromConfig() before buildChain().
 * If the static sequence has entries that can't be resolved (renamed), regenerates.
 */
function autoRebuildSequences(rawCodex, rawHermes) {
  var models = MODELS;
  if (!Array.isArray(models) || models.length === 0) return;
  
  var abnormalList = getAbnormalList().map(function(a){ return a.toLowerCase(); });
  
  // Check if any model in the static sequence can't be found
  // Also check if models.json has models not in the sequence
  var staticCodexNames = rawCodex.split(";").map(function(s){ return s.trim().toLowerCase(); }).filter(Boolean);
  var staticHermesNames = rawHermes.split(";").map(function(s){ return s.trim().toLowerCase(); }).filter(Boolean);
  
  // Build lookup from provider registry (support slug-to-name mapping)
  var allProviders = getAll();
  var providerNames = {};
  var slugToName = {};
  allProviders.forEach(function(p){ 
    providerNames[p.name.toLowerCase()] = p.name;
    if (p.slug && p.slug !== p.name) {
      providerNames[p.slug.toLowerCase()] = p.name;
      slugToName[p.slug.toLowerCase()] = p.name;
    }
  });
  
  // Check for stale entries (resolve slugs to names first)
  function resolveSeqName(n) {
    if (!n) return null;
    return providerNames[n] || null;
  }
  var hasStaleCodex = staticCodexNames.some(function(n){ return n && !resolveSeqName(n); });
  var hasStaleHermes = staticHermesNames.some(function(n){ return n && !resolveSeqName(n); });
  
  if (!hasStaleCodex && !hasStaleHermes) return; // All entries valid, no rebuild needed
  
  log.info("[fallback] stale model names detected, auto-rebuilding sequences from models.json");
  
  // Sort models by idx
  models.sort(function(a,b){ return (a.idx || 999) - (b.idx || 999); });
  
  // Start with the ADMIN's hermes list (the user has explicitly chosen these)
  var hermesNames = {};
  staticHermesNames.forEach(function(n){ 
    if (providerNames[n] || n) hermesNames[n] = true; 
  });
  
  // Build new codex: sort by idx, skip abnormal, skip hermes
  var newCodex = [];
  var newHermes = [];
  for (var i = 0; i < models.length; i++) {
    var m = models[i];
    var name = m.name;
    var slug = (m.slug || "").toLowerCase();
    if (abnormalList.indexOf(name.toLowerCase()) >= 0 || abnormalList.indexOf(slug) >= 0) continue;
    // Check if this model is in the HERMES list (by resolved name or slug)
    var isHermes = false;
    for (var h = 0; h < staticHermesNames.length; h++) {
      var resolved = resolveSeqName(staticHermesNames[h]);
      if (resolved && (resolved.toLowerCase() === name.toLowerCase() || resolved.toLowerCase() === slug)) {
        isHermes = true;
        break;
      }
    }
    if (isHermes) {
      newHermes.push(name);
    } else {
      newCodex.push(name);
    }
  }
  
  var newCodexStr = newCodex.join(";");
  var newHermesStr = newHermes.join(";");
  
  log.info("[fallback] auto-rebuilt: codex=" + newCodex.length + " hermes=" + newHermes.length + " models");
  
  // Update CONFIG_PROXY in-place
  CONFIG_PROXY.codex_fallback_sequence = newCodexStr;
  CONFIG_PROXY.hermes_fallback_sequence = newHermesStr;
  CONFIG_PROXY.fallback_sequence = newCodexStr;
  
  // Persist to files so changes survive restart
  CONFIG_PROXY._autoRebuiltAt = Date.now();
  persistConfig();
  
  // Re-read the raw vars since we changed them
  rawCodex = newCodexStr;
  rawHermes = newHermesStr;
}

// ── State ──
const fallbackChain = [];    // CODEX 专用链
const hermesChain = [];      // HERMES 专用链
let _fallbackEnabled = CONFIG_PROXY.fallback_enabled !== false;
let _condSwitchEnabled = CONFIG_PROXY.cond_switch_enabled !== undefined
  ? CONFIG_PROXY.cond_switch_enabled : true;
let _singleModelCodex = CONFIG_PROXY.single_model_codex || "";
let _singleModelHermes = CONFIG_PROXY.single_model_hermes || "";

// ── Client-specific indices ──
const clientState = {
  CODEX: {
    idx: typeof CONFIG_PROXY?._fallbackState?.codexIdx === 'number' ? CONFIG_PROXY._fallbackState.codexIdx : 0,
    lastSwitch: 0, lastModel: null, lastProvider: null
  },
  HERMES: {
    idx: typeof CONFIG_PROXY?._fallbackState?.hermesIdx === 'number' ? CONFIG_PROXY._fallbackState.hermesIdx : 0,
    lastSwitch: 0, lastModel: null, lastProvider: null
  },
};

let _lastSwitchTs = CONFIG_PROXY?._fallbackState?.lastSwitch || 0;
const SWITCH_COOLDOWN_MS = 2000;
const LOCK_EXHAUSTED_TTL = 300000; // 5分钟：锁定模型额度耗尽后，临时绕过锁定的时长

// ★ 切换互斥锁：防止并发请求同 clientId 导致双倍推进
const _switchingLock = {};

// ★ 记录锁定模型额度耗尽的时间戳（clientId → timestamp）
//   当锁定模型没额度时，临时跳过它用 idx 推进的模型，避免死循环
const _lockExhaustedUntil = {};

/**
 * Get the chain array for a given client.
 */
function getChainFor(clientId) {
  return clientId === "HERMES" ? hermesChain : fallbackChain;
}

// ── Auto-rotate timer ──
// ★ 自动轮训已迁移至 config-api.mjs 的 countdown daemon 统一管理
//   fallback.mjs 不再维护独立轮训定时器，避免与倒计时守护冲突。
//   详见 config-api.mjs line~1186 的 setInterval 守护逻辑。
//   倒计时守护每 10s 检查一次，使用 clearSingleAndAdvance 进行切换，
//   支持锁定模型下的强制切换和倒计时重置。

export function initFallback() {
  const rawCodex = CONFIG_PROXY.codex_fallback_sequence || CONFIG_PROXY.fallback_sequence || "";
  const rawHermes = CONFIG_PROXY.hermes_fallback_sequence || rawCodex;
  // ★ 构建链时自动过滤异常模型
  const abnormalList = getAbnormalList().map(function(a){ return a.toLowerCase(); });
  // 从 DB 构建 name→slug 映射（链存名称如"智谱2"，异常列表存 slug 如"zhipu2"）
  var nameToSlug = {};
  try {
    var dbModels = dbGetAllModels() || [];
    dbModels.forEach(function(m){
      if (m.name && m.slug) nameToSlug[m.name.toLowerCase()] = m.slug.toLowerCase();
    });
  } catch(e) { /* fall through */ }

  // ★ 自动检查到期的模型并标记异常
  _checkExpiredModels();

  function filterAbnormal(raw) {
    return raw.split(";").filter(function(s){
      if (!s) return false;
      var key = s.trim();
      if (!key) return false;
      if (isAbnormal(key)) return false;
      var mapped = nameToSlug[key.toLowerCase()];
      if (mapped && isAbnormal(mapped)) return false;
      return true;
    }).join(";");
  }
  buildChain(fallbackChain, filterAbnormal(rawCodex));
  buildChain(hermesChain, filterAbnormal(rawHermes));
  // ★ 去掉 CODEX 中与 HERMES 重复的模型（优先保留 HERMES）
  var hermesNames = {};
  hermesChain.forEach(function(e){ hermesNames[e.name.toLowerCase()] = true; });
  for (var i = fallbackChain.length - 1; i >= 0; i--) {
    if (hermesNames[fallbackChain[i].name.toLowerCase()]) {
      fallbackChain.splice(i, 1);
    }
  }

  _singleModelCodex = CONFIG_PROXY.single_model_codex || "";
  _singleModelHermes = CONFIG_PROXY.single_model_hermes || "";

  function validateLock(lockName, clientLabel) {
    if (!lockName) return lockName;
    const provider = find(lockName);
    if (!provider) {
      log.warn("[fallback] " + clientLabel + " locked to \"" + lockName + "\" but provider not found, clearing lock");
      return "";
    }
    if (isAbnormal(provider.slug || provider.name) || isAbnormal(provider.name)) {
      log.warn("[fallback] " + clientLabel + " locked to abnormal provider \"" + lockName + "\", clearing lock");
      return "";
    }
    return lockName;
  }
  _singleModelCodex = validateLock(_singleModelCodex, "CODEX");
  _singleModelHermes = validateLock(_singleModelHermes, "HERMES");

  _lastSwitchTs = Date.now();
  // ★ 启动时初始化倒计时，仅一次
  CONFIG_PROXY._countdown_start = _lastSwitchTs;
  _fallbackEnabled = CONFIG_PROXY.fallback_enabled !== undefined ? !!CONFIG_PROXY.fallback_enabled : true;
  _condSwitchEnabled = CONFIG_PROXY.cond_switch_enabled !== undefined ? !!CONFIG_PROXY.cond_switch_enabled : true;
  log.info("[fallback] initialized: codexChain=" + fallbackChain.length + " hermesChain=" + hermesChain.length +
    " providers, enabled=" + _fallbackEnabled + ", codexLock=" + (_singleModelCodex || "(none)") + ", hermesLock=" + (_singleModelHermes || "(none)"));

  // ★ 自动轮训由 config-api.mjs 的 countdown daemon 统一管理
  // startRotateTimer() 已移除，详见上方注释
}

/**
 * Rebuild a chain array from raw sequence string.
 */
function buildChain(chain, raw) {
  chain.length = 0;
  if (!raw) return;

  const nameLookup = {};
  for (const p of getAll()) {
    nameLookup[(p.name || "").toLowerCase()] = p.name;
    if (p.slug && p.slug !== p.name) {
      nameLookup[(p.slug || "").toLowerCase()] = p.name;
    }
  }

  for (const entry of raw.split(";")) {
    const parts = entry.split("|");
    const rawName = (parts[0] || "").trim();
    const modelId = parts[1] ? parts[1].trim() : "";
    const resolvedName = nameLookup[rawName.toLowerCase()] || rawName;

    if (resolvedName) {
      chain.push({ name: resolvedName, model: modelId, raw: entry });
    }
  }
}

export function resetRotationTimer() {
  _lastSwitchTs = Date.now();
  CONFIG_PROXY._countdown_start = _lastSwitchTs;
  log.info("[fallback] rotation timer reset to now, caller=" + new Error().stack.split('\n')[2].trim());
}

/**
 * Get current fallback chain for a client.
 */
export function getChain(clientId = "CODEX") {
  return [...getChainFor(clientId)];
}

/**
 * Get current sequence as semicolon-separated string.
 */
export function getChainString(clientId = "CODEX") {
  const chain = getChainFor(clientId);
  return chain.map(e => e.raw || e.name).join(";");
}

/**
 * Get ALL chain strings for status display.
 */
export function getAllChainStrings() {
  return {
    codex: getChainString("CODEX"),
    hermes: getChainString("HERMES"),
  };
}

/**
 * Replace the entire fallback chain for a client.
 */
export function setChain(raw, clientId = "CODEX") {
  const chain = getChainFor(clientId);
  buildChain(chain, raw);
  const key = clientId === "HERMES" ? "hermes_fallback_sequence" : "codex_fallback_sequence";
  CONFIG_PROXY[key] = raw;
  CONFIG_PROXY.fallback_sequence = getChainString("CODEX");
  persistConfig();
  return true;
}

export function getSettings() {
  return {
    enabled: _fallbackEnabled,
    condSwitch: _condSwitchEnabled,
    singleModelCodex: _singleModelCodex,
    singleModelHermes: _singleModelHermes,
    fallbackIntervalMinutes: CONFIG_PROXY.fallback_interval_minutes || 45,
  };
}

export function updateSettings(settings) {
  if (!settings || typeof settings !== 'object') return;
  if (settings.fallback_enabled !== undefined) _fallbackEnabled = settings.fallback_enabled;
  if (settings.cond_switch_enabled !== undefined) _condSwitchEnabled = settings.cond_switch_enabled;
  if (settings.single_model_codex !== undefined) {
    _singleModelCodex = settings.single_model_codex;
    // 用户手动设置锁 → 清除 _lockClearedByFallback 标记，允许 reload 生效
    if (settings.single_model_codex) delete CONFIG_PROXY._lockClearedByFallback;
  }
  if (settings.single_model_hermes !== undefined) {
    _singleModelHermes = settings.single_model_hermes;
    if (settings.single_model_hermes) delete CONFIG_PROXY._lockClearedByFallback;
  }
  Object.assign(CONFIG_PROXY, settings);
  if (settings.single_model_codex !== undefined) {
    var _newCodexVal = settings.single_model_codex;
    if (_newCodexVal) {
      var _codexPos = fallbackChain.findIndex(function(e) { return e.name === _newCodexVal; });
      if (_codexPos >= 0) clientState.CODEX.idx = _codexPos;
    }
  }
  if (settings.single_model_hermes !== undefined) {
    var _newHermesVal = settings.single_model_hermes;
    if (_newHermesVal) {
      var _hermesPos = hermesChain.findIndex(function(e) { return e.name === _newHermesVal; });
      if (_hermesPos >= 0) clientState.HERMES.idx = _hermesPos;
    }
  }
  persistConfig();
}

/**
 * Get the current provider for a client using its own chain.
 */
export function getCurrentProvider(clientId = "CODEX") {
  syncFromConfig();
  const chain = getChainFor(clientId);
  if (!_fallbackEnabled || chain.length === 0) return null;

  const singleModel = clientId === "HERMES" ? _singleModelHermes : _singleModelCodex;
  if (singleModel) {
    const provider = find(singleModel);
    // ★ 必须精确匹配（slug 或 name），避免 find() 的模糊匹配返回错误的提供者
    if (provider && (provider.slug === singleModel || provider.name === singleModel)) {
      // ★ 检查锁定模型是否已被标记为异常
      if (isAbnormal(provider.slug || provider.name) || isAbnormal(provider.name)) {
        log.info(`[fallback] ${clientId} lock "${singleModel}" is abnormal, using chain idx`);
        // 不返回锁定模型，降级走 idx 推进
      } else {
        // ★ 锁定模型额度耗尽时，临时跳过锁定
        const exhaustedUntil = _lockExhaustedUntil[clientId];
        if (!exhaustedUntil || Date.now() > exhaustedUntil) {
          // 锁定有效：返回锁定模型
          return provider;
        }
        // 锁定模型还在耗尽期内，降级走 idx 推进
        log.info(`[fallback] ${clientId} lock "${singleModel}" temporarily exhausted, using chain idx`);
      }
    }
  }

  const state = clientState[clientId] || clientState.CODEX;

  for (let attempt = 0; attempt < 2; attempt++) {
    const idx = (state.idx + attempt) % chain.length;
    const entry = chain[idx];
    if (!entry) continue;
    const provider = find(entry.name);
    if (!provider) continue;

    if (isAbnormal(provider.slug || provider.name) || isAbnormal(provider.name)) {
      log.info("[fallback] skipping abnormal: " + provider.name);
      continue;
    }

    // ★ getCurrentProvider is read-only, does not mutate state.idx
    return provider;
  }

  // Full chain scan as last resort
  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    if (!entry) continue;
    const provider = find(entry.name);
    if (!provider) continue;
    if (isAbnormal(provider.slug || provider.name) || isAbnormal(provider.name)) continue;
    state.idx = i;
    log.info(`[fallback] ${clientId}: full scan found "${entry.name}" at idx=${i}`);
    return provider;
  }
  log.warn(`[fallback] ${clientId}: no valid provider in chain`);
  return null;
}

export function advanceFallback(clientId = "CODEX", force = false) {
  syncFromConfig();
  const chain = getChainFor(clientId);
  if (!_fallbackEnabled || (!_condSwitchEnabled && !force)) return null;
  if (chain.length === 0) return null;

  // ★ 并发互斥（计数器）：同一 clientId 正在推进中则跳过
  var lockKey = clientId === "ALL" ? "CODEX_HERMES" : clientId;
  var depth = _switchingLock[lockKey] || 0;
  // depth>0 且当前没有被 clearSingleAndAdvance 包裹说明是并发请求
  if (depth > 1) {
    log.info("[fallback] " + lockKey + " switch already in progress, skipping concurrent request");
    return null;
  }
  _switchingLock[lockKey] = depth + 1;

  try {

  const now = Date.now();
  if (now - _lastSwitchTs < SWITCH_COOLDOWN_MS && !force) return null;

  const state = clientState[clientId] || clientState.CODEX;

  // Advance exactly 1 position, never skip models
  state.idx = (state.idx + 1) % chain.length;
  const entry = chain[state.idx];
  if (entry) {
    _lastSwitchTs = now;
    state.lastSwitch = now;
    log.info(`[fallback] ${clientId} advanced to "${entry.name}" (idx=${state.idx})`);
    persistConfig();
    const provider = find(entry.name);
    return provider || null;
  }

  return null;

  } finally {
    _switchingLock[lockKey] = false;
  }
}

// ★ 记录每个 provider 的额度检测状态（用于判断是否真正异常）
//   只有当 "首次检测" 和 "末次检测" 都为0，且中间无成功记录，并且时间窗口 >= 24小时 时，才放入异常
//   一旦中间有成功请求，立即重置所有状态，重新开始循环
var _providerQuotaState = {};
var ABNORMAL_WINDOW_MS = 24 * 60 * 60 * 1000; // 24小时

function recordQuotaCheck(providerName, isSuccess, quotaResult) {
  var now = Date.now();
  var pKey = (providerName || '').toLowerCase();
  var state = _providerQuotaState[pKey];

  if (isSuccess) {
    delete _providerQuotaState[pKey];
    log.info("[quota] provider=" + providerName + " 请求成功，重置所有状态，重新开始循环");
    return;
  }

  // 失败 → 记录或更新状态
  if (!state) {
    // 首次失败
    state = _providerQuotaState[pKey] = {
      firstFailTime: now,
      lastFailTime: now,
      quotaResult: quotaResult
    };
    log.info("[quota] provider=" + providerName + " 首次失败，firstFailTime=" + now);
  } else {
    // 再次失败 → 更新末次检测时间
    state.lastFailTime = now;
    state.quotaResult = quotaResult;
    log.info("[quota] provider=" + providerName + " 再次失败，lastFailTime=" + now + ", 首次=" + state.firstFailTime + ", 时间差=" + Math.round((now - state.firstFailTime) / 60000) + "分钟");
  }
}

function isTrulyAbnormal(providerName) {
  var pKey = (providerName || '').toLowerCase();
  var state = _providerQuotaState[pKey];
  if (!state) return false;
  if (!state.firstFailTime || !state.lastFailTime) return false;

  // 核心判定：首次=0, 末次=0, 中间无成功(状态未重置), 时间窗口>=5小时
  var timeWindowOk = (state.lastFailTime - state.firstFailTime) >= ABNORMAL_WINDOW_MS;

  if (timeWindowOk) {
    log.warn("[quota] provider=" + providerName + " 确认为真正异常（首次=" + state.firstFailTime + ", 末次=" + state.lastFailTime + ", 时间差=" + Math.round((state.lastFailTime - state.firstFailTime) / 60000) + "分钟 >= 5小时）");
  } else {
    log.info("[quota] provider=" + providerName + " 未达异常阈值（时间差=" + Math.round((state.lastFailTime - state.firstFailTime) / 60000) + "分钟 < 5小时）");
  }

  return timeWindowOk;
}

function clearQuotaState(providerName) {
  var pKey = (providerName || '').toLowerCase();
  delete _providerQuotaState[pKey];
  log.info("[quota] 已重置 provider=" + providerName + " 的额度检测状态，重新开始循环");
}

export { clearQuotaState };

/**
 * Check if the locked model for a client is currently exhausted.
 * Used by server.mjs to bypass findForModel when the lock is exhausted.
 */
export function isLockExhausted(clientId, providerName) {
  const singleModel = clientId === "HERMES" ? _singleModelHermes : _singleModelCodex;
  if (!singleModel || !providerName) return false;
  if (providerName.toLowerCase() !== singleModel.toLowerCase()) return false;
  const exhaustedUntil = _lockExhaustedUntil[clientId === "ALL" ? "CODEX" : clientId];
  return exhaustedUntil && Date.now() < exhaustedUntil;
}

export function clearSingleAndAdvance(clientId, force = false, prevProviderName = null) {
  
  if (!_condSwitchEnabled && !force) return null;

  // ★ 并发互斥（计数器）：同一 clientId 正在切换中则跳过
  var lockKey = clientId === "ALL" ? "CODEX_HERMES" : clientId;
  var depth = _switchingLock[lockKey] || 0;
  if (depth > 0) {
    log.info("[fallback] " + lockKey + " switch already in progress by another request, skipping");
    return null;
  }
  _switchingLock[lockKey] = depth + 1;
  try {

  const singleModel = clientId === "HERMES" ? _singleModelHermes : _singleModelCodex;
  const chain = getChainFor(clientId);

  // ★ 标记锁定模型为"临时耗尽"，getCurrentProvider 会跳过它用 idx 路由
  //   5分钟后过期，锁定自动恢复。这样不会永久丢失用户的手动锁定。
  // ★ 设置锁定模型临时耗尽标志，getCurrentProvider 会在 LOCK_EXHAUSTED_TTL 内绕过锁
  //   使用 idx 路由。过期后自动恢复锁定，不需要清 _singleModelCodex。
  _lockExhaustedUntil[clientId === "ALL" ? "CODEX" : clientId] = Date.now() + LOCK_EXHAUSTED_TTL;

  // ★ 如果 prevProviderName 是当前锁定模型 → 彻底清除锁（不是临时跳过）
  //   因为用户关闭了自动切换，遇到额度耗尽必须刚性切到下一模型，不能5分钟后回退。
  //   清除后用户可通过管理后台手动重新锁定。
  if (prevProviderName && singleModel && prevProviderName.toLowerCase() === singleModel.toLowerCase()) {
    if (clientId === "HERMES" || clientId === "ALL") {
      _singleModelHermes = "";
      CONFIG_PROXY.single_model_hermes = "";
    }
    if (clientId === "CODEX" || clientId === "ALL") {
      _singleModelCodex = "";
      CONFIG_PROXY.single_model_codex = "";
      // ★ 同时在 CONFIG_PROXY 标记运行时已清除锁，让 reloadConfig 跳过 DB 覆盖
      CONFIG_PROXY._lockClearedByFallback = true;
    }
    log.warn(`[fallback] ${clientId} lock "${singleModel}" quota exhausted — LOCK CLEARED permanently`);
  }
  // ★ 不清 _singleModelCodex！_lockExhaustedUntil 过期后自动恢复锁定。
  //   清掉它会导致锁永久丢失，直到 syncFromConfig() 或服务重启。
  // if (clientId === "CODEX" || clientId === "ALL") { _singleModelCodex = ""; }
  // if (clientId === "HERMES" || clientId === "ALL") { _singleModelHermes = ""; }

  if (singleModel) {
    const state = clientState[clientId] || clientState.CODEX;
    // ★ 修正：singleModel 可能是 slug（如 "0705"），但链存的是名称（如 "阶跃星辰-0705"）
    //   先用 find() 通过 slug 找到 provider，再用 provider.name 找位置
    const _provider = find(singleModel);
    const _targetName = _provider ? _provider.name : singleModel;
    const pos = chain.findIndex(function(e) { return e.name === _targetName; });
    if (pos >= 0) {
      state.idx = pos;
    }
  }

  // ★ 如果传入 prevProviderName（表示之前发生额度耗尽的 provider），
  //   记录额度检测结果，检查是否满足5小时窗口判定
  if (prevProviderName) {
    recordQuotaCheck(prevProviderName, false, 0);
    if (isTrulyAbnormal(prevProviderName)) {
      var alreadyAbnormal = isAbnormal(prevProviderName);
      if (!alreadyAbnormal) {
        var _otherPending = Object.keys(_providerQuotaState).filter(function(k) {
          if (k === (prevProviderName || '').toLowerCase()) return false;
          var s = _providerQuotaState[k];
          if (!s || !s.firstFailTime || !s.lastFailTime) return false;
          return isTrulyAbnormal(k);
        });
        if (_otherPending.length > 0) {
          log.warn("[fallback] provider=" + prevProviderName + " 跳过异常判定，本批次已有待进入异常模型: " + _otherPending.join(','));
        } else {
          addAbnormal(prevProviderName, 'quota-5h');
          // ★ 关键：将 abnormal-state 内存状态同步回 CONFIG_PROXY，确保 persistConfig() 写入正确数据
          CONFIG_PROXY.abnormal_models = getAbnormalList();
          CONFIG_PROXY._abnormal_reasons = getAbnormalReasons();
          log.warn("[fallback] 将 provider=" + prevProviderName + " 加入异常列表（通过5小时时间窗口判定）");
        }
      }
    }
  }

  const provider = advanceFallback(clientId, force);
  persistConfig();
  return provider;

  } finally {
    _switchingLock[lockKey] = false;
  }
}

export function getFullStatus() {
  // ★ 获取当前提供者（不改变 state、idx 或 lastSwitch）
  const codexProvider = getCurrentProvider("CODEX");
  const hermesProvider = getCurrentProvider("HERMES");

  const stateCODEX = clientState.CODEX;
  const stateHERMES = clientState.HERMES;

  // ★ codex_cur_slug：优先使用 single_model，提供稳定的引用
  //    如果锁定模型额度已耗尽（_lockExhaustedUntil 有效期内），使用实际链上 provider
  var codexCurSlug = _singleModelCodex || (codexProvider ? codexProvider.slug : null);
  var hermesCurSlug = _singleModelHermes || (hermesProvider ? hermesProvider.slug : null);
  var _now = Date.now();
  if (_singleModelCodex && _lockExhaustedUntil["CODEX"] && _now < _lockExhaustedUntil["CODEX"]) {
    codexCurSlug = codexProvider ? codexProvider.slug : null;
  }
  if (_singleModelHermes && _lockExhaustedUntil["HERMES"] && _now < _lockExhaustedUntil["HERMES"]) {
    hermesCurSlug = hermesProvider ? hermesProvider.slug : null;
  }

  return {
    fallback_enabled: _fallbackEnabled,
    cond_switch_enabled: _condSwitchEnabled,
    fallback_interval_minutes: CONFIG_PROXY.fallback_interval_minutes || 45,
    fallback_chain: fallbackChain.map(e => ({ name: e.name, model: e.model })),
    fallback_sequence: getChainString("CODEX"),
    hermes_chain: hermesChain.map(e => ({ name: e.name, model: e.model })),
    hermes_sequence: getChainString("HERMES"),
    fallback_state: {
      lastSwitch: _lastSwitchTs,
      codexIdx: stateCODEX.idx,
      hermesIdx: stateHERMES.idx,
    },
    codex_cur_slug: codexCurSlug,
    codex_actual_model: codexProvider ? codexProvider.modelId : null,
    codex_idx: stateCODEX.idx,
    hermes_cur_slug: hermesCurSlug,
    hermes_actual_model: hermesProvider ? hermesProvider.modelId : null,
    hermes_idx: stateHERMES.idx,
    provider_health: {},
    uptime: process.uptime(),
  };
}

function persistConfig() {
  var _lee = {};
  for (var _k in _lockExhaustedUntil) {
    if (_lockExhaustedUntil[_k] && _lockExhaustedUntil[_k] > Date.now()) {
      _lee[_k] = _lockExhaustedUntil[_k];
    }
  }
  saveJSON(PATHS.configProxy, {
    ...CONFIG_PROXY,
    codex_fallback_sequence: getChainString("CODEX"),
    hermes_fallback_sequence: getChainString("HERMES"),
    _fallbackState: {
      codexIdx: clientState.CODEX.idx,
      hermesIdx: clientState.HERMES.idx,
      lastSwitch: _lastSwitchTs,
    },
    _lockExhaustedUntil: Object.keys(_lee).length > 0 ? _lee : undefined,
  });
}

// ★ 检查到期模型并自动标记异常
function _checkExpiredModels(){
  var nowStr = new Date().toISOString().slice(0,10);
  var changed = false;
  try {
    var models = dbGetAllModels() || [];
    models.forEach(function(m){
      var extra = {};
      try { extra = JSON.parse(m.extra || "{}"); } catch(e) {}
      var expiresAt = extra.expires_at;
      if (expiresAt && expiresAt < nowStr) {
        // ★ 保留原始 slug/name，由 abnormal-state 内部去重
        var candidate = m.slug || m.name;
        if (candidate && addAbnormal(candidate, '已到期 (' + expiresAt + ')')) {
          changed = true;
          log.info("[fallback] auto-abnormal (expired): " + (m.name || m.slug));
        }
      }
    });
  } catch(e) {}
  if (changed) {
    CONFIG_PROXY.abnormal_models = getAbnormalList();
    CONFIG_PROXY._abnormal_reasons = getAbnormalReasons();
  }
}
