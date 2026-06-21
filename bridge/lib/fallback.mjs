/**
 * Fallback / Failover Module
 *
 * Manages the fallback sequence for automatic provider switching.
 * Supports CODEX and HERMES client tracking with independent indices.
 */

import { log } from "./logger.mjs";
import { CONFIG_PROXY, saveJSON, PATHS } from "./config.mjs";
// ★ 不再 import checkAndReloadIfNeeded — 由 server.mjs 后台定时器统一刷新
import { getAll, find } from "./provider-registry.mjs";

// ── Config version tracker (to detect CONFIG_PROXY updates from background timer) ──
let _lastConfigVersion = 0;

/**
 * Sync local variables from CONFIG_PROXY (called by getCurrentProvider / advanceFallback).
 * Zero-cost when config hasn't changed (just a number comparison).
 */
function syncFromConfig() {
  const v = CONFIG_PROXY.updated_at || 0;
  if (v === _lastConfigVersion) return;
  _lastConfigVersion = v;
  _fallbackEnabled = CONFIG_PROXY.fallback_enabled !== false;
  _condSwitchEnabled = CONFIG_PROXY.cond_switch_enabled !== undefined
    ? !!CONFIG_PROXY.cond_switch_enabled : true;
  _singleModelCodex = CONFIG_PROXY.single_model_codex || "";
  _singleModelHermes = CONFIG_PROXY.single_model_hermes || "";
  const raw = CONFIG_PROXY.fallback_sequence || "";
  buildChain(raw);
}

// ── State ──
const fallbackChain = [];
let _fallbackEnabled = CONFIG_PROXY.fallback_enabled !== false;
let _condSwitchEnabled = CONFIG_PROXY.cond_switch_enabled !== undefined
  ? CONFIG_PROXY.cond_switch_enabled
  : true;
let _singleModelCodex = CONFIG_PROXY.single_model_codex || "";
let _singleModelHermes = CONFIG_PROXY.single_model_hermes || "";

// ── Client-specific indices ──
const clientState = {
  CODEX: {
    idx: typeof CONFIG_PROXY?._fallbackState?.codexIdx === 'number' ? CONFIG_PROXY._fallbackState.codexIdx : 0,
    lastSwitch: 0, lastModel: null, lastProvider: null
  },
  HERMES: {
    idx: typeof CONFIG_PROXY?._fallbackState?.hermesIdx === 'number' ? CONFIG_PROXY._fallbackState.hermesIdx : 1,
    lastSwitch: 0, lastModel: null, lastProvider: null
  },
};

let _lastSwitchTs = CONFIG_PROXY?._fallbackState?.lastSwitch || 0;
const SWITCH_COOLDOWN_MS = 2000;  // minimum ms between switches


/**
 * Initialize fallback chain from config.
 */

// Auto-rotate timer: switches provider when max_provider_use_minutes elapses
let _rotateTimer = null;
const ROTATE_CHECK_INTERVAL_MS = 30000;

function startRotateTimer() {
  if (_rotateTimer) clearInterval(_rotateTimer);
  _rotateTimer = setInterval(() => {
    syncFromConfig();
    if (!_fallbackEnabled || !_condSwitchEnabled) return;
    if (fallbackChain.length === 0) return;
    const now = Date.now();
    const maxUseMs = (CONFIG_PROXY.max_provider_use_minutes || 60) * 60000;
    const elapsed = now - _lastSwitchTs;
    if (_lastSwitchTs > 0 && elapsed >= maxUseMs) {
      log.info("[fallback] auto-rotate: " + Math.round(elapsed / 60000) + "min elapsed, switching both CODEX and HERMES");
      // helper: clear lock, reposition idx, advance by 1
      function _rotateClient(clientId, singleModelKey) {
        const locked = clientId === "HERMES" ? _singleModelHermes : _singleModelCodex;
        if (locked) {
          const pos = fallbackChain.findIndex(function(e) { return e.name === locked; });
          if (pos >= 0) clientState[clientId].idx = pos;
          CONFIG_PROXY[singleModelKey] = "";
          if (clientId === "HERMES") _singleModelHermes = "";
          else _singleModelCodex = "";
        }
        const st = clientState[clientId];
        st.idx = (st.idx + 1) % fallbackChain.length;
        const entry = fallbackChain[st.idx];
        if (entry) log.info("[fallback] " + clientId + " auto-rotated to \"" + entry.name + "\" (idx=" + st.idx + ")");
      }
      _rotateClient("CODEX", "single_model_codex");
      _rotateClient("HERMES", "single_model_hermes");
      _lastSwitchTs = now;
      persistConfig();
    }
  }, ROTATE_CHECK_INTERVAL_MS);
  _rotateTimer.unref();
}
export function initFallback() {
  const raw = CONFIG_PROXY.fallback_sequence || "";
  buildChain(raw);
  // ★ 从数据库/JSON 恢复单模型锁定、开关等运行时状态
  _singleModelCodex = CONFIG_PROXY.single_model_codex || "";
  _singleModelHermes = CONFIG_PROXY.single_model_hermes || "";
  _fallbackEnabled = CONFIG_PROXY.fallback_enabled !== undefined ? !!CONFIG_PROXY.fallback_enabled : true;
  _condSwitchEnabled = CONFIG_PROXY.cond_switch_enabled !== undefined ? !!CONFIG_PROXY.cond_switch_enabled : true;
  log.info(`[fallback] initialized with ${fallbackChain.length} providers, enabled=${_fallbackEnabled}, codexLock=${_singleModelCodex || '(none)'}, hermesLock=${_singleModelHermes || '(none)'}`);
  
  // ★ 每 10 秒持久化 fallback 状态到 JSON 文件
  //   确保重启后 chain 位置和倒计时不会丢失
  setInterval(() => {
    try { persistConfig(); } catch(e) { /* silent */ }
  }, 10000);
  startRotateTimer();
}

