/**
 * OpenAI Chat Completions Protocol Handler
 *
 * Proxies requests to upstream providers using the OpenAI Chat Completions format.
 * Supports streaming (SSE) and non-streaming responses.
 *
 * Routes through HTTP_PROXY/HTTPS_PROXY env vars (Clash/V2Ray) if set.
 */

import { log } from "../logger.mjs";
import { UPSTREAM } from "../config.mjs";
import { proxyRequest } from "./proxy-helper.mjs";

// Get proxy config from env (set by system/Clash)
const HTTP_PROXY = process.env.HTTP_PROXY || process.env.http_proxy || "";
const HTTPS_PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const NO_PROXY = (process.env.NO_PROXY || process.env.no_proxy || "").toLowerCase();

/** Check if a host should bypass the proxy */
function shouldBypassProxy(hostname) {
  if (!HTTP_PROXY && !HTTPS_PROXY) return true;
  const parts = NO_PROXY.split(",").map(s => s.trim()).filter(Boolean);
  for (const p of parts) {
    if (p === hostname) return true;
    if (p.startsWith(".") && hostname.endsWith(p)) return true;
    if (p.endsWith(".*") && hostname.startsWith(p.slice(0, -2))) return true;
    if (p === "<local>") return true;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  }
  return false;
}

/** Parse proxy URL, returns { hostname, port } or null */
function getProxyForUrl(targetUrl) {
  const isHttps = targetUrl.protocol === "https:";
  const proxyUrl = isHttps ? HTTPS_PROXY : HTTP_PROXY;
  if (!proxyUrl || shouldBypassProxy(targetUrl.hostname)) return null;
  try {
    const p = new URL(proxyUrl);
    return { hostname: p.hostname, port: parseInt(p.port, 10) || (isHttps ? 443 : 80) };
  } catch { return null; }
}

/**
 * Make an HTTP/HTTPS request, optionally through a proxy.
 */
function makeRequest(url, options, bodyStr) {
  const opt = { method: options.method, headers: options.headers, timeout: options.timeout };
  if (bodyStr) opt.body = bodyStr;
  return proxyRequest(url, opt);
}

/**
 * Proxy a chat completions request to an upstream provider.
 */
