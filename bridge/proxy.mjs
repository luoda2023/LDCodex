/**
 * LuoDaBridge v3 — Proxy Service (standalone)
 *
 * Pure proxy forwarding. Starts proxy server + fallback only.
 * No admin panel, no config API.
 *
 * Usage:
 *   node proxy.mjs
 */

// ── Clear proxy env vars ──
process.env.HTTP_PROXY = '';
process.env.HTTPS_PROXY = '';
process.env.http_proxy = '';
process.env.https_proxy = '';
process.env.NO_PROXY = '*';
process.env.no_proxy = '*';

import { log } from "./lib/logger.mjs";
import { PORTS } from "./lib/config.mjs";
import { registerBuiltins } from "./lib/provider-builtin.mjs";
import { registerCustom } from "./lib/provider-custom.mjs";
import { initHealthCheck } from "./lib/health-check.mjs";
import { initFallback } from "./lib/fallback.mjs";
import { startProxyServer, rebuildModelCatalog } from "./lib/server.mjs";
import { loadBuiltinOverrides } from "./lib/config-api.mjs";
import { find } from "./lib/provider-registry.mjs";

console.log(`
╔══════════════════════════════════════════╗
║    LuoDaBridge v3 — Proxy Gateway        ║
║    Proxy Service                         ║
╚══════════════════════════════════════════╝
`);

// ── Register providers ──
const builtins = registerBuiltins();
const custom = registerCustom();
log.info(`[proxy-boot] providers: ${builtins.length} built-in, ${custom.length} custom`);

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
      log.info(`[proxy-boot] applied builtin override for "${name}"`);
    }
  });
} catch(e) {
  log.warn(`[proxy-boot] builtin overrides skipped: ${e.message}`);
}

// ── Initialize ──
initFallback();
initHealthCheck((abnormal) => {
  if (abnormal.length > 0) {
    log.warn(`[proxy-boot] abnormal providers: ${abnormal.join(", ")}`);
  }
});
rebuildModelCatalog();

// ── Start proxy only ──
const proxyServer = startProxyServer();
log.info(`[proxy-boot] proxy running on http://localhost:${PORTS.proxy}`);

// ── Graceful shutdown ──
function shutdown(signal) {
  log.info(`[proxy-boot] received ${signal}, shutting down...`);
  proxyServer.close(() => {
    log.info("[proxy-boot] proxy server closed");
    process.exit(0);
  });
  setTimeout(() => { log.warn("[proxy-boot] forced exit"); process.exit(1); }, 5000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => log.error("[proxy-boot]", err.message));
process.on("unhandledRejection", (err) => log.error("[proxy-boot]", err.message || err));
