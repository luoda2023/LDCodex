/**
 * Proxy Server Module — 精简版（只代理 codexAPI）
 *
 * 单一 HTTP 服务器，提供：
 *   - Chat Completions / Responses API 代理转发
 *   - /v1/models 模型列表（只暴露 codexAPI）
 *   - /api/proxy-info 状态查询
 *   - /proxy-info.html 监控页面
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.mjs";
import { PORTS, UPSTREAM, CONFIG_PROXY, PATHS } from "./config.mjs";
import { authenticate, isOpenRoute } from "./auth.mjs";
import { findForModel, getAll } from "./provider-registry.mjs";
import { getProvider, getFullStatus } from "./provider.mjs";
import { handleResponses } from "./protocol/openai-responses.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── HTML 监控页面缓存 ──
let _proxyInfoHtml = null;
let _proxyInfoHtmlMtime = 0;

function loadProxyInfoHtml() {
  const paths = [
    path.join(PATHS.root, "proxy-info.html"),
    path.join(PATHS.data, "proxy-info.html"),
    path.join(__dirname, "..", "proxy-info.html"),
  ];
  for (const p of paths) {
    try {
      const st = fs.statSync(p);
      if (st.mtimeMs > _proxyInfoHtmlMtime) {
        _proxyInfoHtml = fs.readFileSync(p, "utf-8");
        _proxyInfoHtmlMtime = st.mtimeMs;
      }
      return _proxyInfoHtml;
    } catch (e) { /* try next */ }
  }
  return null;
}

/**
 * 启动代理服务器
 */
export function startProxyServer() {
  const port = PORTS.proxy;

  const server = http.createServer(async (req, res) => {
    // ── CORS ──
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    log.access(`[access] ${req.method} ${req.url}`);

    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const pn = url.pathname;

      // ── Health check ──
      if (req.method === "GET" && pn === "/health") {
        sendJson(res, 200, {
          status: "ok",
          port,
          uptime: process.uptime(),
          providers: getAll().length,
        });
        return;
      }

      // ── Model list ──
      if (req.method === "GET" && (pn === "/v1/models" || pn === "/models")) {
        const provider = getProvider();
        const now = Math.floor(Date.now() / 1000);
        const models = [
          { id: "codexAPI", object: "model", created: now, owned_by: "luoda" },
        ];
        // 如果 provider 有具体模型名，也暴露
        if (provider && provider.modelId && provider.modelId !== "codexAPI") {
          models.push({
            id: provider.modelId,
            object: "model",
            created: now,
            owned_by: provider.name,
          });
        }
        sendJson(res, 200, { object: "list", data: models });
        return;
      }

      // ── Proxy status ──
      if (req.method === "GET" && pn === "/api/proxy-info") {
        const status = getFullStatus();
        sendJson(res, 200, status);
        return;
      }

      // ── Proxy info HTML page ──
      if (req.method === "GET" && (pn === "/proxy-info.html" || pn === "/proxy-info" || pn === "/")) {
        const html = loadProxyInfoHtml();
        if (html) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
        } else {
          sendJson(res, 404, { error: "proxy-info.html not found" });
        }
        return;
      }

      // ── Auth gate ──
      const auth = authenticate(req);
      if (!auth.authorized) {
        sendJson(res, auth.status, auth.body);
        return;
      }

      // ── Only POST beyond this point ──
      if (req.method !== "POST") {
        sendJson(res, 405, { error: { message: "Method not allowed" } });
        return;
      }

      // ── Parse body ──
      let body = "";
      let bodySize = 0;
      const MAX_BODY = 50 * 1024 * 1024;
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

      await new Promise((resolve) => req.on("end", resolve));

      if (bodyTooLarge) {
        if (!res.headersSent) {
          sendJson(res, 413, { error: { message: "Request body too large (max 50MB)" } });
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

      // ── Provider resolution ──
      const requestedModel = parsedBody.model || "";
      let provider = null;

      // 1. 虚拟模型 codexAPI → 使用默认 provider
      if (requestedModel.toLowerCase() === "codexapi" || !requestedModel) {
        provider = getProvider();
      }

      // 2. model→provider 查找
      if (!provider && requestedModel) {
        provider = findForModel(requestedModel);
      }

      // 3. 默认 provider
      if (!provider) {
        provider = getProvider();
      }

      if (!provider) {
        sendJson(res, 400, {
          error: { message: `No provider available for model "${requestedModel}"` }
        });
        return;
      }

      // ── Route request ──
      const isResponsesAPI = pn === "/v1/responses" || pn === "/responses";

      const ctx = {
        req,
        res,
        provider,
        model: provider.modelId,
        modelId: provider.modelId,
        timeout: UPSTREAM.upstreamTimeout,
      };

      try {
        let result;

        if (isResponsesAPI) {
          result = await handleResponses(ctx, req, parsedBody);
        } else {
          result = await provider.handler(ctx, req, parsedBody);
        }

        if (result && !result.error && !res.headersSent) {
          const _data = result.data || {};
          sendJson(res, result.status || 200, _data);
        } else if (result && !res.headersSent) {
          const _rs = typeof result.status === 'number' ? result.status : 502;
          const _errObj = (result.data && result.data.error) || result.error || null;
          sendJson(res, _rs, { error: _errObj || { message: "service temporarily unavailable" } });
        }
      } catch (e) {
        log.warn(`[proxy] request error: ${e.message}`);
        if (!res.headersSent) {
          sendJson(res, 502, {
            error: { message: "service temporarily unavailable", code: "upstream_error" }
          });
        }
      }

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