export async function proxyFetch(base, key, ctx, req, body) {
  const timeout = ctx.timeout || UPSTREAM.upstreamTimeout;
  const isStreaming = body.stream === true;

  const upstreamUrl = `${base.replace(/\/+$/, "")}/chat/completions`;
  const upstreamHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
    Accept: isStreaming ? "text/event-stream" : "application/json",
  };

  const fwdHeaders = ["user-agent", "x-request-id", "x-stainless-arch"];
  for (const h of fwdHeaders) {
    const val = req.headers[h];
    if (val) upstreamHeaders[h] = val;
  }

  const upstreamBody = { ...body };
  // ★ 记住用户请求的模型名，返回给客户端时替换掉上游的 model 字段
  const requestedModel = body.model || ctx.clientId || "hermesAPI";
  if (ctx.modelId) {
    upstreamBody.model = ctx.modelId;
  }

  log.info(`[chat] >> ${upstreamUrl} model=${upstreamBody.model}`);
  log.info(`[chat] DEBUG raw body stream=${body.stream} model=${body.model} msgs=${body.messages?.length}`);

  try {
    const bodyStr = JSON.stringify(upstreamBody);
    log.info(`[chat] body len=${bodyStr.length}`);
    log.info(`[chat] body preview=${bodyStr.substring(0,300)}`);

    const upstreamRes = await makeRequest(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      timeout,
    }, bodyStr);

    log.info(`[chat] upstream connected, status=${upstreamRes.statusCode}`);

    // ★ 流式请求也要先检查上游状态码，>=400 时返回错误而非透传错误体给客户端
    const upstreamStatus = upstreamRes.statusCode || 502;
    if (upstreamStatus >= 400) {
      const chunks = [];
      for await (const chunk of upstreamRes) chunks.push(chunk);
      const errBody = Buffer.concat(chunks).toString();
      log.warn(`[chat] upstream error: status=${upstreamStatus}, body=${errBody.slice(0, 200)}`);
      let errData;
      try { errData = JSON.parse(errBody); } catch { errData = { error: { message: errBody.slice(0, 200) } }; }
      return { error: true, status: upstreamStatus, data: errData };
    }

    if (!isStreaming) {
      const chunks = [];
      for await (const chunk of upstreamRes) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks).toString());
      log.info(`[chat] upstream response complete, status=${upstreamRes.statusCode}`);
      if ((!upstreamRes.statusCode || upstreamRes.statusCode >= 400) || (data && data.error)) {
        return { error: true, status: upstreamRes.statusCode || 502, data };
      }
      // ★ 去掉 reasoning 字段（Cherry Studio 等客户端不认识这个非标字段）
      stripReasoning(data);
      // ★ 返回客户端请求的模型名，不暴露上游真实模型名
      if (data && data.model) data.model = requestedModel;
      log.info(`[chat] response model=${data?.model} choices=${data?.choices?.length} content_preview=${data?.choices?.[0]?.message?.content?.substring(0,50)}`);
      return { error: false, status: upstreamRes.statusCode, data };
    }

    // Streaming — 逐行解析 + 格式化，确保跨 provider 兼容
    // 替换 model 字段 + 移除 reasoning 字段，让 Cherry Studio 等客户端不受上游格式差异影响
    const resOut = ctx.res;
    resOut.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // 客户端断开连接时销毁上游请求，避免泄漏
    let clientGone = false;
    const onClose = () => { clientGone = true; try { upstreamRes.destroy(); } catch {} };
    resOut.on("close", onClose);

    const decoder = new TextDecoder();
    let lineBuffer = "";

    try {
      for await (const chunk of upstreamRes) {
        if (clientGone) break;

        // 将二进制块解码并按 \n 分行处理（兼容 \r\n 和 \n）
        lineBuffer += decoder.decode(chunk, { stream: true });
        const lines = lineBuffer.split("\n");
        // 最后一个可能是不完整的行，保留到下一个 chunk
        lineBuffer = lines.pop() || "";

        let output = "";
        for (const line of lines) {
          const trimmed = line.trimEnd();
          if (trimmed.startsWith("data:")) {
            const jsonStr = trimmed.slice(5).trim();
            if (jsonStr && jsonStr !== "[DONE]") {
              try {
                const parsed = JSON.parse(jsonStr);
                // 替换 model 字段为客户端请求的模型名
                if (requestedModel && parsed.model) {
                  parsed.model = requestedModel;
                }
                // 移除非标准的 reasoning 字段
                // 策略：如果 delta 有 reasoning 但没有 content → 转成 content 让客户端看到文字
                //        如果 delta 同时有 reasoning 和 content → 只保留 content（删除 reasoning）
                if (parsed.choices) {
                  for (const choice of parsed.choices) {
                    if (choice.delta) {
                      const hasReasoning = choice.delta.reasoning !== undefined;
                      const hasReasoningContent = choice.delta.reasoning_content !== undefined;
                      const hasContent = choice.delta.content !== undefined && choice.delta.content !== null;
                      const reasoning = choice.delta.reasoning || choice.delta.reasoning_content || "";
                      delete choice.delta.reasoning;
                      delete choice.delta.reasoning_content;
                      // 有 reasoning 但无 content → 把 reasoning 当 content 用
                      if ((hasReasoning || hasReasoningContent) && !hasContent) {
                        choice.delta.content = reasoning;
                      }
                    }
                  }
                }
                output += "data: " + JSON.stringify(parsed) + "\n\n";
                continue;
              } catch {
                // JSON 解析失败，安全降级：输出原始行
              }
            }
          }
          output += line + "\n";
        }

        if (output && resOut.write(output) === false) {
          await new Promise(resolve => resOut.once("drain", resolve));
        }
      }

      // 处理缓冲区剩余内容
      if (lineBuffer) {
        try { resOut.write(lineBuffer + "\n"); } catch {}
      }
    } finally {
      resOut.removeListener("close", onClose);
    }
    try { resOut.end(); } catch {}
    return { error: false, status: 200, data: { stream: true } };

  } catch (e) {
    log.warn(`[chat] upstream error: ${e.message}`);
    return { error: true, status: 502, data: { error: { message: e.message, type: "upstream_error" } } };
  }
}

/**
 * Detect quota/rate-limit errors that should trigger fallback.
 */
export function isQuotaError(response) {
  if (!response || !response.error) return false;
  const status = response.status || 0;
  const data = response.data || {};
  if (status === 402) return true;
  const body = typeof data === "object" ? JSON.stringify(data).toLowerCase() : String(data).toLowerCase();
  const quotaKeywords = ["quota exhausted", "quota insufficient", "insufficient_balance",
    "insufficient balance", "credit balance exhausted", "no credit"];
  return quotaKeywords.some(kw => body.includes(kw));
}

/**
 * Strip non-standard `reasoning` field from response, merging reasoning into content.
 * Some upstream providers (Shangtang) include reasoning/thinking text
 * that standard OpenAI clients (Cherry Studio) don't expect as a separate field.
 */
function stripReasoning(data) {
  if (!data || !data.choices) return;
  for (const ch of data.choices) {
    if (ch.message) {
      const reasoning = ch.message.reasoning || "";
      delete ch.message.reasoning;
      // 有 reasoning 但无 content → 把 reasoning 当 content 用
      if (reasoning && !ch.message.content) {
        ch.message.content = reasoning;
      }
    }
  }
}
