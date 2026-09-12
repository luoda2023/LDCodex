// WorkBuddy 增强（源自 WorkDaddy）内置化 codemod。
//
// 作用：把 apps/codex-plus-manager/src-tauri/workbuddy-runtime/ 里从上游 WorkDaddy
// 原样复制进来的运行时，改造成 LDCodex 自有组件：
//   1. 删除作者痕迹（GitHub 仓库 / Issues / Star / 旧品牌 HelloBuddy）
//   2. 删除对外后台上报（Sentry DSN、GitHub Releases 在线更新源与其定时器）
//   3. 品牌统一为 LDCodex，数据目录改名避免与上游冲突
//   4. 去掉注入到 WorkBuddy 的面板入口（FAB），保留全部功能逻辑
//
// 设计原则：每一步都带断言。任何一处原文不匹配就抛错退出，绝不静默改坏代码。
//
// 用法：node tools/workbuddy-port-codemod.mjs

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RUNTIME = path.join(ROOT, "apps", "codex-plus-manager", "src-tauri", "workbuddy-runtime");

let failures = 0;
const log = (msg) => process.stdout.write(msg + "\n");

function fail(msg) {
  failures += 1;
  log("  ✗ " + msg);
}

/** 精确字符串替换，断言命中次数。 */
function replaceOnce(file, find, after, label, expected = 1) {
  const abs = path.join(RUNTIME, file);
  const src = readFileSync(abs, "utf8");
  const count = src.split(find).length - 1;
  if (count !== expected) {
    fail(`${label}: 期望命中 ${expected} 次，实际 ${count} 次 (${file})`);
    return;
  }
  writeFileSync(abs, src.split(find).join(after), "utf8");
  log(`  ✓ ${label}`);
}

/**
 * 按行区间删除：从包含 startNeedle 的行开始，到其后第一个 trim() === endNeedle 的行结束（含两端）。
 * 比长串精确匹配更抗缩进/换行差异。
 */
function removeLineRange(file, startNeedle, endNeedle, label) {
  const abs = path.join(RUNTIME, file);
  const lines = readFileSync(abs, "utf8").split("\n");
  const start = lines.findIndex((l) => l.includes(startNeedle));
  if (start < 0) {
    fail(`${label}: 未找到起始行 "${startNeedle}" (${file})`);
    return;
  }
  let end = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === endNeedle) {
      end = i;
      break;
    }
  }
  if (end < 0) {
    fail(`${label}: 未找到结束行 "${endNeedle}" (${file})`);
    return;
  }
  lines.splice(start, end - start + 1);
  writeFileSync(abs, lines.join("\n"), "utf8");
  log(`  ✓ ${label}（删除 ${end - start + 1} 行）`);
}

// 参与品牌改写的运行时源码类型。
// 必须包含 .ps1：windows-process-boundary.ps1 与 windows-process-boundary.js 之间存在
// 按名字调用的契约（PS 函数名）和 HTTP 鉴权头（X-*-Token），只改一侧会直接跑不通。
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (name.endsWith(".js") || name.endsWith(".ps1")) out.push(abs);
  }
  return out;
}

const BRANDING_ONLY = process.argv.includes("--branding-only");

if (!BRANDING_ONLY) {
log("== 1. 移除作者仓库入口（inject.js 面板头部 / 关于页）==");
// 面板标题栏的 GitHub 按钮
removeLineRange("inject.js", '<a class="wbs-ghbtn"', "'</a>',", "移除面板头部 GitHub 按钮");
// 关于页的 Star / 问题反馈区块
removeLineRange("inject.js", '<div class="wbs-about-support">', "'</div>' +", "移除关于页作者支持区块");

log("== 2. 关闭 Workspace 面板入口（保留全部功能逻辑）==");
replaceOnce(
  "inject.js",
  "'<div class=\"wbs-fab\" title=\"' + WBS_BRAND + '\">',",
  "'<div class=\"wbs-fab\" style=\"display:none\" title=\"' + WBS_BRAND + '\">',",
  "隐藏右下角悬浮机器人按钮（面板因此不可打开）",
);

log("== 3. 移除在线更新链路（GitHub Releases 后台轮询）==");
replaceOnce(
  "daemon.js",
  "const UPDATE_REPO = process.env.WBSWITCH_UPDATE_REPO || 'babygoton/WorkDaddy';\nconst UPDATE_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;",
  "// LDCodex：已移除 WorkDaddy 的 GitHub Releases 在线更新链路。\nconst UPDATE_REPO = '';\nconst UPDATE_API = '';",
  "清空更新源常量",
);
replaceOnce(
  "daemon.js",
  "function checkUpdate(force) {\n  if (!force && updateTimer) {",
  [
    "function checkUpdate(force) {",
    "  // LDCodex：更新源已移除，固定返回「无更新」，不发起任何网络请求。",
    "  if (!UPDATE_API) {",
    "    updateState.status = 'idle';",
    "    updateState.hasUpdate = false;",
    "    updateState.latest = null;",
    "    updateState.message = '本版本由 LDCodex 管理，不提供在线更新。';",
    "    updateState.checkedAt = Date.now();",
    "    return Promise.resolve(updateState);",
    "  }",
    "  if (!force && updateTimer) {",
  ].join("\n"),
  "checkUpdate 短路（不再请求外部）",
);
replaceOnce(
  "daemon.js",
  [
    "// 自动更新：启动时检查一次（延迟 8s 等网络就绪），之后每 6 小时一次",
    "setTimeout(() => { checkUpdate(true).catch(() => {}); }, 8000);",
    "updateTimer = setInterval(() => { checkUpdate(false).catch(() => {}); }, UPDATE_CHECK_INTERVAL);",
    "updateTimer.unref && updateTimer.unref();",
  ].join("\n"),
  "// LDCodex：已移除在线更新定时器，避免任何后台外部请求。",
  "移除更新检查定时器",
);

log("== 4. 停用在线更新 / 关于 / 遥测 三个接口 ==");
replaceOnce(
  "daemon.js",
  [
    "  '/api/status',",
    "  '/api/about',",
    "  '/api/about/',",
    "  '/api/update-check',",
    "  '/api/update-status',",
  ].join("\n"),
  "  '/api/status',",
  "从公开白名单移除 about/update 接口",
);
for (const [guard, label] of [
  ["if (req.method === 'GET' && (p === '/api/about' || p === '/api/about/')) {", "停用 GET /api/about"],
  ["if (req.method === 'GET' && p === '/api/update-check') {", "停用 GET /api/update-check"],
  ["if (req.method === 'GET' && p === '/api/update-status') {", "停用 GET /api/update-status"],
  ["if (req.method === 'POST' && p === '/api/update-download') {", "停用 POST /api/update-download"],
  ["if (req.method === 'POST' && p === '/api/update-apply') {", "停用 POST /api/update-apply"],
  ["if (req.method === 'GET' && p === '/api/telemetry-settings') {", "停用 GET /api/telemetry-settings"],
  ["if (req.method === 'POST' && p === '/api/telemetry-settings') {", "停用 POST /api/telemetry-settings"],
]) {
  replaceOnce("daemon.js", guard, "if (false) { // LDCodex: 接口已下线", label);
}
} // end if (!BRANDING_ONLY)

