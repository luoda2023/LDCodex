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

const PADDING = " ".repeat(8);

const BANNER = `
${PADDING}╔══════════════════════════════════════════════════════════╗
${PADDING}║                                                        ║
${PADDING}║            🛡️  LDCodex 代理服务器 v3  🛡️              ║
${PADDING}║         ═══════════════════════════════════            ║
${PADDING}║     LuoDaBridge — Proxy Gateway & API Converter        ║
${PADDING}║                                                        ║
${PADDING}║   📡 代理端口 :40005  |  🔧 管理端口 :40006            ║
${PADDING}║                                                        ║
${PADDING}╚══════════════════════════════════════════════════════════╝
`.trim();

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

// ── 启动完成：显示大字成功提示 ──
const _bootOk = `
${PADDING}╔══════════════════════════════════════════════════════════╗
${PADDING}║                                                          ║
${PADDING}║        ✅  LDCodex 代理服务器启动成功！ ✅                ║
${PADDING}║                                                          ║
${PADDING}║   📡 代理服务   →  http://127.0.0.1:${PORTS.proxy}        ║
${PADDING}║   🔧 管理界面   →  http://127.0.0.1:${PORTS.config}       ║
${PADDING}║   📊 信息页面   →  http://127.0.0.1:${PORTS.config}/proxy-info.html  ║
${PADDING}║                                                          ║
${PADDING}║   按 Ctrl+C 停止服务                                      ║
${PADDING}║                                                          ║
${PADDING}╚══════════════════════════════════════════════════════════╝
`;
console.log("\n" + _bootOk + "\n");

// ★ 3秒后检查服务器是否在运行，如果没启动成功给出指引
setTimeout(function() {
  var _proxyRunning = false;
  var _configRunning = false;
  // 标记检查是否已完成
  var _checksDone = 0;
  function _checkComplete() {
    _checksDone++;
    if (_checksDone >= 2) {
      // 两个端口都检查完毕，1秒后输出结果
      setTimeout(function() {
        if (!_proxyRunning || !_configRunning) {
          console.error(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║        ❌  代理服务器启动失败！                            ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝

可能的原因及解决方法：

1️⃣  端口被占用（EADDRINUSE）
    → 请关闭其他使用 40005/40006 端口的程序，然后重试。
    → 或在终端执行：fuser -k 40005/tcp 40006/tcp

2️⃣  缺少依赖（npm 包未安装）
    → 请在 bridge 目录下执行：npm install
    → 或执行：cd bridge && npm install

3️⃣  Node.js 版本过低
    → 需要 Node.js 18.0.0 或更高版本
    → 当前版本：${process.version}
    → 下载地址：https://nodejs.org/

4️⃣  系统代理/防火墙阻止
    → 请检查是否开启了系统代理（Clash/V2Ray），尝试关闭后重试。

5️⃣  SQLite 数据库错误
    → 删除 bridge/data/ 目录下的 admin.db 文件后重试
    → 或执行：rm -f bridge/data/admin.db*

如果问题持续，请在管理面板中查看日志获取详细信息。
`);
        }
      }, 1000);
    }
  }

  // 检查 proxy 端口 :40005
  try {
    var _checkProxy = net.createConnection(PORTS.proxy, "127.0.0.1");
    _checkProxy.on("connect", function() {
      _proxyRunning = true;
      _checkProxy.end();
      _checkComplete();
    });
    _checkProxy.on("error", function() { _checkComplete(); });
    _checkProxy.setTimeout(2000, function() { _checkProxy.destroy(); _checkComplete(); });
  } catch(e) { _checkComplete(); }

  // 检查 config 端口 :40006
  try {
    var _checkConfig = net.createConnection(PORTS.config, "127.0.0.1");
    _checkConfig.on("connect", function() {
      _configRunning = true;
      _checkConfig.end();
      _checkComplete();
    });
    _checkConfig.on("error", function() { _checkComplete(); });
    _checkConfig.setTimeout(2000, function() { _checkConfig.destroy(); _checkComplete(); });
  } catch(e) { _checkComplete(); }

  // 安全兜底：4秒后如果还没完成检查，强制输出检查结果
  setTimeout(function() {
    if (_checksDone < 2) {
      if (!_proxyRunning) console.error("[boot] ⚠️ 代理端口 :" + PORTS.proxy + " 未能及时响应，请检查启动日志。");
      if (!_configRunning) console.error("[boot] ⚠️ 管理端口 :" + PORTS.config + " 未能及时响应，请检查启动日志。");
    }
  }, 4000);
}, 3000);