/**
 * Rebuild fallback chain from raw sequence string.
 */
function buildChain(raw) {
  fallbackChain.length = 0;
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
      fallbackChain.push({ name: resolvedName, model: modelId, raw: entry });
    }
  }
}

/**
 * Get current fallback chain.
 */
export function getChain() {
  return [...fallbackChain];
}

/**
 * Get current sequence as semicolon-separated string.
 */
export function getChainString() {
  return fallbackChain.map(e => e.raw || e.name).join(";");
}

/**
 * Replace the entire fallback chain.
 */
export function setChain(raw) {
  buildChain(raw);
  persistConfig();
  return true;
}

/**
 * Get fallback settings.
 */
export function getSettings() {
  return {
    enabled: _fallbackEnabled,
    condSwitch: _condSwitchEnabled,
    singleModelCodex: _singleModelCodex,
    singleModelHermes: _singleModelHermes,
    fallbackIntervalMinutes: CONFIG_PROXY.fallback_interval_minutes || 45,
  };
}

/**
 * Update fallback settings.
 */
export function updateSettings(settings) {
  if (!settings || typeof settings !== 'object') return;
  if (settings.fallback_enabled !== undefined) _fallbackEnabled = settings.fallback_enabled;
  if (settings.cond_switch_enabled !== undefined) _condSwitchEnabled = settings.cond_switch_enabled;
  if (settings.single_model_codex !== undefined) _singleModelCodex = settings.single_model_codex;
  if (settings.single_model_hermes !== undefined) _singleModelHermes = settings.single_model_hermes;
  Object.assign(CONFIG_PROXY, settings);
  // â éå¾ï¼è®¾ç½® single_model éå®æ¶ï¼åæ­¥ idx å°éåä½ç½®
  //   ç¡®ä¿è§£éåä»æ­£ç¡®ä½ç½®+1åè¿ï¼ä¸è·³è·
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
      var _hermesPos = fallbackChain.findIndex(function(e) { return e.name === _newHermesVal; });
      if (_hermesPos >= 0) clientState.HERMES.idx = _hermesPos;
    }
  }
  persistConfig();
}

/**
 * Check if two providers would share the same model (CODEX/HERMES conflict).
 * Returns true if allowing `provider` for `clientId` would cause a conflict.
 */
function isModelConflict(clientId, provider) {
  if (!provider) return false;
  const pSlug = provider.slug || provider.name;
  if (clientId === "CODEX") {
    // 只按 provider 名称判断冲突，不看 modelId
    // 不同 API 密钥/地址的 provider 即使 modelId 相同也不视为冲突
    const hermesSlug = _singleModelHermes;
    if (hermesSlug) {
      if (hermesSlug === pSlug) return true;
    } else {
      const he = fallbackChain[clientState["HERMES"].idx];
      if (he && he.name === pSlug) return true;
    }
  }
  if (clientId === "HERMES") {
    const codexSlug = _singleModelCodex;
    if (codexSlug) {
      if (codexSlug === pSlug) return true;
    } else {
      const ce = fallbackChain[clientState["CODEX"].idx];
      if (ce && ce.name === pSlug) return true;
    }
  }
  return false;
}

/**
 * Get the current provider for a client.
 * 铁律：CODEX(红) 和 HERMES(黄) 绝对不能使用同一个模型。
 */
