/**
 * Proxy Server Module
 *
 * Main HTTP/1.1 server that handles all proxy requests.
 * Routes requests to the appropriate provider based on model name.
 */

import http from "node:http";
import { log } from "./logger.mjs";
import { PORTS, UPSTREAM, MODELS, CONFIG_PROXY, reloadConfig } from "./config.mjs";
import { authenticate, isOpenRoute } from "./auth.mjs";
import { acquireSlot, releaseSlot, recordLatencyMs, getMetrics } from "./concurrency.mjs";
import { find, findForModel, getAll } from "./provider-registry.mjs";
import { getCurrentProvider, advanceFallback, getFullStatus, getSettings, updateSettings, clearSingleAndAdvance, setChain, clearQuotaState, isLockExhausted } from "./fallback.mjs";
import { getAllHealth } from "./health-check.mjs";
import { handleResponses } from "./protocol/openai-responses.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

// ── Model catalog (for /v1/models endpoint) ──
let modelCatalog = [];

// ★ 连续限流计数：达到3次时切到下一个模型，每次只切1个
var _rateLimitCount = {};

export function rebuildModelCatalog() {
  const allProviders = getAll();
  modelCatalog = [];

  for (const p of allProviders) {
    if (p.disabled) continue;
    for (const model of p.models) {
      modelCatalog.push({
        id: model,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: p.name,
        provider: p.name,
      });
    }
  }
}

/**
 * Start the proxy server.
 */
