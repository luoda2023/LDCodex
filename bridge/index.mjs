/**
 * LuoDaBridge v3 — Entry Point
 *
 * Starts all services:
 *   Main proxy server (port 40005)
 *   Config API server (port 40006)
 *
 * Usage:
 *   node index.mjs
 *   node index.mjs --env-file .env
 */

// ── Clear proxy env vars to avoid interfering with upstream API calls ──
// Set BEFORE any imports to ensure undici/native fetch doesn't capture proxy settings.
// On Windows, the system proxy (Clash/V2Ray) sets HTTP_PROXY which breaks upstream calls
// to local services. We keep HTTP_PROXY/HTTPS_PROXY (for external API access like Google)
// but tell Node.js to bypass proxy for localhost addresses.
process.env.NO_PROXY = '127.0.0.1,localhost,::1';
process.env.no_proxy = '127.0.0.1,localhost,::1';
// DO NOT clear HTTP_PROXY/HTTPS_PROXY — the system proxy (Clash/V2Ray) is needed
// to access external APIs like Google Gemini from China

import { log } from "./lib/logger.mjs";
import { PORTS, PATHS } from "./lib/config.mjs";
import { registerBuiltins } from "./lib/provider-builtin.mjs";
import { registerCustom } from "./lib/provider-custom.mjs";
import { initHealthCheck } from "./lib/health-check.mjs";
import { initFallback } from "./lib/fallback.mjs";
import { startProxyServer, rebuildModelCatalog } from "./lib/server.mjs";
import { startConfigServer } from "./lib/config-api.mjs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { execSync } from "node:child_process";

/**
 * ★ 启动前检查目标端口并在被占用时自动清理，彻底杜绝 EADDRINUSE
 *   使用 fuser -k（Linux）逐端口清理。
 *   只杀其他进程，不杀自己（避免新进程启动后 fuser -k 自杀）。
 */
function cleanupPorts() {
  const myPid = process.pid;
  const ports = [...new Set([PORTS.proxy, PORTS.config, 40005, 40006])];
  for (const p of ports) {
    try {
      // 先查谁是端口主人，跳过自己
      const result = execSync(`fuser ${p}/tcp 2>/dev/null`, { encoding: "utf8", timeout: 3000 });
      const pidStr = (result || "").trim();
      if (pidStr) {
        const pids = pidStr.split(/\s+/).map(s => parseInt(s, 10)).filter(n => !isNaN(n) && n !== myPid);
        if (pids.length > 0) {
          execSync(`kill -9 ${pids.join(" ")} 2>/dev/null`, { stdio: "ignore", timeout: 3000 });
        }
      }
    } catch (e) {
      // fuser 退出码 1 = 端口未被占用，正常；其他错误静默
    }
  }
  try { execSync("sleep 1", { stdio: "ignore", timeout: 2000 }); } catch (e) {}
}

const BANNER = `
╔══════════════════════════════════════════╗
║        LuoDaBridge v3 — Proxy Gateway    ║
║        Development Mode                  ║
╚══════════════════════════════════════════╝
`;

console.log(BANNER);

// ★ 启动前清理旧进程占用的端口，防止 EADDRINUSE
cleanupPorts();

// ── Register providers ──
log.info("[boot] registering providers...");
const builtins = registerBuiltins();
const custom = registerCustom();
log.info(`[boot] providers: ${builtins.length} built-in, ${custom.length} custom`);

// ── Apply builtin overrides (key/base changes from admin panel) ──
import { loadBuiltinOverrides } from "./lib/config-api.mjs";
import { find } from "./lib/provider-registry.mjs";
try {
  const overrides = loadBuiltinOverrides();
  Object.keys(overrides).forEach(function(name) {
    const provider = find(name);
    if (provider) {
      const ov = overrides[name];
      if (ov.key) provider.key = ov.key;
      if (ov.base) provider.base = ov.base;
      if (ov.disabled !== undefined) provider.disabled = ov.disabled;
      if (ov.models) provider.models = ov.models;
      log.info(`[boot] applied builtin override for "${name}"`);
    }
  });
} catch(e) {
  log.warn(`[boot] builtin overrides load skipped: ${e.message}`);
}

// ── Initialize modules (fallback AFTER SQLite config is loaded) ──
log.info("[boot] initializing fallback...");

log.info("[boot] initializing health checks...");
initHealthCheck((abnormal) => {
  if (abnormal.length > 0) {
    log.warn(`[boot] abnormal providers: ${abnormal.join(", ")}`);
  }
});

rebuildModelCatalog();

// ── Initialize SQLite config store ──
// ── Initialize SQLite config store — 必须先于 startProxyServer，确保全局函数就绪
var _storePromise = import("./lib/config-store.mjs").then(function(store) {
  store.initDB();
  // 注册 provider token 累计函数（供 server.mjs 全局调用）
  if (typeof store.accumulateProviderToken === 'function') {
    global.__accumulateProviderToken = store.accumulateProviderToken;
    log.info("[boot] __accumulateProviderToken registered");
  }
  // ★ SQLite 数据已合并到 CONFIG_PROXY（config.mjs 中的 _initPromise.then）
  // ★ SQLite 数据已合并到 CONFIG_PROXY（config.mjs 中的 _initPromise.then）
  //   此时调用 initFallback 确保读取到正确的 single_model_codex 等配置
  initFallback();
  log.info("[boot] SQLite config store ready");
}).catch(function(e) {
  log.warn("[boot] SQLite init: " + e.message);
  // SQLite 失败时降级：用文件配置初始化 fallback
  initFallback();
});

// ── Start servers — wait for SQLite config store to be ready first
log.info("[boot] starting servers...");

// await 确保 __accumulateProviderToken 全局函数在 proxy 启动前已就位
await _storePromise;

const proxyServer = startProxyServer();
const configServer = startConfigServer();

// ── Graceful shutdown ──
function shutdown(signal) {
  log.info(`[boot] received ${signal}, shutting down...`);

  proxyServer.close(() => {
    log.info("[boot] proxy server closed");
    configServer.close(() => {
      log.info("[boot] config server closed");
      process.exit(0);
    });
  });

  // Force exit after 5s
  setTimeout(() => {
    log.warn("[boot] forced exit after timeout");
    process.exit(1);
  }, 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  log.error("[boot] uncaught exception:", err.message);
  log.debug(err.stack);
});

process.on("unhandledRejection", (err) => {
  log.error("[boot] unhandled rejection:", err.message || err);
});

log.info(`[boot] ready — proxy on :${PORTS.proxy}, config-api on :${PORTS.config}`);
