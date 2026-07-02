/**
 * Config API Server
 *
 * Provides the configuration management API on a separate HTTP server.
 * Port: 40006 (production)
 *
 * Architecture (Middleman Pattern):
 *   Admin UI → API → admin.db (SQLite)
 *                       ↓ middleman.syncAll()
 *                 models.json + config-proxy.json
 *                       ↓ proxy reads
 *                 Forwarding Proxy (unchanged)
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { log } from "./logger.mjs";
import { PORTS, PATHS, CONFIG_PROXY, saveJSON, loadJSON } from "./config.mjs";
import { getChain, setChain, getSettings, updateSettings, getFullStatus, advanceFallback, clearSingleAndAdvance, clearQuotaState, getChainString, getAllChainStrings, resetRotationTimer, getCurrentProvider } from "./fallback.mjs";
import { find } from "./provider-registry.mjs";
import { getAll } from "./provider-registry.mjs";
import { unregister } from "./provider-registry.mjs";
import { register } from "./provider-registry.mjs";
import { getMetrics } from "./concurrency.mjs";
import { resetVisionCache } from "./protocol/openai-responses.mjs";
import { createCustomProvider } from "./provider-custom.mjs";
import { initDB, saveConfig, saveJSONBackup, loadProviderTokens } from "./config-store.mjs";
import { isAbnormal, addAbnormal, removeAbnormal, getAbnormalList, getAbnormalReasons, syncFromRaw } from "./abnormal-state.mjs";

// ── Middleman imports ──
import { initMiddleman, syncAll as middlemanSync } from "./middleman.mjs";
import {
  initAdminDB, dbGetModels, dbGetAllModels, dbGetModel,
  dbAddModel, dbUpdateModel, dbDeleteModel, dbReorderModels,
  dbGetConfig, dbGetConfigKey, dbSetConfigKey, dbSetConfigBulk,
} from "./admin-db.mjs";

/**
 * Start the Config API server.
 */