export function startProxyServer() {
  const port = PORTS.proxy;

  rebuildModelCatalog();

  const server = http.createServer(async (req, res) => {
    const startTime = Date.now();
    let slotAcquired = false;

    // ── CORS headers (every response) ──
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Track ALL requests (diagnostic for user)
    if (typeof global.__reqCount === 'undefined') global.__reqCount = 0;
    global.__reqCount++;

    try {
      // ── Dynamic concurrency (bypass for open routes) ──
      const bypassDyn = isOpenRoute(req.url, req.method);
      if (!bypassDyn) {
        const acquired = await acquireSlot();
        if (!acquired) {
          sendJson(res, 503, {
            error: { message: "Server is draining, try again later", type: "overloaded" }
          });
          return;
        }
        slotAcquired = true;
        res.once("finish", () => releaseSlot());
        res.once("close", () => releaseSlot());
      }

      // ── Access log ──
      log.access(`[access] ${req.method} ${req.url}`);

      // ── Routing ──
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const pn = url.pathname;

      // Health check
      if (req.method === "GET" && pn === "/health") {
        sendJson(res, 200, {
          status: "ok",
          port: port,
          uptime: process.uptime(),
          providers: getAll().length,
        });
        return;
      }

      // Token data (for dashboard)
      if (req.method === "GET" && pn === "/api/tokens") {
        sendJson(res, 200, getTok());
        return;
      }

      // Token debug (diagnostic)
      if (req.method === "GET" && pn === "/api/tokens/debug") {
        sendJson(res, 200, {
          total_requests: global.__reqCount || 0,
          _tokenStore_exists: _tokenStore !== null,
          _tokenStore: _tokenStore,
          global_tokenStore: global.__tokenStore || null,
          global_pushTokenUsage: typeof global.__pushTokenUsage === 'function'
        });
        return;
      }

      // ── Config reload (triggered by middleman after admin changes) ──
      if (req.method === "GET" && pn === "/api/reload") {
        try {
          await reloadConfig();
          log.info("[proxy] config reloaded via /api/reload");
          sendJson(res, 200, { ok: true, message: "config reloaded" });
        } catch (e) {
          log.warn("[proxy] /api/reload failed: " + e.message);
          sendJson(res, 500, { ok: false, message: e.message });
        }
        return;
      }

      // Token raw log (for granular chart views)
      if (req.method === "GET" && pn === "/api/tokens/log") {
        sendJson(res, 200, { entries: _tokenLog.filter(function(e){ return e.ts >= Date.now() - 604800000; }) });
        return;
      }

      // Model list — 只返回 3 个虚拟模型 ID（neizhiAPI, codexAPI, hermesAPI）
      if (req.method === "GET" && (pn === "/v1/models" || pn === "/models")) {
        const now = Math.floor(Date.now() / 1000);
        const virtualModels = [
          { id: "neizhiAPI", object: "model", created: now, owned_by: "luoda", provider: "luoda" },
          { id: "codexAPI", object: "model", created: now, owned_by: "luoda", provider: "luoda" },
          { id: "hermesAPI", object: "model", created: now, owned_by: "luoda", provider: "luoda" },
        ];
        sendJson(res, 200, {
          object: "list",
          data: virtualModels,
          default_provider: getCurrentProvider()?.name || null,
        });
        return;
      }

      // Status
      if (req.method === "GET" && pn === "/api/status") {
        const status = getFullStatus();
        status.provider_health = getAllHealth();
        sendJson(res, 200, status);
        return;
      }

      // Dyn metrics
      if (req.method === "GET" && pn === "/api/dynmetrics") {
        sendJson(res, 200, getMetrics());
        return;
      }

      // ─── File download (for CODEX to retrieve generated files like PPT, images) ───
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

      // ─── File upload (for CODEX to upload files like Word docs for processing) ───
      if (req.method === "POST" && pn === "/api/files/upload") {
        var fpath = url.searchParams.get("path") || "";
        if (!fpath) { sendJson(res, 400, { error: "Missing path" }); return; }
        var bdy = "";
        req.on("data", function(c) { bdy += c; });
        req.on("end", function() {
          try {
            fs.writeFileSync(fpath, bdy, "utf-8");
            sendJson(res, 200, { status: "saved" });
          } catch(e) { sendJson(res, 500, { error: e.message }); }
        });
        return;
      }

      // ── Auth gate ──
      const auth = authenticate(req);
      if (!auth.authorized) {
        sendJson(res, auth.status, auth.body);
        return;
      }

      // ── Parse body for POST requests with size limit ──
      if (req.method !== "POST") {
        sendJson(res, 405, { error: { message: "Method not allowed" } });
        return;
      }

      let body = "";
      let bodySize = 0;
      const MAX_BODY = 50 * 1024 * 1024; // 50MB max (for images/files)
      let bodyTooLarge = false;
      req.on("data", chunk => {
        bodySize += chunk.length;
        if (bodySize > MAX_BODY) {
          bodyTooLarge = true;
          req.destroy();
          return;
        }
        body += chunk;
      });
      req.on("end", async () => {
        if (bodyTooLarge) {
          if (!res.headersSent) {
            sendJson(res, 413, { error: { message: "Request body too large (max 5MB)" } });
          }
          return;
        }
        let parsedBody;
        try {
          parsedBody = JSON.parse(body);
        } catch {
          sendJson(res, 400, { error: { message: "Invalid JSON body" } });
          return;
        }

        // ── Client identification ──
        const clientHdr = (req.headers["x-client-id"] || "").toLowerCase().trim();
        let clientId = clientHdr === "hermes" ? "HERMES" : "CODEX";

        // ── Provider resolution ──
        let requestedModel = parsedBody.model || "";
        const isResponsesAPI = pn === "/v1/responses" || pn === "/responses";

        let provider = null;
        let resolvedModel = requestedModel;

        // Step 1: Try fallback chain (if enabled)
        // Virtual model IDs: codexAPI/hermesAPI, auto, neizhiAPI, or empty
        const modelLower = requestedModel.toLowerCase();
        const isVirtualModel = modelLower === "codexapi" || modelLower === "hermesapi" || modelLower === "neizhiapi" || modelLower === "auto" || !requestedModel;
        if (isVirtualModel) {
          // Use virtual model to determine which fallback client to use
          let fallbackClientId = clientId;
          if (modelLower === "hermesapi") {
            fallbackClientId = "HERMES";
          } else if (modelLower === "neizhiapi") {
            // ★ neizhiAPI = 内置模型，使用 single_model_neizhi 配置或默认 MiMo
            var _nzModel = (CONFIG_PROXY.single_model_neizhi || "mimo").toLowerCase();
            provider = find(_nzModel);
            if (!provider) provider = find("mimo") || find("MiMo");
            clientId = "NEIZHI";
          }
          if (!provider && modelLower !== "neizhiapi") {
            provider = getCurrentProvider(fallbackClientId);
          }
          // Override clientId for token tracking (3 virtual IDs separate)
          if (modelLower === "hermesapi") clientId = "HERMES";
          else if (modelLower === "neizhiapi") {} // already set above
          else if (modelLower === "codexapi") clientId = "CODEX";
        }

        // Step 2: Try model→provider lookup
        if (!provider && requestedModel) {
          provider = findForModel(requestedModel);
        }

        // ★ 如果 model→provider 找到了锁定模型且锁已耗尽，降级走 fallback chain
        if (provider && isLockExhausted(clientId, provider.name)) {
          log.info(`[proxy] "${provider.name}" match from model but lock exhausted, using fallback chain`);
          provider = null;
        }

        // Step 3: Try direct name lookup
        if (!provider && requestedModel) {
          provider = find(requestedModel);
        }

        // Step 4: Use default provider
        if (!provider) {
          provider = getCurrentProvider(clientId);
        }

        if (!provider) {
          sendJson(res, 400, {
            error: { message: `No provider available for model "${requestedModel}"` }
          });
          return;
        }

        // ── Route the request ──
        const ctx = {
          req,
          res,
          provider,
          clientId,
          model: resolvedModel || provider.modelId,
          modelId: provider.modelId,
          timeout: UPSTREAM.upstreamTimeout,
        };

      // ── Image-aware routing ──
      // handleResponses 内部已包含完整的视觉预处理逻辑：
      //   1. 检查 input_image 块和 data:image/ URL
      //   2. 如果视觉模型配置了且有额度 → 调用视觉API描述图片
      //   3. 如果视觉模型没额度 → 用占位符替换
      //   4. 最终请求发给原始 provider（不走视觉模型）
      // ★ 不再强行切换 provider！视觉模型免费额度用完时，强行切换会导致请求卡死。
      if (isResponsesAPI && body.indexOf("input_image") !== -1) {
        log.info("[proxy] input_image detected, vision handled internally");
        ctx.hasImages = true;
      }

        try {
          let result;

          if (isResponsesAPI) {
            // Responses API → convert to Chat Completions internally
            result = await handleResponses(ctx, req, parsedBody);
          } else {
            // Chat Completions (or /v1/chat/completions)
            // ★ 注入中文回复要求
            const _chatBody = typeof parsedBody === 'object' ? parsedBody : JSON.parse(parsedBody);
            if (_chatBody && Array.isArray(_chatBody.messages)) {
              const hasChineseSys = _chatBody.messages.some(function(m){ return m.role === 'system' && m.content.indexOf('中文') >= 0; });
              if (!hasChineseSys) {
                _chatBody.messages.unshift({
                  role: "system",
                  content: "【强制语言要求】你必须始终用中文回复！所有输出必须是中文！问题用什么语言写的不重要，你都必须用中文回答。中文是你唯一的输出语言。\n\n[MANDATORY] You MUST always respond in Chinese. ALL output must be in Chinese."
                });
                // 末尾再放一个简短提醒
                _chatBody.messages.push({
                  role: "system",
                  content: "重要提醒：记得用中文回复！"
                });
              }
            }
            result = await provider.handler(ctx, req, _chatBody);
          }

          // Record latency
          recordLatencyMs(Date.now() - startTime);

          // Record token usage for dashboard — use recordTokenUsage function
          if (result) {
            try {
              var _d = result.data || result;
              var _u = _d.usage || _d.usage_metadata || {};
              var _t = _u.total_tokens || _u.total || 0;
              if (_t > 0) {
                recordTokenUsage(_d, provider.name, clientId);
              }
            } catch(e) {}
          }

          // Send successful response to client
          if (result && !result.error && !res.headersSent) {
            var _data = result.data || {};
            // Strip <think> and <response> tags from upstream model output
            sanitizeResponse(_data);
            sendJson(res, result.status || 200, _data);
            // 请求成功 → 重置该 provider 的额度检测状态和限流计数
            clearQuotaState(provider.name);
            delete _rateLimitCount[provider.name];
          }

          // Handle fallback — any non-success response
          // ★ 分两部分：发送响应给客户端（仅当 headers 未发送），和额度耗尽检测（始终执行）
          var _hasStatus = typeof result?.status === 'number';
          var _isError = result && (result.error || (_hasStatus && result.status >= 400));
          // ★ 注意：result.status 可能是 undefined（流式成功响应），此时默认不视为错误！
          //   result.status || 502 → 当 status 为 undefined 时会被误判为 502 错误
          //   这里必须显式检查 typeof status === 'number'

          if (_isError) {
            // ★ 始终执行：额度耗尽检测 + 链切换（即使 headers 已发送）
            var _errStrAll = JSON.stringify(result).toLowerCase();
            var _quotaStatus = _hasStatus ? result.status : 0;
            var _errMsg = '';
            var _errType = '';
            try {
              var _e = (result.data && result.data.error) || result.error || {};
              _errMsg = _e.message || '';
              _errType = _e.type || '';
            } catch(e) {}
            var _msgLc = (_errMsg + ' ' + _errType).toLowerCase();
            // ★ 严格判断"额度用完"：只有明确表示配额/余额耗尽才切换
            //   状态码 402 = Payment Required → 额度用完
            //   状态码 429 = Rate Limited → 不切换，原地重试
            var _isQuotaExhausted = _quotaStatus === 402 ||
              /(?:quota|credit|token).*(?:exhausted|insufficient)|insufficient.*(?:quota|balance|credit)/i.test(_msgLc) ||
              /余额不足|额度.*用完|额度.*耗尽|配额不足/i.test(_errMsg);

            if (_isQuotaExhausted) {
              try {
                const _cx = clearSingleAndAdvance("CODEX", true, provider.name);
                const _hm = clearSingleAndAdvance("HERMES", true, provider.name);
                if (_cx) log.info(`[proxy] quota exhausted, CODEX switched to "${_cx.name}"`);
                if (_hm) log.info(`[proxy] quota exhausted, HERMES switched to "${_hm.name}"`);
                if (!_cx && !_hm) log.warn(`[proxy] quota exhausted but no fallback available`);
              } catch(e) {
                log.warn(`[proxy] quota exhausted switch failed: ${e.message}`);
              }
            }

            // ★ 仅在 headers 未发送时才发响应给客户端
            if (!res.headersSent) {
              var _rs = _hasStatus ? result.status : 502;
              var _errObj = (result.data && result.data.error) || result.error || null;
              var _safeMsg = "service temporarily unavailable";
              var _safeCode = "service_unavailable";
              if (_errObj) {
                var _es = JSON.stringify(_errObj).toLowerCase();
                if (/quota|exhausted|insufficient|无余额|额度|用完|耗尽/.test(_es)) {
                  _safeMsg = "provider quota exhausted"; _safeCode = "quota_exhausted";
                } else if (/rate|rpm|tps|too.many/.test(_es)) {
                  _safeMsg = "rate limited"; _safeCode = "rate_limited";
                } else if (/auth|key|unauthorized|token.*invalid/.test(_es)) {
                  _safeMsg = "provider auth error"; _safeCode = "provider_auth_error";
                }
              }
              sendJson(res, _rs, { error: { message: _safeMsg, code: _safeCode, type: "upstream_error" } });
            } else if (!_isQuotaExhausted) {
              log.warn(`[proxy] "${provider.name}" error ${_hasStatus ? result.status : 502} suppressed — ${_errStrAll.slice(0,200)}`);
            }
          } else if (result && !res.headersSent) {
            // Normal success response
            var _data = result.data || {};
            sanitizeResponse(_data);
            sendJson(res, result.status || 200, _data);
            clearQuotaState(provider.name);
            delete _rateLimitCount[provider.name];
          }
        } catch (e) {
          log.warn(`[proxy] request error for "${provider.name}": ${e.message}`);
          if (!res.headersSent) {
            sendJson(res, 502, {
              error: { message: "service temporarily unavailable", code: "upstream_error", type: "upstream_error" }
            });
          }
        }
      });

    } catch (e) {
      log.error("[proxy] server error:", e.message);
      if (!res.headersSent) {
        sendJson(res, 500, { error: { message: "Internal server error" } });
      }
    }
  });

  server.listen(port, () => {
    log.info(`[proxy] running on http://localhost:${port}`);
    log.info(`[proxy] providers: ${getAll().length} registered`);
    log.info(`[proxy] models: ${modelCatalog.length} in catalog`);
  });

  return server;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Strip <think> and <response> tags from upstream model output.
 * These tags come from model's reasoning/inference output and are not
 * meant for the downstream client (CODEX).
 * Only removes the tag markers themselves, preserving content between them.
 */
function sanitizeResponse(data) {
  if (!data || typeof data !== 'object') return;
  // ★ 只 strip <response> 标签，保留 <think> 标签让 WorkBUDDY 可以折叠思考过程
  const reTag = /<\/?response>/gi;
  // Chat Completions format: choices[].message.content
  if (data.choices && Array.isArray(data.choices)) {
    data.choices.forEach(function(choice) {
      if (choice.message && typeof choice.message.content === 'string') {
        choice.message.content = choice.message.content.replace(reTag, '').trim();
      }
      if (choice.delta && typeof choice.delta.content === 'string') {
        choice.delta.content = choice.delta.content.replace(reTag, '').trim();
      }
    });
  }
  // Responses API format: output[].content[].text
  if (data.output && Array.isArray(data.output)) {
    data.output.forEach(function(item) {
      if (item.content && Array.isArray(item.content)) {
        item.content.forEach(function(part) {
          if (part.text && typeof part.text === 'string') {
            part.text = part.text.replace(reTag, '').trim();
          }
        });
      }
    });
  }
}

// ─── Self-contained Token Tracking (no admin module dependency) ──
var _tokenStore = null;
var _tokenLog = []; // Raw log: [{ ts: timestamp, neizhi, codex, hermes }]
var _tokPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "tokens.json");
var _tokLogPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "token-log.json");
var _tokSaveTimer = null; // debounce timer