log("== 5. 品牌与数据目录改写（全量 .js / .ps1）==");
const BRANDING = [
  // 数据目录：改到 LDCodex 专用子目录，避免与上游 WorkDaddy 数据混淆
  [
    /path\.join\(appSupport, 'WorkDaddy'\)/g,
    "path.join(appSupport, 'LDCodex-WorkBuddy')",
  ],
  [
    /path\.join\(os\.homedir\(\), 'Library', 'Application Support', 'WorkDaddy'\)/g,
    "path.join(os.homedir(), 'Library', 'Application Support', 'LDCodex-WorkBuddy')",
  ],
  // 作者仓库 URL（先于品牌替换处理）
  [/https:\/\/github\.com\/babygoton\/WorkDaddy\/issues/g, ""],
  [/https:\/\/github\.com\/babygoton\/WorkDaddy/g, ""],
  [/babygoton\/WorkDaddy/g, ""],
  // 遗留品牌
  [/HelloBuddy/g, "LDLegacy"],
  // 品牌
  [/WorkDaddy AI/g, "LDCodex"],
  [/WorkDaddy/g, "LDCodex"],
  [/workdaddy/g, "ldcodex"],
  [/WORKDADDY/g, "LDCODEX"],
];
for (const abs of walk(RUNTIME)) {
  const before = readFileSync(abs, "utf8");
  let after = before;
  for (const [re, to] of BRANDING) after = after.replace(re, to);
  if (after !== before) {
    writeFileSync(abs, after, "utf8");
    log(`  ✓ 品牌改写 ${path.relative(RUNTIME, abs).replace(/\\/g, "/")}`);
  }
}

if (!BRANDING_ONLY) {
log("== 6. 写入遥测 no-op 桩（顶掉 sentry-report.js）==");
writeFileSync(
  path.join(RUNTIME, "sentry-report.js"),
  `// LDCodex：本模块替换上游 WorkDaddy 的 Sentry 上报实现。
//
// 上游会在未告知用户的情况下把脱敏诊断数据 POST 到硬编码的 Sentry 端点。
// LDCodex 不再保留任何外部上报能力，这里提供完整同名导出，但全部为本地 no-op：
// 不联网、不落盘、不读取任何凭证。所有调用点无需改动即可安全生效。
'use strict';

/** 始终返回 false：LDCodex 不启用任何诊断上报。 */
function telemetryEnabled() {
  return false;
}

/** 始终返回 null：不再支持用环境变量覆盖（上游为 LDCODEX_TELEMETRY）。 */
function telemetryEnvironmentOverride() {
  return null;
}

/** 接口兼容：请求开启诊断时不生效，返回 false 表示最终状态。 */
function setTelemetryEnabled() {
  return false;
}

/** 兼容上游关于页读取：固定为关闭。 */
function readTelemetrySetting() {
  return { value: false, checkedAt: 0 };
}

/** no-op：不发送任何事件。 */
function captureMessage() {
  return false;
}

/** no-op：不上报任何异常。 */
function captureException() {
  return false;
}

/** no-op：没有本地待发送队列。 */
function flushOutbox() {
  return Promise.resolve({ sent: 0 });
}

/** 兼容上游 makeEvent：仅返回一个不含任何外部端点的本地对象。 */
function makeEvent(kind, fields) {
  return { kind: kind || 'event', at: Date.now(), fields: fields || {} };
}

module.exports = {
  captureMessage,
  captureException,
  flushOutbox,
  makeEvent,
  readTelemetrySetting,
  setTelemetryEnabled,
  telemetryEnvironmentOverride,
  telemetryEnabled,
};
`,
  "utf8",
);
log("  ✓ sentry-report.js（全量 no-op）");
} // end if (!BRANDING_ONLY)

log("");
if (failures) {
  log(`结果：${failures} 处失败，请检查上面的 ✗。`);
  process.exitCode = 1;
} else {
  log("结果：全部改写成功。");
}