export function startConfigServer() {
  // Initialize middleman (admin DB + initial sync)
  try {
    initAdminDB();
    initMiddleman();
    // Do an initial sync to make sure JSON files match DB
    middlemanSync(true);
    log.info("[config-api] middleman initialized, initial sync done");
  } catch (e) {
    log.warn("[config-api] middleman init failed, falling back to JSON-only mode: " + e.message);
  }

  const port = PORTS.config;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pn = url.pathname;

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // ── Redirect to Admin Panel ──
    if (pn === "/" || pn === "/config-ui") {
      const adminPort = process.env.ADMIN_PORT || 40007;
      res.writeHead(302, { Location: `http://127.0.0.1:${adminPort}/login.html` });
      res.end();
      return;
    }

    // ── API Routes ──

    // Status
    if (req.method === "GET" && pn === "/api/status") {
      const status = getFullStatus();
      sendJson(res, 200, status);
      return;
    }

    // All models
    if (req.method === "GET" && pn === "/api/all") {
      const providers = getAll();
      sendJson(res, 200, {
        custom: providers.filter(p => !p.isBuiltin).map(p => ({
          name: p.name, slug: p.slug, base: p.base,
          key: p.key ? p.key.slice(0, 8) + "..." : "",
          id: p.modelId, models: p.models,
        })),
        builtin: providers.filter(p => p.isBuiltin).map(p => ({
          name: p.name, models: p.models, disabled: p.disabled,
          base: p.base || "", key: p.key ? p.key.slice(0, 8) + "..." : "",
        })),
      });
      return;
    }

    // Models list — reads from DB (source of truth)
    if (req.method === "GET" && pn === "/api/models") {
      try {
        const dbModels = dbGetAllModels();
        sendJson(res, 200, dbModels.map(m => {
          var extra = {};
          try { extra = JSON.parse(m.extra || "{}"); } catch(e) {}
          return {
            name: m.name, slug: m.slug, base: m.base,
            key: m.key, id: m.model_id, models: [m.model_id],
            idx: m.idx, isBuiltin: false,
            expires_at: extra.expires_at || '',
          };
        }));
      } catch (e) {
        // Fallback to provider registry
        const providers = getAll();
        sendJson(res, 200, providers.map(p => ({
          name: p.name, slug: p.slug, base: p.base,
          models: p.models, isBuiltin: p.isBuiltin,
        })));
      }
      return;
    }

    // Fallback config
    // Fallback config - GET (return current config from DB + resolved current models)
    if (pn === "/api/fallback" && req.method === "GET") {
      try {
        const config = dbGetConfig();
        // Merge in the RESOLVED current model info from fallback.mjs
        // This ensures frontend always sees what the backend is ACTUALLY using,
        // not just the raw single_model_codex/hermes from DB (which may be empty
        // when the backend falls through to the fallback chain)
        const status = getFullStatus();
        config.codex_cur_slug = status.codex_cur_slug || null;
        config.codex_actual_model = status.codex_actual_model || null;
        config.hermes_cur_slug = status.hermes_cur_slug || null;
        config.hermes_actual_model = status.hermes_actual_model || null;
        config.fallback_chain = status.fallback_chain || [];
        config.hermes_chain = status.hermes_chain || [];
        config.fallback_sequence = status.fallback_sequence || "";
        config.hermes_sequence = status.hermes_sequence || "";
        // add runtime state so frontend can calculate countdown from lastSwitch
        config.fallback_state = status.fallback_state || {};
        config.fallback_interval_minutes = status.fallback_interval_minutes;
        config.cond_switch_enabled = status.cond_switch_enabled;
        // ensure single_model values match runtime
        if (!config.single_model_codex && status.codex_cur_slug) config.single_model_codex = status.codex_cur_slug;
        if (!config.single_model_hermes && status.hermes_cur_slug) config.single_model_hermes = status.hermes_cur_slug;
        sendJson(res, 200, config);
      } catch (e) {
        sendJson(res, 500, { error: e.message });
      }
      return;
    }

    // Fallback config - POST (update config)
    if (pn === "/api/fallback" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("error", () => {});
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          // ★ DB级约束：CODEX 和 HERMES 不能指向同一个模型
          if (data.single_model_codex && data.single_model_hermes &&
              data.single_model_codex === data.single_model_hermes) {
            sendJson(res, 400, { error: "CODEX 和 HERMES 不能指向同一个模型" });
            return;
          }
          // ★ 冲突处理：CODEX 设置时若与 HERMES 冲突，CODEX 自动往后跳
          if (data.single_model_codex && data.single_model_codex === (CONFIG_PROXY.single_model_hermes || "")) {
            // CODEX 跳到 HERMES 后面2位
            const hermesSlug = CONFIG_PROXY.single_model_hermes || "";
            const seq = getChainString().split(";").filter(Boolean);
            const hermesIdx = seq.indexOf(hermesSlug);
            const newIdx = (hermesIdx + 2) % seq.length;
            const newCodexSlug = seq[newIdx];
            if (newCodexSlug && newCodexSlug !== hermesSlug) {
              data.single_model_codex = newCodexSlug;
              log.info(`[config] CODEX conflicts with HERMES, auto-advancing to "${newCodexSlug}"`);
            } else {
              sendJson(res, 400, { error: "无法找到可用的 CODEX 模型位置" });
              return;
            }
          }
          if (data.single_model_hermes && data.single_model_hermes === (CONFIG_PROXY.single_model_codex || "")) {
            // HERMES 设置时若与 CODEX 冲突，HERMES 自动往后跳
            const codexSlug = CONFIG_PROXY.single_model_codex || "";
            const seq = getChainString().split(";").filter(Boolean);
            const codexIdx = seq.indexOf(codexSlug);
            const newIdx = (codexIdx + 2) % seq.length;
            const newHermesSlug = seq[newIdx];
            if (newHermesSlug && newHermesSlug !== codexSlug) {
              data.single_model_hermes = newHermesSlug;
              log.info(`[config] HERMES conflicts with CODEX, auto-advancing to "${newHermesSlug}"`);
            } else {
              sendJson(res, 400, { error: "无法找到可用的 HERMES 模型位置" });
              return;
            }
          }
          // 1. Update DB (source of truth)
          dbSetConfigBulk(data);
          // 2. Update in-memory state
          if (data.fallback_sequence !== undefined) {
            setChain(data.fallback_sequence, "CODEX");
          }
          if (data.hermes_fallback_sequence !== undefined) {
            setChain(data.hermes_fallback_sequence, "HERMES");
          }
          updateSettings(data);
          // ★ 手动切换模型后重置倒计时，让倒计时从当前时间重新开始
          if (data.single_model_codex !== undefined || data.single_model_hermes !== undefined) {
            resetRotationTimer();
            CONFIG_PROXY._countdown_start = Date.now();
            log.info("[config] manual model change, countdown reset to " + CONFIG_PROXY._countdown_start);
            CONFIG_PROXY._countdown_interval = CONFIG_PROXY.fallback_interval_minutes || 96;
            // ★ 倒计时改为仅存内存，不再写回 DB，避免 middlemanSync 用旧 DB 值覆盖
            log.info("[config] manual model change, countdown reset");
          }
          // 3. Sync DB → JSON via middleman
          try { middlemanSync(); } catch (e) { /* middleman may fail */ }
          sendJson(res, 200, { status: "ok", sequence: getChainString("CODEX"), hermes_sequence: getChainString("HERMES") });
        } catch (e) {
          sendJson(res, 400, { error: e.message });
        }
      });
      return;
    }

    // Set interval
    if (req.method === "POST" && pn === "/api/fallback/set-interval") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          if (data.minutes) {
            // 1. Update DB
            dbSetConfigKey("fallback_interval_minutes", data.minutes);
            // 2. Update in-memory
            CONFIG_PROXY.fallback_interval_minutes = data.minutes;
            updateSettings({ fallback_interval_minutes: data.minutes });
            // 3. Sync
            try { middlemanSync(); } catch (e) { /* silent */ }
            sendJson(res, 200, { status: "ok" });
          } else {
            sendJson(res, 400, { error: "minutes required" });
          }
        } catch (e) {
          sendJson(res, 400, { error: e.message });
        }
      });
      return;
    }

    // ── Abnormal model management ──
    if (pn === "/api/fallback/abnormal") {
      if (req.method === "GET") {
        syncFromRaw(CONFIG_PROXY.abnormal_models || [], CONFIG_PROXY._abnormal_reasons || {});
        sendJson(res, 200, { list: getAbnormalList(), reasons: getAbnormalReasons() });
        return;
      }
      if (req.method === "POST") {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("error", () => {});
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            const key = data.key || "";
            const abnormal = data.abnormal === true;
            let newList;
            
            // ★ 获取当前两条链的 sequence
            var codexSeq = (CONFIG_PROXY.codex_fallback_sequence || "").split(";").filter(Boolean);
            var hermesSeq = (CONFIG_PROXY.hermes_fallback_sequence || "").split(";").filter(Boolean);
            
            if (abnormal) {
              if (isAbnormal(key)) {
                newList = getAbnormalList();
              } else {
                addAbnormal(key, data.reason || '手动标记');
                newList = getAbnormalList();
              }
              // ★ 从两条链中都移除（同时匹配 slug 和 name，因为链可能存的是名称）
              codexSeq = codexSeq.filter(function(s) { return s !== key; });
              hermesSeq = hermesSeq.filter(function(s) { return s !== key; });
              // ★ 如果 key 是 slug，还要检查是否有模型名=key 的（反之亦然）
              //   比如 chain 存的是 "智谱2"，但 abnormal key 是 "zhipu2"
              try {
                var modelByName = dbGetModel(key);
                if (modelByName && modelByName.name && modelByName.name !== key) {
                  codexSeq = codexSeq.filter(function(s) { return s !== modelByName.name; });
                  hermesSeq = hermesSeq.filter(function(s) { return s !== modelByName.name; });
                }
              } catch(e) { /* ignore */ }
              log.warn("[config-api] abnormal + remove from chains: " + key);
              
              // 更新 DB + CONFIG_PROXY
              var newCodexSeq = codexSeq.join(";");
              var newHermesSeq = hermesSeq.join(";");
              CONFIG_PROXY.codex_fallback_sequence = newCodexSeq;
              CONFIG_PROXY.fallback_sequence = newCodexSeq;
              CONFIG_PROXY.hermes_fallback_sequence = newHermesSeq;
              dbSetConfigKey("codex_fallback_sequence", newCodexSeq);
              dbSetConfigKey("fallback_sequence", newCodexSeq);
              dbSetConfigKey("hermes_fallback_sequence", newHermesSeq);
              if (typeof setChain === "function") setChain(newCodexSeq, "CODEX");
              if (typeof setChain === "function") setChain(newHermesSeq, "HERMES");
              
              // ★ 如果异常模型是当前CODEX/HERMES锁定模型，自动清除锁定并前进
              if (CONFIG_PROXY.single_model_codex === key) {
                log.warn("[config-api] abnormal model is codex current, clear and advance");
                CONFIG_PROXY.single_model_codex = "";
                dbSetConfigKey("single_model_codex", "");
              }
              if (CONFIG_PROXY.single_model_hermes === key) {
                log.warn("[config-api] abnormal model is hermes current, clear and advance");
                CONFIG_PROXY.single_model_hermes = "";
                dbSetConfigKey("single_model_hermes", "");
              }
            } else {
              // ★ 恢复异常：兼容大小写移除
              var removed = removeAbnormal(key);
              if (!removed) {
                // 如果 abnormal-state 没找到，退回到旧逻辑按小写删一次
                var restoreKey = (key || "").toLowerCase();
                newList = (CONFIG_PROXY.abnormal_models || []).filter(function(m) { return m.toLowerCase() !== restoreKey; });
              } else {
                newList = getAbnormalList();
              }
              // ★ 恢复异常：清理原因记录（从 abnormal-state 缓存读取）
              var rawReasons2 = getAbnormalReasons();
              var reasons2 = typeof rawReasons2 === 'string' ? JSON.parse(rawReasons2) : (rawReasons2 || {});
              delete reasons2[(key || "").toLowerCase()];
              delete reasons2[key];
              CONFIG_PROXY._abnormal_reasons = reasons2;
              dbSetConfigKey("_abnormal_reasons", reasons2);
              // ★ 恢复异常：自动加回队列末尾
              // ★ 恢复异常：同时重置内存中的额度检测状态，防止恢复后因残留计数被立即重新标记异常
              try { clearQuotaState((key || "").toLowerCase()); } catch(e) { log.warn("[config-api] clearQuotaState error: " + e.message); }
              try { clearQuotaState(key); } catch(e) { log.warn("[config-api] clearQuotaState error: " + e.message); }
              //    用 key 查找模型真实名称（链里存储的是 name 或 slug）
              var _restoreName = key;
              try {
                var _restoreDb = dbGetModel(key);
                if (_restoreDb && _restoreDb.name) _restoreName = _restoreDb.name;
              } catch(e) {}
              var _cxSeq = (CONFIG_PROXY.codex_fallback_sequence || "").split(";").filter(Boolean);
              var _hmSeq = (CONFIG_PROXY.hermes_fallback_sequence || "").split(";").filter(Boolean);
              if (!_cxSeq.includes(_restoreName) && !_cxSeq.includes(key)) {
                _cxSeq.push(_restoreName);
                CONFIG_PROXY.codex_fallback_sequence = _cxSeq.join(";");
                CONFIG_PROXY.fallback_sequence = _cxSeq.join(";");
                dbSetConfigKey("codex_fallback_sequence", _cxSeq.join(";"));
                dbSetConfigKey("fallback_sequence", _cxSeq.join(";"));
                if (typeof setChain === "function") setChain(_cxSeq.join(";"), "CODEX");
              }
              if (!_hmSeq.includes(_restoreName) && !_hmSeq.includes(key)) {
                _hmSeq.push(_restoreName);
                CONFIG_PROXY.hermes_fallback_sequence = _hmSeq.join(";");
                dbSetConfigKey("hermes_fallback_sequence", _hmSeq.join(";"));
                if (typeof setChain === "function") setChain(_hmSeq.join(";"), "HERMES");
              }
              log.info("[config-api] restore from abnormal: " + key + " added back to chains");
            }
            
            // ★ 更新 abnormal_models 到 DB 和 CONFIG_PROXY
            CONFIG_PROXY.abnormal_models = newList;
            
            // 1. 写 DB
            dbSetConfigKey("abnormal_models", newList);
            
            // 2. 更新内存
            updateSettings({ abnormal_models: newList });
            
            // 3. Sync
            try { middlemanSync(); } catch (e) { /* silent */ }
            sendJson(res, 200, { status: abnormal ? "marked_abnormal" : "cleared", list: newList });
          } catch (e) {
            sendJson(res, 400, { error: e.message });
          }
        });
        return;
      }
    }

    // ── /api/fallback/timed-switch ──
    if (req.method === "POST" && pn === "/api/fallback/timed-switch") {
      // ★ 前端倒计时归零即触发切换（前端控制自动开关，此处不检查锁定）
      // 自动切换 ON → 倒计时走 → 归零→ 此处必定切换
      // 自动切换 OFF → 前端倒计时冻结 → 永远不会走到这里
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          const clientId = data.client || "CODEX";
          const forceFlag = data.force === true;
          
          const newProvider = clearSingleAndAdvance(clientId, forceFlag);
          // ★ 关键：同步更新DB中的 single_model_codex/hermes
          // clearSingleAndAdvance 会清空内存中的 _singleModelCodex/Hermes，
          // 但DB里的值还是旧的。必须先更新DB，再middlemanSync才不会覆盖回去
          dbSetConfigKey("single_model_codex", CONFIG_PROXY.single_model_codex || "");
          dbSetConfigKey("single_model_hermes", CONFIG_PROXY.single_model_hermes || "");
          dbSetConfigKey("_fallbackState", CONFIG_PROXY._fallbackState || {});
          // Sync DB → JSON via middleman
          try { middlemanSync(); } catch (e) { /* silent */ }
          sendJson(res, 200, {
            status: "ok",
            provider: newProvider ? newProvider.name : null,
            slug: newProvider ? newProvider.slug : null,
          });
        } catch (e) {
          sendJson(res, 400, { error: e.message });
        }
      });
      return;
    }

    // Dynamic metrics
    if (req.method === "GET" && pn === "/api/dynmetrics") {
      sendJson(res, 200, getMetrics());
      return;
    }

    // ── Provider token rankings ──
    if (req.method === "GET" && pn === "/api/token-rankings") {
      try {
        const tokens = loadProviderTokens();
        // ★ 过滤掉纯数字的 provider_name（如阿里云1/2/3 的 slug="1"/"2"/"3" 被错误记录了）
        const filtered = {};
        for (const k of Object.keys(tokens)) {
          if (/^\d+$/.test(k)) {
            log.warn(`[config-api] skipping numeric provider_name="${k}" (${tokens[k]} tokens)`);
            continue;
          }
          filtered[k] = tokens[k];
        }
        // Convert to sorted array for frontend
        const rankings = Object.keys(filtered).map(function(k) {
          return { provider_name: k, total_tokens: filtered[k] };
        }).sort(function(a, b) { return b.total_tokens - a.total_tokens; });
        sendJson(res, 200, { rankings: rankings, total: rankings.reduce(function(s, r) { return s + r.total_tokens; }, 0) });
      } catch (e) {
        sendJson(res, 500, { error: e.message });
      }
      return;
    }

    // ── Token sync (merge remote tokens into local DB) ──
    if (req.method === "POST" && pn === "/api/tokens/sync") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", async () => {
        try {
          const data = JSON.parse(body);
          const remoteTokens = data.tokens || {}; // { "provider_name": total_tokens }
          // ★ 过滤掉纯数字的 provider_name，同步时拒绝写入
          const cleanedRemote = {};
          for (const k of Object.keys(remoteTokens)) {
            if (/^\d+$/.test(k)) {
              log.warn(`[config-api] sync skipping numeric provider_name="${k}"`);
              continue;
            }
            cleanedRemote[k] = remoteTokens[k];
          }
          const localTokens = loadProviderTokens();
          // ★ 本地也过滤纯数字的 provider_name
          const cleanedLocal = {};
          for (const k of Object.keys(localTokens)) {
            if (/^\d+$/.test(k)) continue;
            cleanedLocal[k] = localTokens[k];
          }
          const { saveProviderToken } = await import("./config-store.mjs");
          const now = Date.now();
          let merged = 0;
          // 合并所有 provider（本地 + 远程），取最大值
          const allProviders = new Set([...Object.keys(cleanedLocal), ...Object.keys(cleanedRemote)]);
          for (const name of allProviders) {
            const localVal = cleanedLocal[name] || 0;
            const remoteVal = cleanedRemote[name] || 0;
            const maxVal = Math.max(localVal, remoteVal);
            if (maxVal > 0) {
              saveProviderToken(name, maxVal);
              merged++;
            }
          }
          // 同时更新 tokens.json（前端 dashboard 读取）
          try {
            const tokPath = path.join(PATHS.data, "tokens.json");
            if (fs.existsSync(tokPath)) {
              const existing = JSON.parse(fs.readFileSync(tokPath, "utf8"));
              const byProvider = existing.byProvider || [];
              const bpMap = {};
              byProvider.forEach(function(p) { bpMap[p.name] = p.tokens; });
              for (const name of allProviders) {
                const maxVal = Math.max(cleanedLocal[name] || 0, cleanedRemote[name] || 0);
                if (maxVal > 0) bpMap[name] = maxVal;
              }
              existing.byProvider = Object.keys(bpMap).map(function(n) { return { name: n, tokens: bpMap[n] }; });
              existing.total = Object.values(bpMap).reduce(function(s, v) { return s + v; }, 0);
              fs.writeFileSync(tokPath, JSON.stringify(existing));
            }
          } catch(e) { /* sync tokens.json silently */ }
          
          log.info("[config-api] tokens synced: " + merged + " providers merged");
          // ★ 同步更新内存 _providerTokenMap（通过 global 共享）
          try {
            const allTokens = loadProviderTokens();
            if (global.__providerTokenMap) {
              for (const k of Object.keys(allTokens)) {
                global.__providerTokenMap[k] = Math.max(global.__providerTokenMap[k] || 0, allTokens[k]);
              }
            } else {
              global.__providerTokenMap = allTokens;
            }
            log.info("[config-api] _providerTokenMap synced (" + Object.keys(global.__providerTokenMap).length + " providers)");
          } catch(e) { log.warn("[config-api] sync _providerTokenMap failed: " + e.message); }
          
          sendJson(res, 200, { status: "ok", merged: merged });
        } catch (e) {
          sendJson(res, 400, { error: e.message });
        }
      });
      return;
    }

    // ── Helper: re-register custom providers from models.json ──
    function reloadCustomProviders() {
      try {
        getAll().filter(function(p) { return !p.isBuiltin; }).forEach(function(p) {
          unregister(p.name);
        });
        var freshModels = loadJSON(PATHS.models, []);
        freshModels.forEach(function(entry) {
          if (!entry.base || !entry.key) return;
          try {
            register(createCustomProvider(entry));
          } catch(e) { /* skip bad entry */ }
        });
        http.get(`http://127.0.0.1:${PORTS.proxy}/api/reload`, function(r) { r.resume(); }).on("error", function() {});
      } catch(e) { /* silent */ }
    }

    // ── Reload providers (called by middleman after sync) ──
    if (req.method === "GET" && pn === "/api/reload-providers") {
      reloadCustomProviders();
      sendJson(res, 200, { status: "ok" });
      return;
    }

    // ── Custom providers CRUD (via admin DB + middleman) ──
    if (pn === "/api/models" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("error", () => {});
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          // ★ 输入验证：禁止逗号、分号、管道符等特殊字符
          const valErr = validateModelInput(data);
          if (valErr) { sendJson(res, 400, { error: valErr }); return; }
          // 1. Write to DB
          const result = dbAddModel({
            name: data.name,
            slug: data.slug || data.name,
            base: data.base,
            key: data.key,
            id: data.id,
            expires_at: data.expires_at || '',
          });
          if (result.error) {
            sendJson(res, 400, { error: result.error });
            return;
          }
          // 2. Sync DB → JSON + reload
          middlemanSync();
          // 3. Also re-register providers in current process
          reloadCustomProviders();
          sendJson(res, 200, { ok: true, slug: result.slug });
        } catch (e) {
          sendJson(res, 400, { error: e.message });
        }
      });
      return;
    }

    // GET /api/models/by-slug/:slug — get single model by slug (MUST be before PUT)
    if (pn.startsWith("/api/models/by-slug/") && req.method === "GET") {
      const slug = decodeURIComponent(pn.slice("/api/models/by-slug/".length));
      try {
        const m = dbGetModel(slug);
        if (!m) { sendJson(res, 404, { error: "not found" }); return; }
        // ★ 解析 extra 中的 expires_at
        var extra = {};
        try { extra = JSON.parse(m.extra || "{}"); } catch(e) {}
        sendJson(res, 200, { ...m, expires_at: extra.expires_at || '' });
      } catch (e) {
        sendJson(res, 500, { error: e.message });
      }
      return;
    }

    // PUT /api/models/by-slug/:slug — update by slug (preferred)
    if (pn.startsWith("/api/models/by-slug/") && req.method === "PUT") {
      const slug = decodeURIComponent(pn.slice("/api/models/by-slug/".length));
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("error", () => {});
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          // ★ 输入验证
          const valErr = validateModelInput(data);
          if (valErr) { sendJson(res, 400, { error: valErr }); return; }
          // ★ 获取旧模型数据（slug 变前），用于链匹配
          var oldModel = dbGetModel(slug);
          // 1. Write to DB
          dbUpdateModel(slug, data);
          var newSlug = (data.slug || "").trim();
          // 2. 如果 slug 变了，更新所有引用：两条链 + 异常列表 + single_model 锁定
          if (newSlug && newSlug !== slug) {
            // 同时按 slug 和 name 匹配（链存的是名称如 AgnesAI，不是 slug agnesai）
            var oldName = oldModel ? oldModel.name : slug;
            function _findAndReplace(arr, from, to) {
              // ★ 大小写不敏感匹配（链存的是名称如 AgnesAI，slug 是小写 agnesai）
              var idx = -1;
              for (var i = 0; i < arr.length; i++) {
                if (arr[i].toLowerCase() === from.toLowerCase()) {
                  idx = i;
                  break;
                }
              }
              if (idx >= 0) { arr[idx] = to; return true; }
              return false;
            }
            // 更新 codex chain（_findAndReplace 已直接替换数组元素）
            var codexSeq = (CONFIG_PROXY.codex_fallback_sequence || "").split(";").filter(Boolean);
            if (_findAndReplace(codexSeq, slug, newSlug) || _findAndReplace(codexSeq, oldName, newSlug)) {
              var newCodexSeq = codexSeq.join(";");
              CONFIG_PROXY.codex_fallback_sequence = newCodexSeq;
              CONFIG_PROXY.fallback_sequence = newCodexSeq;
              dbSetConfigKey("codex_fallback_sequence", newCodexSeq);
              dbSetConfigKey("fallback_sequence", newCodexSeq);
              if (typeof setChain === "function") setChain(newCodexSeq, "CODEX");
            }
            // 更新 hermes chain（同样按 slug 和 name 匹配）
            var hermesSeq = (CONFIG_PROXY.hermes_fallback_sequence || "").split(";").filter(Boolean);
            if (_findAndReplace(hermesSeq, slug, newSlug) || _findAndReplace(hermesSeq, oldName, newSlug)) {
              var newHermesSeq = hermesSeq.join(";");
              CONFIG_PROXY.hermes_fallback_sequence = newHermesSeq;
              dbSetConfigKey("hermes_fallback_sequence", newHermesSeq);
              if (typeof setChain === "function") setChain(newHermesSeq, "HERMES");
            }
            // 更新异常列表（匹配 slug 或 name）
            var abnList = (CONFIG_PROXY.abnormal_models || []).slice();
            if (_findAndReplace(abnList, slug, newSlug) || _findAndReplace(abnList, oldName, newSlug)) {
              CONFIG_PROXY.abnormal_models = abnList;
              dbSetConfigKey("abnormal_models", abnList);
              updateSettings({ abnormal_models: abnList });
            }
            // ★ slug 变更后同步 abnormal-state 缓存
            syncFromRaw(CONFIG_PROXY.abnormal_models || [], CONFIG_PROXY._abnormal_reasons || {});
            // 更新 single_model 锁定
            if (CONFIG_PROXY.single_model_codex === slug) {
              CONFIG_PROXY.single_model_codex = newSlug;
              dbSetConfigKey("single_model_codex", newSlug);
            }
            if (CONFIG_PROXY.single_model_hermes === slug) {
              CONFIG_PROXY.single_model_hermes = newSlug;
              dbSetConfigKey("single_model_hermes", newSlug);
            }
            log.info("[config-api] slug changed: " + slug + " -> " + newSlug + " (all refs updated)");
          }
          // 3. 不需要显式 middlemanSync — setChain 已通过 persistConfig 写入文件
          //    且 dbSetConfigKey 已写入 admin.db，middlemanSync 会异步同步
          reloadCustomProviders();
          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendJson(res, 400, { error: e.message });
        }
      });
      return;
    }

    // DELETE /api/models/by-slug/:slug — delete by slug (preferred)
    if (pn.startsWith("/api/models/by-slug/") && req.method === "DELETE") {
      const slug = decodeURIComponent(pn.slice("/api/models/by-slug/".length));
      try {
        // 获取旧模型数据（name、slug）
        var oldModel = dbGetModel(slug);
        var oldName = oldModel ? oldModel.name : slug;
        // 1. Delete from DB
        dbDeleteModel(slug);
        // 2. 从两条链中移除（同时按 slug 和 name 匹配）
        ["codex_fallback_sequence","hermes_fallback_sequence"].forEach(function(key) {
          var seq = (CONFIG_PROXY[key] || "").split(";").filter(Boolean);
          seq = seq.filter(function(s){ return s !== slug && s !== oldName; });
          var newSeq = seq.join(";");
          CONFIG_PROXY[key] = newSeq;
          dbSetConfigKey(key, newSeq);
          if (key === "codex_fallback_sequence") {
            CONFIG_PROXY.fallback_sequence = newSeq;
            dbSetConfigKey("fallback_sequence", newSeq);
            if (typeof setChain === "function") setChain(newSeq, "CODEX");
          } else {
            if (typeof setChain === "function") setChain(newSeq, "HERMES");
          }
        });
        // 3. Clear or advance active references
        if (CONFIG_PROXY.single_model_codex === slug || CONFIG_PROXY.single_model_codex === oldName) {
          // 被删除的是当前锁定模型 → 自动固定链中下一个模型
          var codexChain2 = getChain("CODEX") || [];
          var codexNext = codexChain2.length > 0 ? codexChain2[0].name : "";
          CONFIG_PROXY.single_model_codex = codexNext;
          dbSetConfigKey("single_model_codex", codexNext);
          if (typeof setChain === "function" && codexNext) {
            updateSettings({ single_model_codex: codexNext });
          }
        }
        if (CONFIG_PROXY.single_model_hermes === slug || CONFIG_PROXY.single_model_hermes === oldName) {
          var hermesChain2 = getChain("HERMES") || [];
          var hermesNext = hermesChain2.length > 0 ? hermesChain2[0].name : "";
          CONFIG_PROXY.single_model_hermes = hermesNext;
          dbSetConfigKey("single_model_hermes", hermesNext);
          if (typeof setChain === "function" && hermesNext) {
            updateSettings({ single_model_hermes: hermesNext });
          }
        }
        // 4. 更新异常列表
        var abnList = (CONFIG_PROXY.abnormal_models || []).slice();
        abnList = abnList.filter(function(s){ return s !== slug && s !== oldName; });
        CONFIG_PROXY.abnormal_models = abnList;
        dbSetConfigKey("abnormal_models", abnList);
        updateSettings({ abnormal_models: abnList });
        // ★ 删除模型后同步 abnormal-state 缓存
        syncFromRaw(CONFIG_PROXY.abnormal_models || [], CONFIG_PROXY._abnormal_reasons || {});
        // 5. Sync + reload
        middlemanSync();
        reloadCustomProviders();
        sendJson(res, 200, { ok: true });
      } catch (e) {
        sendJson(res, 400, { error: e.message });
      }
      return;
    }

    // GET /api/models/:idx — get single model by index (backward compat)
    if (pn.startsWith("/api/models/") && req.method === "GET") {
      const idx = parseInt(pn.slice("/api/models/".length), 10) - 1;
      if (isNaN(idx) || idx < 0) { sendJson(res, 400, { error: "invalid index" }); return; }
      try {
        const dbModels = dbGetAllModels();
        if (idx >= dbModels.length) { sendJson(res, 404, { error: "model not found" }); return; }
        sendJson(res, 200, dbModels[idx]);
      } catch (e) {
        sendJson(res, 500, { error: e.message });
      }
      return;
    }

    // PUT /api/models/:idx — backward compat (1-based index)
    if (pn.startsWith("/api/models/") && req.method === "PUT") {
      const idx = parseInt(pn.slice("/api/models/".length), 10) - 1;
      if (isNaN(idx) || idx < 0) { sendJson(res, 400, { error: "invalid index" }); return; }
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("error", () => {});
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          // Find the slug at this index
          const dbModels = dbGetAllModels();
          if (idx >= dbModels.length) { sendJson(res, 404, { error: "model not found" }); return; }
          const slug = dbModels[idx].slug;
          // Update in DB
          dbUpdateModel(slug, data);
          // Sync + reload
          middlemanSync();
          reloadCustomProviders();
          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendJson(res, 400, { error: e.message });
        }
      });
      return;
    }

    // DELETE /api/models/:idx — backward compat (1-based index)
    if (pn.startsWith("/api/models/") && req.method === "DELETE") {
      const idx = parseInt(pn.slice("/api/models/".length), 10) - 1;
      if (isNaN(idx) || idx < 0) { sendJson(res, 400, { error: "invalid index" }); return; }
      try {
        const dbModels = dbGetAllModels();
        if (idx >= dbModels.length) { sendJson(res, 404, { error: "model not found" }); return; }
        const slug = dbModels[idx].slug;
        // Delete from DB
        dbDeleteModel(slug);
        // Clear active references
        if (CONFIG_PROXY.single_model_codex === slug) {
          CONFIG_PROXY.single_model_codex = "";
          dbSetConfigKey("single_model_codex", "");
        }
        if (CONFIG_PROXY.single_model_hermes === slug) {
          CONFIG_PROXY.single_model_hermes = "";
          dbSetConfigKey("single_model_hermes", "");
        }
        // Sync + reload
        middlemanSync();
        reloadCustomProviders();
        sendJson(res, 200, { ok: true });
      } catch (e) {
        sendJson(res, 400, { error: e.message });
      }
      return;
    }

    // ── Reorder models ──
    if (pn === "/api/models/reorder" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("error", () => {});
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          const slugs = data.slugs || [];
          const target = data.target || "codex"; // "codex" or "hermes"
          if (!slugs.length) { sendJson(res, 400, { error: "slugs array required" }); return; }
          // 1. Reorder in DB
          dbReorderModels(slugs);
          // 2. Update the appropriate fallback sequence
          if (target === "hermes") {
            dbSetConfigKey("hermes_fallback_sequence", slugs.join(";"));
            CONFIG_PROXY.hermes_fallback_sequence = slugs.join(";");
            setChain(slugs.join(";"), "HERMES");
          } else {
            dbSetConfigKey("codex_fallback_sequence", slugs.join(";"));
            dbSetConfigKey("fallback_sequence", slugs.join(";"));
            CONFIG_PROXY.codex_fallback_sequence = slugs.join(";");
            CONFIG_PROXY.fallback_sequence = slugs.join(";");
            setChain(slugs.join(";"), "CODEX");
          }
          // 3. Sync + reload
          middlemanSync();
          reloadCustomProviders();
          sendJson(res, 200, { ok: true, sequence: slugs.join(";") });
        } catch (e) {
          sendJson(res, 400, { error: e.message });
        }
      });
      return;
    }

    // ── Get custom providers for vision model import (full keys) ──
    if (req.method === "GET" && pn === "/api/vision-candidates") {
      const providers = getAll();
      sendJson(res, 200, providers.filter(p => !p.isBuiltin).map(function(p) {
        return {
          name: p.name,
          fullKey: p.key || "",
          base: p.base || "",
          modelId: p.modelId || (p.models ? p.models[0] : "") || "",
        };
      }));
      return;
    }

    // ── Get vision models list with raw (unmasked) keys ──
    if (req.method === "GET" && pn === "/api/vision-models-raw") {
      const list = (CONFIG_PROXY.vision_models || []).map(function(m) {
        return { id: m.id, name: m.name, base: m.base, key: m.key || "", model: m.model, active: m.id === CONFIG_PROXY.vision_active };
      });
      sendJson(res, 200, { list: list, active: CONFIG_PROXY.vision_active || null });
      return;
    }

    // ── Vision model config ──
    if (pn === "/api/vision-models") {
      if (req.method === "GET") {
        const list = (CONFIG_PROXY.vision_models || []).map(function(m) {
          return {
            id: m.id,
            name: m.name,
            base: m.base,
            key: m.key ? m.key.slice(0, 8) + "..." : "",
            model: m.model,
            active: m.id === CONFIG_PROXY.vision_active,
          };
        });
        sendJson(res, 200, {
          list: list,
          active: CONFIG_PROXY.vision_active || null,
        });
        return;
      }
      if (req.method === "POST") {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("error", () => {});
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            const action = data.action || "add";

            if (action === "add") {
              const newModel = {
                id: "vis_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
                name: data.name || "未命名",
                base: data.base || "",
                key: data.key || "",
                model: data.model || "",
              };
              const list = CONFIG_PROXY.vision_models || [];
              list.push(newModel);
              CONFIG_PROXY.vision_models = list;
              // DB + sync
              dbSetConfigKey("vision_models", list);
              try { middlemanSync(); } catch(e) {}
              try { resetVisionCache(); } catch(e) {}
              log.info("[config-api] vision model added: " + newModel.name + " (" + newModel.id + ")");
              sendJson(res, 200, { status: "ok", id: newModel.id });
            } else if (action === "set-active") {
              CONFIG_PROXY.vision_active = data.id || "";
              CONFIG_PROXY.vision_base = "";
              CONFIG_PROXY.vision_key = "";
              CONFIG_PROXY.vision_model = "";
              const list = CONFIG_PROXY.vision_models || [];
              const found = list.find(function(m) { return m.id === data.id; });
              if (found) {
                CONFIG_PROXY.vision_base = found.base;
                CONFIG_PROXY.vision_key = found.key;
                CONFIG_PROXY.vision_model = found.model;
              }
              dbSetConfigKey("vision_active", data.id || "");
              dbSetConfigKey("vision_base", CONFIG_PROXY.vision_base);
              dbSetConfigKey("vision_key", CONFIG_PROXY.vision_key);
              dbSetConfigKey("vision_model", CONFIG_PROXY.vision_model);
              try { middlemanSync(); } catch(e) {}
              try { resetVisionCache(); } catch(e) {}
              log.info("[config-api] vision active set to: " + (data.id || "(none)"));
              sendJson(res, 200, { status: "ok", active: data.id || "" });
            } else if (action === "delete") {
              const list = (CONFIG_PROXY.vision_models || []).filter(function(m) { return m.id !== data.id; });
              CONFIG_PROXY.vision_models = list;
              if (CONFIG_PROXY.vision_active === data.id) {
                CONFIG_PROXY.vision_active = "";
                CONFIG_PROXY.vision_base = "";
                CONFIG_PROXY.vision_key = "";
                CONFIG_PROXY.vision_model = "";
              }
              dbSetConfigKey("vision_models", list);
              dbSetConfigKey("vision_active", CONFIG_PROXY.vision_active);
              try { middlemanSync(); } catch(e) {}
              try { resetVisionCache(); } catch(e) {}
              log.info("[config-api] vision model deleted: " + data.id);
              sendJson(res, 200, { status: "ok" });
            } else if (action === "copy") {
              const list = CONFIG_PROXY.vision_models || [];
              const original = list.find(function(m) { return m.id === data.id; });
              if (!original) {
                sendJson(res, 400, { error: "Model not found: " + data.id });
                return;
              }
              const copy = {
                id: "vis_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
                name: original.name + " (副本)",
                base: original.base,
                key: original.key,
                model: original.model,
              };
              list.push(copy);
              CONFIG_PROXY.vision_models = list;
              dbSetConfigKey("vision_models", list);
              try { middlemanSync(); } catch(e) {}
              try { resetVisionCache(); } catch(e) {}
              log.info("[config-api] vision model copied: " + original.name + " -> " + copy.name);
              sendJson(res, 200, { status: "ok", id: copy.id, name: copy.name });
            } else if (action === "edit") {
              const list = CONFIG_PROXY.vision_models || [];
              const idx = list.findIndex(function(m) { return m.id === data.id; });
              if (idx === -1) {
                sendJson(res, 400, { error: "Model not found: " + data.id });
                return;
              }
              if (data.name !== undefined) list[idx].name = data.name;
              if (data.base !== undefined) list[idx].base = data.base;
              if (data.key !== undefined) list[idx].key = data.key;
              if (data.model !== undefined) list[idx].model = data.model;
              CONFIG_PROXY.vision_models = list;
              if (CONFIG_PROXY.vision_active === data.id) {
                CONFIG_PROXY.vision_base = list[idx].base;
                CONFIG_PROXY.vision_key = list[idx].key;
                CONFIG_PROXY.vision_model = list[idx].model;
              }
              dbSetConfigKey("vision_models", list);
              try { middlemanSync(); } catch(e) {}
              try { resetVisionCache(); } catch(e) {}
              log.info("[config-api] vision model updated: " + list[idx].name + " (" + data.id + ")");
              sendJson(res, 200, { status: "ok" });
            } else {
              sendJson(res, 400, { error: "Unknown action: " + action });
            }
          } catch (e) {
            sendJson(res, 400, { error: e.message });
          }
        });
        return;
      }
    }

    // ── /api/countdown/timeleft (服务端统一管理倒计时) ──
    if (pn === "/api/countdown/timeleft") {
      if (req.method === "GET") {
        // ★ 自动切换关闭时，倒计时显示为 0
        var settings = getSettings();
        if (!settings.condSwitch) {
          sendJson(res, 200, { remaining_seconds: 0, interval_minutes: 0, start_at: 0, paused: true });
          return;
        }
        // 服务端计算剩余时间
        const interval = CONFIG_PROXY.fallback_interval_minutes || 96;
        const startAt = parseInt(CONFIG_PROXY._countdown_start || "0", 10);
        // ★ 调试：记录 countdown_start 每次被读取时的值
        if (startAt > 0) {
          var _now = Date.now();
          log.info("[countdown-debug] read: startAt=" + startAt + " now=" + _now + " diff=" + (_now - startAt));
        }
        let remaining = 0;
        if (startAt > 0) {
          const elapsed = Math.floor((Date.now() - startAt) / 1000);
          remaining = Math.max(0, interval * 60 - elapsed);
        } else {
          remaining = interval * 60;
        }
        sendJson(res, 200, { remaining_seconds: remaining, interval_minutes: interval, start_at: startAt });
        return;
      }
      if (req.method === "POST") {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            const action = data.action || "";
            const now = Date.now();
            
            if (action === "reset") {
              // 重置倒计时（切换后或修改间隔后）
              CONFIG_PROXY._countdown_start = now;
              CONFIG_PROXY._countdown_interval = data.interval_minutes || CONFIG_PROXY.fallback_interval_minutes || 96;
              // ★ 倒计时仅存内存，不写 DB，防止 middlemanSync 覆盖
              resetRotationTimer();
              log.info("[countdown] reset, start_at=" + now);
            } else if (action === "set_start") {
              // 设置开始时间（仅存内存）
              const s = data.start_at || now;
              CONFIG_PROXY._countdown_start = s;
            }
            sendJson(res, 200, { status: "ok" });
          } catch (e) {
            sendJson(res, 400, { error: e.message });
          }
        });
        return;
      }
    }

    // ── /api/codex/config (catch-all config read/write) ──
    if (pn === "/api/codex/config") {
      if (req.method === "GET") {
        const status = getFullStatus();
        status.single_model_codex = CONFIG_PROXY.single_model_codex || "";
        status.single_model_hermes = CONFIG_PROXY.single_model_hermes || "";
        sendJson(res, 200, status);
        return;
      }
      if (req.method === "POST") {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("error", () => {});
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            // ★ 关掉自动切换时，自动锁定当前模型（防止链重建导致 idx 漂移）
            if (data.cond_switch_enabled === false) {
              var curCodex = getCurrentProvider("CODEX");
              var curHermes = getCurrentProvider("HERMES");
              if (curCodex && !data.single_model_codex) data.single_model_codex = curCodex.slug || curCodex.name;
              if (curHermes && !data.single_model_hermes) data.single_model_hermes = curHermes.slug || curHermes.name;
            }
            // ★ ★ 打开自动切换时，不清除用户手动设置的当前模型
            // 如果用户已通过"设为当前"固定了模型，自动轮换会在 locked 模式下
            // 逐个轮换，不会卡死。
            // ★ DB级约束：CODEX 和 HERMES 不能指向同一个模型
            if (data.single_model_codex !== undefined && data.single_model_hermes !== undefined &&
                data.single_model_codex && data.single_model_hermes &&
                data.single_model_codex === data.single_model_hermes) {
              sendJson(res, 400, { error: "CODEX 和 HERMES 不能指向同一个模型" });
              return;
            }
            // 检查与当前已存值的冲突
            if (data.single_model_codex !== undefined && data.single_model_codex === (CONFIG_PROXY.single_model_hermes || "")) {
              sendJson(res, 400, { error: "CODEX 不能设置为与当前 HERMES 相同的模型" });
              return;
            }
            if (data.single_model_hermes !== undefined && data.single_model_hermes === (CONFIG_PROXY.single_model_codex || "")) {
              sendJson(res, 400, { error: "HERMES 不能设置为与当前 CODEX 相同的模型" });
              return;
            }
            // 1. Write to DB
            dbSetConfigBulk(data);
            // 2. Update in-memory state
            updateSettings(data);
            CONFIG_PROXY.single_model_codex = data.single_model_codex !== undefined
              ? data.single_model_codex : CONFIG_PROXY.single_model_codex;
            CONFIG_PROXY.single_model_hermes = data.single_model_hermes !== undefined
              ? data.single_model_hermes : CONFIG_PROXY.single_model_hermes;
            // 3. Sync DB → JSON + reload proxy
            try { middlemanSync(); } catch (e) { /* silent */ }
            log.info(`[config-api] POST /api/codex/config:`, Object.keys(data).join(", "));
            sendJson(res, 200, { status: "ok" });
          } catch (e) {
            sendJson(res, 400, { error: e.message });
          }
        });
        return;
      }
    }

    // Built-in provider update
    if (req.method === "PUT" && pn.startsWith("/api/builtins/")) {
      const name = decodeURIComponent(pn.slice("/api/builtins/".length));
      let body = "";
      req.on("data", c => body += c);
      req.on("error", () => {});
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          const provider = find(name);
          if (!provider || !provider.isBuiltin) {
            sendJson(res, 404, { error: `builtin provider "${name}" not found` });
            return;
          }
          if (data.key !== undefined) provider.key = data.key;
          if (data.base !== undefined) provider.base = data.base;
          if (data.disabled !== undefined) provider.disabled = data.disabled;
          if (data.models !== undefined) provider.models = data.models;
          persistBuiltinOverrides(name, { key: provider.key, base: provider.base, disabled: provider.disabled, models: provider.models });
          log.info(`[config-api] updated builtin provider "${name}"`);
          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendJson(res, 400, { error: "invalid data" });
        }
      });
      return;
    }

    // Built-in provider disable (DELETE = disable)
    if (req.method === "DELETE" && pn.startsWith("/api/builtins/")) {
      const name = decodeURIComponent(pn.slice("/api/builtins/".length));
      const provider = find(name);
      if (!provider || !provider.isBuiltin) {
        sendJson(res, 404, { error: `builtin provider "${name}" not found` });
        return;
      }
      provider.disabled = true;
      persistBuiltinOverrides(name, { key: provider.key, base: provider.base, disabled: provider.disabled, models: provider.models });
      log.info(`[config-api] disabled builtin provider "${name}"`);
      sendJson(res, 200, { ok: true });
      return;
    }

    // Restart
    if (req.method === "POST" && pn === "/api/restart") {
      sendJson(res, 200, { status: "ok", message: "restart initiated" });
      setTimeout(() => process.exit(0), 500);
      return;
    }

	    // ── /api/proxy-info (用于 proxy-info.html 和外部查询) ──
	    if (pn === "/api/proxy-info") {
	      // 使用异步 IIFE 检测 proxy 是否在线
	      (async function() {
	        var proxyOnline = false;
	        try {
	          const checkRes = await fetch("http://127.0.0.1:" + PORTS.proxy + "/health", { signal: AbortSignal.timeout(2000) });
	          proxyOnline = checkRes.ok;
	        } catch(e) { proxyOnline = false; }

	        const fullStatus = getFullStatus();
	        const allProviders = getAll();

	        // 获取自定义（Chat Completions）模型列表
	        const customProviders = allProviders.filter(function(p) { return !p.isBuiltin; });
	        const chatModels = customProviders.map(function(p) {
	          return {
	            name: p.name,
	            slug: p.slug,
	            base: p.base,
	            key: p.key ? p.key.slice(0, 8) + "…" : "",
	            model_id: p.modelId,
	            models: p.models,
	          };
	        });

	        // 获取当前 CODEX/HERMES 提供商详情
	        var codexProvider = null;
	        var hermesProvider = null;
	        try {
	          const codexP = getCurrentProvider("CODEX");
	          const hermesP = getCurrentProvider("HERMES");
	          if (codexP) { codexProvider = { name: codexP.name, slug: codexP.slug, model: codexP.modelId, base: codexP.base, isBuiltin: codexP.isBuiltin }; }
	          if (hermesP) { hermesProvider = { name: hermesP.name, slug: hermesP.slug, model: hermesP.modelId, base: hermesP.base, isBuiltin: hermesP.isBuiltin }; }
	        } catch(e) {}

	        const uptimeSec = Math.floor(process.uptime());
	        var uptimeText = "";
	        if (uptimeSec < 60) uptimeText = uptimeSec + "秒";
	        else if (uptimeSec < 3600) uptimeText = Math.floor(uptimeSec / 60) + "分" + (uptimeSec % 60) + "秒";
	        else uptimeText = Math.floor(uptimeSec / 3600) + "小时" + Math.floor((uptimeSec % 3600) / 60) + "分";

	        sendJson(res, 200, {
	          proxy_online: proxyOnline,
	          uptime: uptimeSec,
	          uptime_text: uptimeText,
	          providers_total: allProviders.length,
	          models_total: allProviders.reduce(function(sum, p) { return sum + (p.models ? p.models.length : 0); }, 0),
	          codex_provider: codexProvider,
	          hermes_provider: hermesProvider,
	          codex_chain: (fullStatus.fallback_chain || []),
	          hermes_chain: (fullStatus.hermes_chain || []),
	          codex_cur_slug: fullStatus.codex_cur_slug || null,
	          hermes_cur_slug: fullStatus.hermes_cur_slug || null,
	          single_model_codex: CONFIG_PROXY.single_model_codex || "",
	          single_model_hermes: CONFIG_PROXY.single_model_hermes || "",
	          abnormal_models: getAbnormalList() || CONFIG_PROXY.abnormal_models || [],
	          chat_completions_models: chatModels,
	        });
	      })();
	      return;
	    }

	    // ── /proxy-info.html (静态代理信息页) ──
	    if (req.method === "GET" && pn === "/proxy-info.html") {
	      // 优先从 bridge/ 根目录读取（Git跟踪），其次从 data/ 读取
	      const htmlPath1 = path.join(PATHS.root, "proxy-info.html");
	      const htmlPath2 = path.join(PATHS.data, "proxy-info.html");
	      if (fs.existsSync(htmlPath1)) {
	        serveFile(res, htmlPath1, "text/html; charset=utf-8");
	      } else if (fs.existsSync(htmlPath2)) {
	        serveFile(res, htmlPath2, "text/html; charset=utf-8");
	      } else {
	        sendJson(res, 404, { error: "proxy-info.html not found" });
	      }
	      return;
	    }

	    // 404
	    sendJson(res, 404, { error: "not found" });
	  });

  server.on("error", function(e) {
    if (e.code === "EADDRINUSE") {
      log.error(`[config-api] port ${port} is already in use, config API unavailable`);
      log.warn("[config-api] proxy and admin panel will still work, but config changes won't be saved");
    } else {
      log.error(`[config-api] server error: ${e.message}`);
    }
  });

  server.listen(port, () => {
    log.info(`[config-api] running on http://localhost:${port}`);

    // ─── 服务端倒计时守护：不依赖前端页面，自动触发切换 ───
    setInterval(function() {
      // ★ 自动切换关闭时，守护不做任何事（前端倒计时已冻结）
      if (!CONFIG_PROXY.cond_switch_enabled && CONFIG_PROXY.cond_switch_enabled !== undefined) return;
      if (!CONFIG_PROXY._countdown_start) return;
      const interval = CONFIG_PROXY.fallback_interval_minutes || 96;
      const startAt = parseInt(CONFIG_PROXY._countdown_start || "0", 10);
      if (startAt <= 0) return;
      const elapsed = Math.floor((Date.now() - startAt) / 1000);
      const remaining = interval * 60 - elapsed;
      if (remaining <= 0) {
        log.info(`[countdown] expired (interval=${interval}min), auto-switching`);
        try {
          // ★ 倒计时切换：清除锁定模型，永久切换到下一个
          //   不清除的话 _lockExhaustedUntil 5分钟过期后会回到原模型
          const codexSwitched = clearSingleAndAdvance("CODEX", true);
          const hermesSwitched = clearSingleAndAdvance("HERMES", true);
          if (codexSwitched) log.info(`[countdown] CODEX switched to "${codexSwitched.name}"`);
          if (hermesSwitched) log.info(`[countdown] HERMES switched to "${hermesSwitched.name}"`);
          // ★ 清除锁定，让 idx 推进永久生效
          CONFIG_PROXY.single_model_codex = '';
          CONFIG_PROXY.single_model_hermes = '';
          try { dbSetConfigKey('single_model_codex', ''); } catch(e) {}
          try { dbSetConfigKey('single_model_hermes', ''); } catch(e) {}
          // ★ 倒计时重置：只写内存
          CONFIG_PROXY._countdown_start = Date.now();
        } catch(e) {
          log.warn(`[countdown] switch failed: ${e.message}`);
        }
      }
    }, 10000);
  });

  return server;
}

