/**
 * LDCodex Bridge — 精简入口
 *
 * 单路代理：只转发 Codex CLI 请求到上游 API。
 * 单一端口 40005，无管理面板、无 SQLite、无 fallback 链。
 */

process.env.NO_PROXY = '127.0.0.1,localhost,::1';
process.env.no_proxy = '127.0.0.1,localhost,::1';

import { log } from "./lib/logger.mjs";
import { PORTS } from "./lib/config.mjs";
import { registerCustom } from "./lib/provider-custom.mjs";
import { startProxyServer } from "./lib/server.mjs";
import { execSync } from "node:child_process";
import net from "node:net";

const PADDING = " ".repeat(8);

const BANNER = `
${PADDING}╔══════════════════════════════════════════════════════════╗
${PADDING}║                                                        ║
${PADDING}║            🛡️  LDCodex 代理服务器  🛡️                  ║
${PADDING}║         ═══════════════════════════════════            ║
${PADDING}║        单路代理 — 只转发 codexAPI                      ║
${PADDING}║                                                        ║
${PADDING}║   📡 端口 :${PORTS.proxy}                                ║
${PADDING}║                                                        ║
${PADDING}╚══════════════════════════════════════════════════════════╝
`.trim();

console.log(BANNER);

// ── 清理旧端口（跨平台兼容） ──
function cleanupPorts() {
  const myPid = process.pid;
  const ports = [...new Set([PORTS.proxy, 40005])];
  const isWin = process.platform === "win32";
  for (const p of ports) {
    try {
      if (isWin) {
        // Windows: 用 netstat+taskkill
        const out = execSync(`netstat -ano | findstr ":${p} "`, { encoding: "utf8", timeout: 3000 });
        for (const line of out.split("\n")) {
          const m = line.match(/(\d+)\s*$/);
          if (m) {
            const pid = parseInt(m[1], 10);
            if (pid && pid !== myPid) {
              try { execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore", timeout: 2000 }); } catch(e) {}
            }
          }
        }
      } else {
        const result = execSync(`fuser ${p}/tcp 2>/dev/null`, { encoding: "utf8", timeout: 3000 });
        const pidStr = (result || "").trim();
        if (pidStr) {
          const pids = pidStr.split(/\s+/).map(s => parseInt(s, 10)).filter(n => !isNaN(n) && n !== myPid);
          if (pids.length > 0) {
            execSync(`kill -9 ${pids.join(" ")} 2>/dev/null`, { stdio: "ignore", timeout: 3000 });
          }
        }
      }
    } catch (e) { /* port not in use */ }
  }
  try { execSync(isWin ? "ping -n 2 127.0.0.1 >nul" : "sleep 1", { stdio: "ignore", timeout: 3000 }); } catch (e) {}
}

cleanupPorts();

// ── Register providers ──
log.info("[boot] registering providers...");
const custom = registerCustom();
log.info(`[boot] providers: ${custom.length} custom`);

// ── Start proxy server ──
log.info("[boot] starting server...");
const proxyServer = startProxyServer();

// ── Graceful shutdown ──
function shutdown(signal) {
  log.info(`[boot] received ${signal}, shutting down...`);
  proxyServer.close(() => {
    log.info("[boot] proxy server closed");
    process.exit(0);
  });
  setTimeout(() => {
    log.warn("[boot] forced exit after timeout");
    process.exit(1);
  }, 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  log.error("[boot] uncaught exception:", err.message);
});
process.on("unhandledRejection", (err) => {
  log.error("[boot] unhandled rejection:", err.message || err);
});

// ── 启动成功提示 ──
const _bootOk = `
${PADDING}╔══════════════════════════════════════════════════════════╗
${PADDING}║                                                          ║
${PADDING}║        ✅  LDCodex 代理服务器启动成功！ ✅                ║
${PADDING}║                                                          ║
${PADDING}║   📡 代理服务   →  http://127.0.0.1:${PORTS.proxy}        ║
${PADDING}║   📊 状态页面   →  http://127.0.0.1:${PORTS.proxy}/proxy-info.html  ║
${PADDING}║                                                          ║
${PADDING}║   按 Ctrl+C 停止服务                                      ║
${PADDING}║                                                          ║
${PADDING}╚══════════════════════════════════════════════════════════╝
`;
console.log("\n" + _bootOk + "\n");

// ── 3秒后检查端口 ──
setTimeout(function() {
  let _running = false;
  const sock = net.createConnection(PORTS.proxy, "127.0.0.1");
  sock.on("connect", function() {
    _running = true;
    sock.end();
  });
  sock.on("error", function() {
    if (!_running) {
      console.error(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║        ❌  代理服务器启动失败！                            ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝

可能的原因：
1️⃣  端口被占用 → fuser -k ${PORTS.proxy}/tcp
2️⃣  缺少依赖 → cd bridge && npm install
3️⃣  Node.js 版本过低 → 需要 Node.js 18+
`);
    }
  });
  sock.setTimeout(2000, function() { sock.destroy(); });
}, 3000);