export function getCurrentProvider(clientId = "CODEX") {
  // ★ 轻量级检查：只对比 updated_at 版本号，不访问数据库
  syncFromConfig();
  
  if (!_fallbackEnabled || fallbackChain.length === 0) return null;

  // Single model mode
  const singleModel = clientId === "HERMES" ? _singleModelHermes : _singleModelCodex;
  if (singleModel) {
    const provider = find(singleModel);
    if (provider) {
      // 铁律检查：如果当前锁定的模型与另一端冲突
      // ★ 不清理锁，而是跳过——设置时的冲突已在 POST /api/fallback 中处理
      // 运行时的冲突不应该清除锁定，否则会出现两边都跳的异常
      if (isModelConflict(clientId, provider)) {
        log.warn(`[fallback] ${clientId}: single_model ${singleModel} conflicts, falling back to chain`);
        // ★ 不返回 null，降级到 fallback 链自动跳过冲突模型
        //   避免重启后单模型锁冲突导致所有客户端 400 错误
      } else {
        return provider;
      }
    }
  }

  const state = clientState[clientId] || clientState.CODEX;

  // Only try current index, then 1 step forward (no scanning whole chain)
  for (let attempt = 0; attempt < 2; attempt++) {
    const idx = (state.idx + attempt) % fallbackChain.length;
    const entry = fallbackChain[idx];
    if (!entry) continue;
    const provider = find(entry.name);
    if (!provider) continue;

    // Skip abnormal
    const abnormalList = CONFIG_PROXY.abnormal_models || [];
    if (abnormalList.length) {
      const pKey = provider.slug || provider.name;
      if (abnormalList.indexOf(pKey) >= 0 || abnormalList.indexOf(provider.name) >= 0) {
        log.info("[fallback] skipping abnormal: " + provider.name);
        continue;
      }
    }

    // 铁律：CODEX 和 HERMES 不能共用同一模型
    if (isModelConflict(clientId, provider)) {
      log.info("[fallback] skipping model conflict: " + provider.name);
      continue;
    }

    // If we reached here on attempt > 0, update idx
    if (attempt > 0) {
      state.idx = idx;
      persistConfig(); // ★ 位置修正后立即保存，防止崩溃丢失
    }

    return provider;
  }

  // Both positions invalid — scan entire chain as last resort
  // ★ Fix: don't just return the (potentially broken) current provider,
  //    scan the full chain for ANY valid provider
  for (let i = 0; i < fallbackChain.length; i++) {
    const entry = fallbackChain[i];
    if (!entry) continue;
    const provider = find(entry.name);
    if (!provider) continue;
    const abnormalList = CONFIG_PROXY.abnormal_models || [];
    const pKey = provider.slug || provider.name;
    if (abnormalList.indexOf(pKey) >= 0 || abnormalList.indexOf(provider.name) >= 0) continue;
    if (isModelConflict(clientId, provider)) continue;
    state.idx = i;
    log.info(`[fallback] ${clientId}: full chain scan found valid provider "${entry.name}" at idx=${i}`);
    return provider;
  }
  // Truly nothing available
  log.warn(`[fallback] ${clientId}: no valid provider in entire chain (abnormal=${(CONFIG_PROXY.abnormal_models||[]).length})`);
  return null;
}

/**
 * Attempt to advance fallback to the next provider.
 * 只能前进1个位置，不允许跳跃多个模型。
 * 如果下一个位置无效（abnormal 或模型冲突），再试1位（最多2次尝试）。
 * Returns the new provider (or null if none available).
 */
