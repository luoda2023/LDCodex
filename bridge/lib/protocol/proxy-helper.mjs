/**
 * Proxy Helper — Makes HTTP/HTTPS requests through system proxy (Clash/V2Ray) if configured.
 * 
 * Respects HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars.
 * Uses https-proxy-agent for reliable proxy tunneling.
 * 
 * ★ Keep-Alive: Uses connection pools (http.Agent / https.Agent with keepAlive=true)
 *   to reuse TCP connections across requests, eliminating TCP+TLS handshake overhead
 *   for repeated requests to the same upstream host.
 */

import { HttpsProxyAgent } from "https-proxy-agent";
import https from "node:https";
import http from "node:http";

const HTTP_PROXY = process.env.HTTP_PROXY || process.env.http_proxy || "";
const HTTPS_PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const NO_PROXY_LIST = (process.env.NO_PROXY || process.env.no_proxy || "").toLowerCase()
  .split(",").map(s => s.trim()).filter(Boolean);

// ★ Keep-Alive connection pools — one per protocol, shared across all upstream requests
//    maxSockets: 6 (匹配 DYN_LIMIT_MAX=6，避免堆积空闲连接)
//    keepAlive: true + 10s idle timeout → reuse connections for subsequent requests
const HTTP_AGENT = new http.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 6, scheduling: "lifo" });
const HTTPS_AGENT = new https.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 6, scheduling: "lifo" });

// ★ Cached proxy agents — reuse TCP+TLS connections instead of creating new agent per request
//    Creating HttpsProxyAgent per request prevents keep-alive connection reuse,
//    adding ~30-100ms (TCP+TLS handshake) on every proxied request.
let _cachedProxyAgent = null;
let _cachedProxyUrl = "";

function getProxyAgent(proxyUrl) {
  if (!proxyUrl) return null;
  if (proxyUrl === _cachedProxyUrl && _cachedProxyAgent) return _cachedProxyAgent;
  _cachedProxyAgent = new HttpsProxyAgent(proxyUrl);
  _cachedProxyUrl = proxyUrl;
  return _cachedProxyAgent;
}

function shouldBypass(hostname) {
  hostname = hostname.toLowerCase();
  for (const p of NO_PROXY_LIST) {
    if (p === hostname) return true;
    if (p.startsWith(".") && hostname.endsWith(p)) return true;
    if (p.endsWith(".*") && hostname.startsWith(p.slice(0, -2))) return true;
  }
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/**
 * Make an HTTP/HTTPS request through system proxy if configured.
 * Returns a response stream (same as http/https.request callback).
 * 
 * ★ Now uses Keep-Alive connection pool — reuses TCP connections to upstream,
 *    eliminating TCP handshake (~30ms) and TLS handshake (~100ms) on repeat requests.
 * 
 * @param {string} url - Full URL to request
 * @param {object} options - { method, headers, timeout, body }
 * @returns {Promise<http.IncomingMessage>}
 */
export function proxyRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL(url);
    const isHttps = targetUrl.protocol === "https:";
    const proxyUrl = isHttps ? HTTPS_PROXY : HTTP_PROXY;
    const timeout = options.timeout || 120000;

    let agent = null;
    if (proxyUrl && !shouldBypass(targetUrl.hostname)) {
      // Through Clash/V2Ray — reuse cached proxy agent for TCP+TLS connection reuse
      agent = getProxyAgent(proxyUrl);
    } else {
      // Direct connection — use Keep-Alive pool
      agent = isHttps ? HTTPS_AGENT : HTTP_AGENT;
    }

    const mod = isHttps ? https : http;
    const req = mod.request(url, {
      method: options.method || "POST",
      headers: {
        ...options.headers,
        // ★ Explicitly ask for Keep-Alive (some providers need this hint)
        Connection: "keep-alive",
      },
      agent,
      timeout,
      // ★ Higher highWaterMark reduces read() syscalls on fast streams
      highWaterMark: 65536, // 64KB chunks instead of default 16KB
    }, (res) => {
      resolve(res);
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    if (options.body) req.write(options.body);
    req.end();
  });
}
