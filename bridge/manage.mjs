/**
 * LuoDaBridge — 管理服务（独立进程）
 *
 * 只启动管理后台和配置 API，不启动代理转发。
 * 与 index.mjs（转发服务）完全独立运行，互不影响。
 *
 * 端口分配：
 *   index.mjs（转发服务）：proxy=40000, config=40001, admin=40002
 *   manage.mjs（管理服务）：config=37001, admin=37002
 *
 * 使用方式：
 *   node manage.mjs
 *   然后访问 http://127.0.0.1:37002
 */

// ── 设置独立端口，与转发服务不冲突 ──
process.env.CONFIG_PORT = "37001";
process.env.ADMIN_PORT = "37002";
process.env.PROXY_PORT = "40000"; // 实际代理端口

// ── 保留系统代理（Clash/V2Ray），仅绕过本地地址 ──
process.env.NO_PROXY = '127.0.0.1,localhost,::1';
process.env.no_proxy = '127.0.0.1,localhost,::1';

import { log } from "./lib/logger.mjs";
import { PORTS, PATHS } from "./lib/config.mjs";
import { registerBuiltins } from "./lib/provider-builtin.mjs";
import { registerCustom } from "./lib/provider-custom.mjs";
import { initFallback } from "./lib/fallback.mjs";
import { loadBuiltinOverrides } from "./lib/config-api.mjs";
import { find } from "./lib/provider-registry.mjs";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// ── 强制修正 PORTS（ES模块导入时已初始化，需要重新赋值）──
PORTS.config = 37001;
PORTS.admin = 37002;
PORTS.proxy = 37000;

console.log(`
╔══════════════════════════════════════════╗
║    LuoDaBridge v3 — 管理服务独立运行      ║
║    不受转发代理请求影响                    ║
║    访问: http://127.0.0.1:37002          ║
╚══════════════════════════════════════════╝
`);

// ── 注册 providers ──
const builtins = registerBuiltins();
const custom = registerCustom();
log.info(`[manage-boot] providers: ${builtins.length} built-in, ${custom.length} custom`);

// ── 应用内置覆盖 ──
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
      log.info(`[manage-boot] applied builtin override for "${name}"`);
    }
  });
} catch(e) {
  log.warn(`[manage-boot] builtin overrides skipped: ${e.message}`);
}

// ── 初始化 fallback ──
initFallback();

// ── 启动 admin server ──
const ADMIN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "admin");
try {
  process.env.ADMIN_PORT = String(PORTS.admin);
  const adminMod = await import("./admin/server/index.js");
  const { default: startAdminServer } = adminMod;
  if (adminMod.pushTokenUsage) {
    global.__pushTokenUsage = adminMod.pushTokenUsage;
    log.info("[manage-boot] token tracking enabled");
  }
  const adminServer = startAdminServer();
} catch (e) {
  if (e.code === 'ERR_MODULE_NOT_FOUND') {
    log.warn(`[manage-boot] admin panel not available`);
  } else {
    log.warn(`[manage-boot] admin panel warning: ${e.message}`);
  }
}

// ── 启动 config API ──
try {
  const { startConfigServer } = await import("./lib/config-api.mjs");
  const configServer = startConfigServer();
  log.info(`[manage-boot] config-api on http://localhost:${PORTS.config}`);
  log.info(`[manage-boot] admin panel on http://localhost:${PORTS.admin}`);
} catch(e) {
  log.error(`[manage-boot] config-api failed: ${e.message}`);
}

// ── 优雅关闭 ──
function shutdown(signal) {
  log.info(`[manage-boot] received ${signal}, shutting down...`);
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => log.error("[manage-boot]", err.message));
process.on("unhandledRejection", (err) => log.error("[manage-boot]", err.message || err));
