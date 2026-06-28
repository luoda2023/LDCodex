/**
 * Config API Server
 *
 * Provides the configuration management API on a separate HTTP server.
 * Port: 37001 (development) / 40001 (production)
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
import { getChain, setChain, getSettings, updateSettings, getFullStatus, advanceFallback, clearSingleAndAdvance, getChainString } from "./fallback.mjs";
import { find } from "./provider-registry.mjs";
import { getAll } from "./provider-registry.mjs";
import { unregister } from "./provider-registry.mjs";
import { register } from "./provider-registry.mjs";
import { getMetrics } from "./concurrency.mjs";
import { resetVisionCache } from "./protocol/openai-responses.mjs";
import { createCustomProvider } from "./provider-custom.mjs";
import { initDB, saveConfig, saveJSONBackup, loadProviderTokens } from "./config-store.mjs";

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
      const adminPort = process.env.ADMIN_PORT || 37002;
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
        sendJson(res, 200, dbModels.map(m => ({
          name: m.name, slug: m.slug, base: m.base,
          key: m.key, id: m.model_id, models: [m.model_id],
          idx: m.idx, isBuiltin: false,
        })));
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
            setChain(data.fallback_sequence);
          }
          updateSettings(data);
          // 3. Sync DB → JSON via middleman
          try { middlemanSync(); } catch (e) { /* middleman may fail */ }
          sendJson(res, 200, { status: "ok", sequence: getChainString() });
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
        const list = CONFIG_PROXY.abnormal_models || [];
        sendJson(res, 200, { list: list });
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
            const list = CONFIG_PROXY.abnormal_models || [];
            let newList;
            
            // ★ 获取当前 fallback_sequence
            var seq = (CONFIG_PROXY.codex_fallback_sequence || CONFIG_PROXY.fallback_sequence || "").split(";").filter(Boolean);
            
            if (abnormal) {
              newList = list.includes(key) ? list : list.concat([key]);
              // ★ 从 fallback_sequence 中移除
              seq = seq.filter(function(s) { return s !== key; });
              log.warn("[config-api] abnormal + remove from chain: " + key);
              
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
              newList = list.filter(function(m) { return m !== key; });
              // ★ 恢复到 fallback_sequence 末尾
              if (!seq.includes(key)) { seq.push(key); }
              log.info("[config-api] restore from abnormal → append to chain: " + key);
            }
            
            // ★ 更新 CONFIG_PROXY + DB + fallback 链
            var newSeq = seq.join(";");
            CONFIG_PROXY.fallback_sequence = newSeq;
            CONFIG_PROXY.codex_fallback_sequence = newSeq;
            CONFIG_PROXY.abnormal_models = newList;
            
            // 1. 写 DB（abnormal_models + fallback_sequence）
            dbSetConfigKey("abnormal_models", newList);
            dbSetConfigKey("fallback_sequence", newSeq);
            dbSetConfigKey("codex_fallback_sequence", newSeq);
            
            // 2. 更新内存中的 fallback 链
            if (typeof setChain === "function") setChain(newSeq);
            updateSettings({ abnormal_models: newList });
            
            // 3. Sync
            try { middlemanSync(); } catch (e) { /* silent */ }
            sendJson(res, 200, { status: "ok", list: newList });
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
          
          const newProvider = clearSingleAndAdvance(clientId);
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
        sendJson(res, 200, m);
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
          // 1. Write to DB
          dbUpdateModel(slug, data);
          var newSlug = (data.slug || "").trim();
          // 2. 如果 slug 变了，更新 fallback_sequence + single_model 锁定
          if (newSlug && newSlug !== slug) {
            var seq = (CONFIG_PROXY.codex_fallback_sequence || CONFIG_PROXY.fallback_sequence || "").split(";").filter(Boolean);
            var seqIdx = seq.indexOf(slug);
            if (seqIdx >= 0) seq[seqIdx] = newSlug;
            var newSeq = seq.join(";");
            CONFIG_PROXY.fallback_sequence = newSeq;
            CONFIG_PROXY.codex_fallback_sequence = newSeq;
            dbSetConfigKey("fallback_sequence", newSeq);
            dbSetConfigKey("codex_fallback_sequence", newSeq);
            // 更新 single_model 锁定
            if (CONFIG_PROXY.single_model_codex === slug) {
              CONFIG_PROXY.single_model_codex = newSlug;
              dbSetConfigKey("single_model_codex", newSlug);
            }
            if (CONFIG_PROXY.single_model_hermes === slug) {
              CONFIG_PROXY.single_model_hermes = newSlug;
              dbSetConfigKey("single_model_hermes", newSlug);
            }
            log.info("[config-api] slug changed: " + slug + " → " + newSlug + ", chain updated");
          }
          // 3. Sync + reload
          middlemanSync();
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
        // 1. Delete from DB
        dbDeleteModel(slug);
        // 2. Clear active references if needed
        if (CONFIG_PROXY.single_model_codex === slug) {
          CONFIG_PROXY.single_model_codex = "";
          dbSetConfigKey("single_model_codex", "");
        }
        if (CONFIG_PROXY.single_model_hermes === slug) {
          CONFIG_PROXY.single_model_hermes = "";
          dbSetConfigKey("single_model_hermes", "");
        }
        // 3. Sync + reload
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
          if (!slugs.length) { sendJson(res, 400, { error: "slugs array required" }); return; }
          // 1. Reorder in DB
          dbReorderModels(slugs);
          // 2. Update fallback sequence from new ordering
          dbSetConfigKey("codex_fallback_sequence", slugs.join(";"));
          dbSetConfigKey("fallback_sequence", slugs.join(";"));
          // 3. Update in-memory
          CONFIG_PROXY.codex_fallback_sequence = slugs.join(";");
          CONFIG_PROXY.fallback_sequence = slugs.join(";");
          setChain(slugs.join(";"));
          // 4. Sync + reload
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
        // 服务端计算剩余时间
        const interval = CONFIG_PROXY.fallback_interval_minutes || 96;
        const startAt = parseInt(CONFIG_PROXY._countdown_start || "0", 10);
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
              dbSetConfigKey("_countdown_start", String(now));
              dbSetConfigKey("_countdown_interval", String(CONFIG_PROXY._countdown_interval));
              log.info("[countdown] reset, start_at=" + now);
            } else if (action === "set_start") {
              // 设置开始时间
              const s = data.start_at || now;
              CONFIG_PROXY._countdown_start = s;
              dbSetConfigKey("_countdown_start", String(s));
            }
            try { middlemanSync(); } catch (e) { /* silent */ }
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


    // Proxy info page
    if (req.method === "GET" && pn === "/proxy-info.html") {
      const filePath = path.join(PATHS.root, "..", "admin", "proxy-info.html");
      serveFile(res, filePath, "text/html; charset=utf-8");
      return;
    }
    // Restart
    if (req.method === "POST" && pn === "/api/restart") {
      sendJson(res, 200, { status: "ok", message: "restart initiated" });
      setTimeout(() => process.exit(0), 500);
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
      if (!CONFIG_PROXY._countdown_start) return;
      const interval = CONFIG_PROXY.fallback_interval_minutes || 96;
      const startAt = parseInt(CONFIG_PROXY._countdown_start || "0", 10);
      if (startAt <= 0) return;
      const elapsed = Math.floor((Date.now() - startAt) / 1000);
      const remaining = interval * 60 - elapsed;
      if (remaining <= 0) {
        log.info(`[countdown] expired (interval=${interval}min), auto-switching`);
        try {
          // ★ 自动切换时，CODEX 和 HERMES 同时切换
          const codexSwitched = clearSingleAndAdvance("CODEX", true);
          const hermesSwitched = clearSingleAndAdvance("HERMES", true);
          if (codexSwitched) log.info(`[countdown] CODEX switched to "${codexSwitched.name}"`);
          if (hermesSwitched) log.info(`[countdown] HERMES switched to "${hermesSwitched.name}"`);
          const now = Date.now();
          CONFIG_PROXY._countdown_start = now;
          dbSetConfigKey("_countdown_start", String(now));
          dbSetConfigKey("_countdown_interval", String(interval));
          middlemanSync();
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
