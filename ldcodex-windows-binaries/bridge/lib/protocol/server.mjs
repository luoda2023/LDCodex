/**
 * Proxy Server Module
 *
 * Main HTTP/1.1 server that handles all proxy requests.
 * Routes requests to the appropriate provider based on model name.
 */

import http from "node:http";
import { log } from "./logger.mjs";
import { PORTS, UPSTREAM, MODELS } from "./config.mjs";
import { authenticate, isOpenRoute } from "./auth.mjs";
import { acquireSlot, releaseSlot, recordLatencyMs, getMetrics } from "./concurrency.mjs";
import { find, findForModel, getAll } from "./provider-registry.mjs";
import { getCurrentProvider, advanceFallback, getFullStatus, updateSettings, clearSingleAndAdvance } from "./fallback.mjs";
import { getAllHealth } from "./health-check.mjs";
import { handleResponses } from "./protocol/openai-responses.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

// ── Model catalog (for /v1/models endpoint) ──
let modelCatalog = [];

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

      // Token raw log (for granular chart views)
      if (req.method === "GET" && pn === "/api/tokens/log") {
        sendJson(res, 200, { entries: _tokenLog.filter(function(e){ return e.ts >= Date.now() - 86400000; }) }); // 返回最近24小时内的记录，确保按天视图能显示全天数据
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
          if (modelLower === "hermesapi") fallbackClientId = "HERMES";
          provider = getCurrentProvider(fallbackClientId);
          // Override clientId for token tracking (3 virtual IDs separate)
          if (modelLower === "hermesapi") clientId = "HERMES";
          else if (modelLower === "neizhiapi") clientId = "NEIZHI";
          else if (modelLower === "codexapi") clientId = "CODEX";
        }

        // Step 2: Try model→provider lookup
        if (!provider && requestedModel) {
          provider = findForModel(requestedModel);
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

        try {
          let result;

          if (isResponsesAPI) {
            // Responses API → convert to Chat Completions internally
            result = await handleResponses(ctx, req, parsedBody);
          } else {
            // Chat Completions (or /v1/chat/completions)
            result = await provider.handler(ctx, req, parsedBody);
          }

          // Record latency
          recordLatencyMs(Date.now() - startTime);

          // Record token usage for dashboard — always try
          if (result) {
            try {
              var _d = result.data || result;
              var _u = _d.usage || _d.usage_metadata || {};
              var _t = _u.total_tokens || _u.total || 0;
              if (_t > 0) {
                // Determine group by VIRTUAL ID (not provider name)
                // clientId is set from model name or header in Step 1
                var _g = "codex";
                if (clientId === "NEIZHI") {
                  _g = "neizhi";
                } else if (clientId === "HERMES") {
                  _g = "hermes";
                }
                // else clientId === "CODEX" → _g remains "codex"
                var _en = { neizhi: 0, codex: 0, hermes: 0 };
                _en[_g] = _t;
                pushToken(_en);
                if (typeof global.__pushTokenUsage === 'function') {
                  try { global.__pushTokenUsage(_en); } catch(e) {}
                }
              }
            } catch(e) {}
          }

          // Send successful response to client
          if (result && !result.error && !res.headersSent) {
            var _data = result.data || {};
            // Strip <think> and <response> tags from upstream model output
            sanitizeResponse(_data);
            sendJson(res, result.status || 200, _data);
          }

          // Handle fallback on quota errors — never expose upstream errors to client
          if (result && result.error) {
            // Send sanitized error to client (no upstream details exposed)
            if (!res.headersSent) {
              // Only pass through safe fields, strip upstream internals
              var safeMsg = "service temporarily unavailable";
              var safeCode = "service_unavailable";
              if (result.data && result.data.error) {
                // Detect common error patterns for user-friendly messages
                var errStr = JSON.stringify(result.data.error).toLowerCase();
                if (errStr.indexOf("quota") >= 0 || errStr.indexOf("exhausted") >= 0) {
                  safeMsg = "provider quota exhausted";
                  safeCode = "quota_exhausted";
                } else if (errStr.indexOf("rate") >= 0) {
                  safeMsg = "rate limited";
                  safeCode = "rate_limited";
                } else if (errStr.indexOf("auth") >= 0 || errStr.indexOf("key") >= 0 || errStr.indexOf("unauthorized") >= 0) {
                  safeMsg = "provider auth error";
                  safeCode = "provider_auth_error";
                }
              }
              sendJson(res, result.status || 502, {
                error: { message: safeMsg, code: safeCode, type: "upstream_error" }
              });
            }

            const isQuota = result.status === 429 || result.status === 402 ||
              (result.data && result.data.error && (
                result.data.error.code === 'insufficient_balance' ||
                /(?:quota|credit).*(?:exhausted|insufficient)|insufficient.*balance/i.test(
                  JSON.stringify(result.data.error)
                )
              ));

            if (isQuota) {
              log.warn(`[proxy] "${provider.name}" quota exhausted`);

              // 额度不足时切换：先检查失败 provider 是否为当前单锁模型
              let shouldSwitch = true;
              if (clientId === "CODEX" || clientId === "NEIZHI") {
                const curP = getCurrentProvider("CODEX");
                if (curP && curP.name !== provider.name) shouldSwitch = false;
              }
              if (clientId === "HERMES") {
                const curP = getCurrentProvider("HERMES");
                if (curP && curP.name !== provider.name) shouldSwitch = false;
              }
              if (shouldSwitch) {
                const switched = clearSingleAndAdvance(clientId, true);
                if (switched) log.info(`[proxy] fallback advanced to "${switched.name}"`);
                else log.warn(`[proxy] no fallback provider available`);
              } else {
                const adv = advanceFallback(clientId, true);
                if (adv) log.info(`[proxy] chain advanced to "${adv.name}" (single_model untouched)`);
              }
            }
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
  const reTag = /<\/?think>|<\/?response>/gi;
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
  try {
    var dir = path.dirname(_tokPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(_tokPath, JSON.stringify(_tokenStore));
    var log = _tokenLog.slice(-5000);
    fs.writeFileSync(_tokLogPath, JSON.stringify(log));
  } catch(e) {}
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
  // Cap _tokenLog to last 2000 entries to prevent memory leak
  if (_tokenLog.length > 10000) _tokenLog = _tokenLog.slice(-10000);
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
function recordTokenUsage(data, providerName) {
  try {
    var usage = data.usage || {};
    var total = usage.total_tokens || 0;
    if (!total) { log.info("[token] skipping: no total_tokens in response"); return; }
    log.info("[token] recording " + total + " tokens from " + providerName);
    var lower = (providerName || "").toLowerCase();
    var group = "codex";
    if (lower.indexOf("mimo") >= 0 || lower.indexOf("neizhi") >= 0) group = "neizhi";
    else if (lower.indexOf("hermes") >= 0) group = "hermes";
    var entry = { neizhi: 0, codex: 0, hermes: 0 };
    entry[group] = total;
    // Record locally (always works, no dependencies)
    pushToken(entry);
    // Also try via global (for SSE push to frontend)
    if (typeof global.__pushTokenUsage === 'function') {
      try { global.__pushTokenUsage(entry); } catch(e) {}
    }
  } catch(e) {}
}