function saveTok() {
  clearTimeout(_tokSaveTimer);
  _tokSaveTimer = setTimeout(() => {
    try {
      var dir = path.dirname(_tokPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(_tokPath, JSON.stringify(_tokenStore));
      var log = _tokenLog.slice(-50000);
      fs.writeFileSync(_tokLogPath, JSON.stringify(log));
    } catch(e) {}
  }, 3000);
}

function loadTok() {
  try {
    if (fs.existsSync(_tokPath)) {
      var raw = fs.readFileSync(_tokPath, "utf8");
      var d = JSON.parse(raw);
      if (d && d.labels && d.labels.length) {
        _tokenStore = d;
        global.__tokenStore = d;
      }
    }
    // Load raw log
    if (fs.existsSync(_tokLogPath)) {
      var rawLog = fs.readFileSync(_tokLogPath, "utf8");
      var log = JSON.parse(rawLog);
      if (Array.isArray(log)) _tokenLog = log;
    }
  } catch(e) {}
}

// Load persistent data on startup
loadTok();

function getDefTok() {
  var d = new Date();
  return { labels: [String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')], neizhi: [0], codex: [0], hermes: [0], total: 0 };
}

function pushToken(entry) {
  var data = _tokenStore || (_tokenStore = getDefTok());
  var lbl = String(new Date().getMonth()+1).padStart(2,'0')+'-'+String(new Date().getDate()).padStart(2,'0');
  var i = data.labels.indexOf(lbl);
  if (i >= 0) { data.neizhi[i] += entry.neizhi||0; data.codex[i] += entry.codex||0; data.hermes[i] += entry.hermes||0; }
  else { data.labels.push(lbl); data.neizhi.push(entry.neizhi||0); data.codex.push(entry.codex||0); data.hermes.push(entry.hermes||0); }
  _tokenStore = data;
  // Share with admin server via global
  global.__tokenStore = data;
  // Add to raw log with timestamp (for granular chart views)
  _tokenLog.push({ ts: Date.now(), neizhi: entry.neizhi||0, codex: entry.codex||0, hermes: entry.hermes||0 });
  // Cap _tokenLog to last 50000 entries to prevent memory leak
  if (_tokenLog.length > 50000) _tokenLog = _tokenLog.slice(-50000);
  // Persist to file
  saveTok();
}

function getTok() {
  var data = _tokenStore || getDefTok();
  data.total = Math.round((data.neizhi.reduce(function(a,b){return a+b;},0) + data.codex.reduce(function(a,b){return a+b;},0) + data.hermes.reduce(function(a,b){return a+b;},0)) * 100) / 100;
  return data;
}

/**
 * Extract token usage and record locally.
 */
function recordTokenUsage(data, providerName, clientId) {
  try {
    var usage = data.usage || data.usage_metadata || {};
    var total = usage.total_tokens || usage.total || 0;
    if (!total) { log.info("[token] skipping: no total_tokens in response"); return; }
    log.info("[token] recording " + total + " tokens — clientId=" + clientId + " provider=" + providerName);
    // Determine group solely by clientId (HERMESAPI/CODEXAPI/NEIZHIAPI)
    var group = "codex";
    if (clientId === "HERMES") {
      group = "hermes";
    } else if (clientId === "NEIZHI") {
      group = "neizhi";
    }
    var entry = { neizhi: 0, codex: 0, hermes: 0 };
    entry[group] = total;
    // Record locally (always works, no dependencies)
    pushToken(entry);
    // Also try via global (for SSE push to frontend)
    if (typeof global.__pushTokenUsage === 'function') {
      try { global.__pushTokenUsage(entry); } catch(e) {}
    }
    // ★ 同时按 provider 累计 token，用于管理后台的「模型使用排行」
    if (typeof global.__accumulateProviderToken === 'function') {
      try { global.__accumulateProviderToken(providerName, total); } catch(e) {
        log.warn("[token] global accumulate failed: " + e.message);
      }
    }
  } catch(e) { log.error("[token] record error:", e.message); }
}