export function advanceFallback(clientId = "CODEX", force = false) {
  syncFromConfig();
  
  if (!_fallbackEnabled || (!_condSwitchEnabled && !force)) return null;
  if (fallbackChain.length === 0) return null;

  const now = Date.now();
  if (now - _lastSwitchTs < SWITCH_COOLDOWN_MS && !force) return null;

  const state = clientState[clientId] || clientState.CODEX;
  const startIdx = state.idx;

  // 只前进1位，最多再试1位
  for (let attempt = 0; attempt < 2; attempt++) {
    state.idx = (state.idx + 1) % fallbackChain.length;
    const entry = fallbackChain[state.idx];
    if (!entry) continue;

    const provider = find(entry.name);
    if (!provider) continue;

    // Skip abnormal providers
    const abnormalList = CONFIG_PROXY.abnormal_models || [];
    if (abnormalList.length) {
      const pKey = provider.slug || provider.name;
      if (abnormalList.indexOf(pKey) >= 0 || abnormalList.indexOf(provider.name) >= 0) {
        log.info("[fallback] skipping abnormal provider: " + provider.name);
        continue;
      }
    }

    // 铁律：CODEX 和 HERMES 不能共用同一模型
    if (isModelConflict(clientId, provider)) {
      log.info("[fallback] skipping model conflict: " + provider.name);
      continue;
    }

    _lastSwitchTs = now;
    state.lastSwitch = now;
    log.info(`[fallback] ${clientId} switched to "${entry.name}" (idx=${state.idx})`);
    persistConfig();
    return provider;
  }

  // 两位都无效 → 全链扫描兜底
  // ★ Fix: don't just return to startIdx (infinite loop risk),
  //    scan the full chain for ANY valid provider
  for (let i = 0; i < fallbackChain.length; i++) {
    const entry = fallbackChain[i];
    if (!entry) continue;
    const provider = find(entry.name);
    if (!provider) continue;
    const abnormalList = CONFIG_PROXY.abnormal_models || [];
    const pKey = provider.slug || provider.name;
    if (abnormalList.indexOf(pKey) >= 0 || abnormalList.indexOf(provider.name) >= 0) continue;
    if (isModelConflict(clientId, provider)) continue;
    state.idx = i;
    _lastSwitchTs = now;
    state.lastSwitch = now;
    log.info(`[fallback] ${clientId}: full scan found "${entry.name}" at idx=${i}`);
    persistConfig();
    return provider;
  }
  // 全链无可用 provider → 回原位但不卡死，清掉 abnormal 重试
  state.idx = startIdx;
  log.warn(`[fallback] ${clientId}: no valid provider anywhere, clearing abnormal list for retry`);
  CONFIG_PROXY.abnormal_models = [];
  persistConfig();
  return null;
}



/**
 * Clear single_model lock and advance the fallback chain to the next provider.
 * Positions the chain index at the previously locked model so advance goes to the next one.
 */
/**
 * Clear single_model lock and advance the fallback chain to the next provider.
 * Positions the chain index at the previously locked model so advance goes to the next one.
 * If cond_switch is disabled (auto-switch off), does nothing.
 */

export function clearSingleAndAdvance(clientId, force = false) {
  // 自动切换关闭且非强制时不执行任何操作
  if (!_condSwitchEnabled && !force) return null;

  const singleModel = clientId === "HERMES" ? _singleModelHermes : _singleModelCodex;

  // Clear the single_model lock
  if (clientId === "CODEX" || clientId === "ALL") {
    _singleModelCodex = "";
    CONFIG_PROXY.single_model_codex = "";
  }
  if (clientId === "HERMES" || clientId === "ALL") {
    _singleModelHermes = "";
    CONFIG_PROXY.single_model_hermes = "";
  }

  // Position chain index at the previously locked model
  if (singleModel) {
    const state = clientState[clientId] || clientState.CODEX;
    const pos = fallbackChain.findIndex(function(e) { return e.name === singleModel; });
    if (pos >= 0) {
      state.idx = pos;
    }
  }

  // Advance the chain (returns the new provider)
  const provider = advanceFallback(clientId, force);
  persistConfig();
  return provider;
}

/**
 * Get the full status object for the config API.
 */
export function getFullStatus() {
  const codexProvider = getCurrentProvider("CODEX");
  const hermesProvider = getCurrentProvider("HERMES");

  const stateCODEX = clientState.CODEX;
  const stateHERMES = clientState.HERMES;

  return {
    fallback_enabled: _fallbackEnabled,
    cond_switch_enabled: _condSwitchEnabled,
    fallback_interval_minutes: CONFIG_PROXY.fallback_interval_minutes || 45,
    fallback_chain: fallbackChain.map(e => ({ name: e.name, model: e.model })),
    fallback_sequence: getChainString(),
    fallback_state: {
      lastSwitch: _lastSwitchTs,
      codexIdx: stateCODEX.idx,
      hermesIdx: stateHERMES.idx,
    },

    codex_cur_slug: codexProvider ? codexProvider.slug : null,
    codex_actual_model: codexProvider ? codexProvider.modelId : null,
    codex_idx: stateCODEX.idx,

    hermes_cur_slug: hermesProvider ? hermesProvider.slug : null,
    hermes_actual_model: hermesProvider ? hermesProvider.modelId : null,
    hermes_idx: stateHERMES.idx,

    provider_health: {},
    uptime: process.uptime(),
  };
}

/**
 * Persist config to disk.
 */
function persistConfig() {
  saveJSON(PATHS.configProxy, {
    ...CONFIG_PROXY,
    _fallbackState: {
      codexIdx: clientState.CODEX.idx,
      hermesIdx: clientState.HERMES.idx,
      lastSwitch: _lastSwitchTs,
    },
  });
}
