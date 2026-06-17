/**
 * LuoDaBridge v3 — Entry Point
 *
 * Starts all services:
 *   Main proxy server (port 37000)
 *   Config API server (port 37001)
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

const BANNER = `
╔══════════════════════════════════════════╗
║        LuoDaBridge v3 — Proxy Gateway    ║
║        Development Mode                  ║
╚══════════════════════════════════════════╝
`;

console.log(BANNER);

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

// ── Initialize modules ──
log.info("[boot] initializing fallback...");
initFallback();

log.info("[boot] initializing health checks...");
initHealthCheck((abnormal) => {
  if (abnormal.length > 0) {
    log.warn(`[boot] abnormal providers: ${abnormal.join(", ")}`);
  }
});

rebuildModelCatalog();

// ── Load admin module FIRST (for token tracking) ──
let adminServer = null;
const ADMIN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "admin");
try {
  process.env.ADMIN_PORT = String(PORTS.admin);
  const adminMod = await import("./admin/server/index.js");
  const { default: startAdminServer } = adminMod;
  if (adminMod.pushTokenUsage) {
    global.__pushTokenUsage = adminMod.pushTokenUsage;
    log.info("[boot] token tracking enabled");
  }
  adminServer = startAdminServer();
} catch (e) {
  if (e.code === 'ERR_MODULE_NOT_FOUND') {
    log.warn(`[boot] admin panel not available (${e.message})`);
  } else {
    log.warn(`[boot] admin panel warning: ${e.message}`);
  }
}

// ── Initialize SQLite config store ──
import("./lib/config-store.mjs").then(function(store) {
  store.initDB();
  log.info("[boot] SQLite config store ready");
}).catch(function(e) {
  log.warn("[boot] SQLite init: " + e.message);
});

// ── Start servers ──
log.info("[boot] starting servers...");

const proxyServer = startProxyServer();
const configServer = startConfigServer();

// ── Graceful shutdown ──
function shutdown(signal) {
  log.info(`[boot] received ${signal}, shutting down...`);

  if (adminServer) {
    adminServer.close();
    adminServer = null;
  }

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
log.info(`[boot] admin panel served separately on :${PORTS.admin}`);