// ─── Persist builtin provider overrides ──
const _overrideFile = path.join(PATHS.data, "builtin-overrides.json");
function loadBuiltinOverrides() {
  try {
    if (fs.existsSync(_overrideFile)) {
      return JSON.parse(fs.readFileSync(_overrideFile, "utf8"));
    }
  } catch(e) {}
  return {};
}

function persistBuiltinOverrides(name, props) {
  try {
    const all = loadBuiltinOverrides();
    all[name] = props;
    const dir = path.dirname(_overrideFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(_overrideFile, JSON.stringify(all, null, 2));
  } catch(e) {
    log.warn(`[config-api] failed to persist builtin overrides: ${e.message}`);
  }
}

export { loadBuiltinOverrides, persistBuiltinOverrides };

// ── Helpers ──

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * 输入验证：禁止逗号、分号、管道符、中文符号等特殊字符
 * 这些字符可能破坏 fallback_sequence 格式或数据库查询
 */
function validateModelInput(data) {
  const forbidden = /[,;|、，；｜\n\r\t"']/;
  if (!data.name || !data.name.trim()) return "模型名称不能为空";
  if (forbidden.test(data.name)) return "模型名称不能包含逗号、分号、管道符等特殊字符";
  if (!data.base || !data.base.trim()) return "API 地址不能为空";
  if (!data.key || !data.key.trim()) return "API 密钥不能为空";
  if (!data.id || !data.id.trim()) return "模型 ID 不能为空";
  if (forbidden.test(data.id)) return "模型 ID 不能包含逗号、分号、管道符等特殊字符";
  return null; // 验证通过
}

function serveFile(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}
