/**
 * LuoDaBridge v3 — Admin Service (standalone)
 *
 * Admin panel + Config API. No proxy forwarding.
 * Reads/writes the same config-proxy.json as the proxy service.
 *
 * Usage:
 *   node admin.mjs
 */

// ── Clear proxy env vars ──
process.env.HTTP_PROXY = '';
process.env.HTTPS_PROXY = '';
process.env.http_proxy = '';
process.env.https_proxy = '';
process.env.NO_PROXY = '*';
process.env.no_proxy = '*';

import { log } from "./lib/logger.mjs";
import { PORTS, PATHS } from "./lib/config.mjs";
import { registerBuiltins } from "./lib/provider-builtin.mjs";
import { registerCustom } from "./lib/provider-custom.mjs";
import { initFallback } from "./lib/fallback.mjs";
import { startConfigServer } from "./lib/config-api.mjs";
import { find } from "./lib/provider-registry.mjs";
import { loadBuiltinOverrides } from "./lib/config-api.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

console.log(`
╔══════════════════════════════════════════╗
║    LuoDaBridge v3 — Admin Panel          ║
║    Management Service                    ║
╚══════════════════════════════════════════╝
`);

// ── Register providers ──
const builtins = registerBuiltins();
const custom = registerCustom();
log.info(`[admin-boot] providers: ${builtins.length} built-in, ${custom.length} custom`);

// ── Apply builtin overrides ──
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
      log.info(`[admin-boot] applied builtin override for "${name}"`);
    }
  });
} catch(e) {
  log.warn(`[admin-boot] builtin overrides skipped: ${e.message}`);
}

// ── Initialize fallback (needed for config display) ──
initFallback();

// ── Start admin server ──
const ADMIN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "admin");
try {
  process.env.ADMIN_PORT = String(PORTS.admin);
  const adminMod = await import("./admin/server/index.js");
  const { default: startAdminServer } = adminMod;
  if (adminMod.pushTokenUsage) {
    global.__pushTokenUsage = adminMod.pushTokenUsage;
    log.info("[admin-boot] token tracking enabled");
  }
  const adminServer = startAdminServer();
} catch (e) {
  if (e.code === 'ERR_MODULE_NOT_FOUND') {
    log.warn(`[admin-boot] admin panel not available`);
  } else {
    log.warn(`[admin-boot] admin panel warning: ${e.message}`);
  }
}

// ── Start config API ──
const configServer = startConfigServer();
log.info(`[admin-boot] config-api on http://localhost:${PORTS.config}`);
log.info(`[admin-boot] admin panel on http://localhost:${PORTS.admin}`);

// ── Graceful shutdown ──
function shutdown(signal) {
  log.info(`[admin-boot] received ${signal}, shutting down...`);
  configServer.close(() => {
    log.info("[admin-boot] config server closed");
    process.exit(0);
  });
  setTimeout(() => { log.warn("[admin-boot] forced exit"); process.exit(1); }, 5000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => log.error("[admin-boot]", err.message));
process.on("unhandledRejection", (err) => log.error("[admin-boot]", err.message || err));
