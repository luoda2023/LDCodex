#!/usr/bin/env node
'use strict';
/*
 * 核验「本机安装的 LDCodex 到底是哪一版」—— 出包之后、装完之后各跑一次。
 *
 * 为什么需要它：这个项目踩过两次同一个坑 —— **代码改对了、包也出了，但用户机器上跑的仍是旧版**，
 * 于是所有「改了没用」的反馈其实都是「根本没装上」。肉眼比对不可靠：
 *   · 注册表 DisplayVersion 只反映**安装器写入过什么**，不反映运行时文件有没有被覆盖；
 *   · 安装目录 mtime 会被别的操作带偏；
 *   · 安装包是 LZMA 压缩的，哈希比对**不能**用来判断包是不是新构建的
 *     （见 overview.md 第七节 ⑦：makensis 是确定性的，但出包后 cargo 会重链接一次管理器 exe，
 *      所以「重编产物哈希 ≠ 出包产物哈希」是正常的）。
 *
 * 做法：把「安装目录 workbuddy-runtime 下的文件」与「源码里的同名文件」**逐个比哈希**，
 * 再读安装目录 daemon.js 的 DAEMON_VERSION / DAEMON_BUILD_ID 与注册表 DisplayVersion。
 * 源码是唯一权威 —— 哈希全等就说明运行时确实吃到了当前源码。
 *
 * ⚠️🔴 但**只靠上面这些会给出假阳性**：它们只覆盖 workbuddy-runtime + inject.js。
 *   只要本次改动没碰 daemon（绝大多数前端/后端改动都不碰），这几项**永远全绿** ——
 *   哪怕已装的 LDCodexManager.exe 还是上一轮那个、新功能一个都没有。
 *   真事：88.8.6 那轮装之前它报 7/7，但已装 exe 里 `list_workbuddy_sessions` 命中 0。
 *   所以第 7 项专门验**主程序本体**的前端指纹，见下面「7)」。
 *
 * 用法：
 *   node _test_daemon/verify-installed-version.mjs            # 诊断模式，永远 exit 0
 *   node _test_daemon/verify-installed-version.mjs --strict   # 不匹配则 exit 1（给 CI / 手动守门用）
 *   LDCODEX_INSTALL_DIR=D:\somewhere node _test_daemon/verify-installed-version.mjs
 *
 * 注意：**只读**，不改任何文件、不写注册表、不启动任何进程。
 * ⚠️ 本机 `reg.exe` 在沙箱的程序黑名单里（"PROGRAM BLOCKED BY SECURITY POLICY"，Node 侧表现为
 *    `spawnSync reg EPERM`）—— 所以读注册表先试 `reg query`，失败就自动降级到
 *    PowerShell `Get-ItemProperty`（实测可行）；**两条路都被拦时记为 SKIP 而不是 FAIL**，
 *    否则会把「读不到」误报成「版本不对」。
 *    运行终端里会多出一行沙箱拦截提示，属正常现象。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC_RUNTIME = path.join(ROOT, 'apps', 'codex-plus-manager', 'src-tauri', 'workbuddy-runtime');
const SRC_CARGO = path.join(ROOT, 'Cargo.toml');
const INSTALL_DIR = process.env.LDCODEX_INSTALL_DIR || 'C:\\Program Files\\LDCodex';
const INSTALL_RUNTIME = path.join(INSTALL_DIR, 'workbuddy-runtime');
const UNINSTALL_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LDCodex';

const STRICT = process.argv.includes('--strict');

const results = [];
function rec(name, pass, detail) {
  results.push({ name, pass: !!pass, skip: false, detail: String(detail == null ? '' : detail) });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? '  ::  ' + detail : ''));
}
function skip(name, detail) {
  results.push({ name, pass: true, skip: true, detail: String(detail == null ? '' : detail) });
  console.log('SKIP ' + name + (detail ? '  ::  ' + detail : ''));
}
function info(msg) {
  console.log('     ' + msg);
}

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; }
}
function sha256(p) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
  catch (_) { return null; }
}
function firstMatch(src, re) {
  if (!src) return null;
  const m = src.match(re);
  return m ? m[1] : null;
}
function exists(p) {
  try { fs.statSync(p); return true; } catch (_) { return false; }
}
/** 本地时间（不要用 toISOString —— 那是 UTC，比北京时间少 8 小时，看着像旧文件）。 */
function mtime(p) {
  try {
    const d = fs.statSync(p).mtime;
    const p2 = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
      ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  } catch (_) { return null; }
}

const BLOCKED_RE = /blacklist|BLOCKED BY SECURITY POLICY|blocked from starting|access is denied|EPERM|EACCES/i;

/**
 * 读注册表卸载项。返回 { status, values }：
 *   status = 'ok'      读到了
 *          | 'missing' 键不存在（真的没装 / 已被正确卸载）
 *          | 'blocked' 读取手段被沙箱拦了（**不能当成没装**）
 *          | 'error'   其它失败
 */
function readRegistry() {
  let regFailMsg = '';
  // 手段 1：reg.exe
  try {
    const out = execFileSync('reg', ['query', UNINSTALL_KEY], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
    });
    const values = {};
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\s{2,}([^\s]+)\s+REG_SZ\s+(.+?)\s*$/);
      if (m) values[m[1]] = m[2];
    }
    return { status: 'ok', values };
  } catch (e) {
    const msg = String((e && (e.stderr || '')) || '') + ' ' + String((e && e.message) || '');
    // status === 1 且不是权限/黑名单问题 → 键确实不存在
    if (e && e.status === 1 && !BLOCKED_RE.test(msg)) {
      return { status: 'missing', values: {} };
    }
    // 其余情况（EPERM / 黑名单 / 找不到 reg.exe）都继续试手段 2
    regFailMsg = msg.trim().slice(0, 120);
  }
  // 手段 2：PowerShell
  try {
    const ps = "$p = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LDCodex' -ErrorAction Stop; " +
      "$p | ConvertTo-Json -Compress";
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000,
    });
    const obj = JSON.parse(out.trim());
    const values = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') values[k] = v;
    }
    return { status: 'ok', values };
  } catch (e) {
    const msg = String((e && (e.stderr || '')) || '') + ' ' + String((e && e.message) || '');
    // PowerShell 找不到键时会非 0 退出并报 ObjectNotFound
    if (/ObjectNotFound|cannot find|找不到/i.test(msg)) return { status: 'missing', values: {} };
    if (BLOCKED_RE.test(msg)) return { status: 'blocked', values: {}, msg: regFailMsg || msg.trim().slice(0, 120) };
    return { status: 'error', values: {}, msg: (msg || regFailMsg).trim().slice(0, 200) };
  }
}

console.log('=== 本机 LDCodex 安装版本核验（只读） ===\n');
console.log('源码 runtime : ' + SRC_RUNTIME);
console.log('安装目录     : ' + INSTALL_DIR + '\n');

// ── 1) 期望版本：Cargo.toml [workspace.package] version 是唯一权威来源 ──
const cargoSrc = readText(SRC_CARGO);
const expectedVer = firstMatch(cargoSrc, /\[workspace\.package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/);
rec('读到源码权威版本号（Cargo.toml [workspace.package] version）', !!expectedVer,
  expectedVer ? '期望版本 = ' + expectedVer : 'Cargo.toml 里没找到 version');

// 源码 daemon.js 的版本必须与 Cargo.toml 一致（T14 系列在守这条，这里顺带复核）
const srcDaemon = readText(path.join(SRC_RUNTIME, 'daemon.js'));
const srcDaemonVer = firstMatch(srcDaemon, /const DAEMON_VERSION = '([^']+)'/);
const srcBuildId = firstMatch(srcDaemon, /const DAEMON_BUILD_ID = '([^']+)'/);
rec('源码 daemon.js 的 DAEMON_VERSION 与 Cargo.toml 一致', srcDaemonVer === expectedVer,
  'daemon.js = ' + srcDaemonVer + ' / Cargo.toml = ' + expectedVer);
if (srcBuildId) info('源码 DAEMON_BUILD_ID = ' + srcBuildId);

// ── 2) 安装目录在不在 ──
const installed = exists(INSTALL_DIR);
rec('安装目录存在（' + INSTALL_DIR + '）', installed,
  installed ? '目录 mtime ' + mtime(INSTALL_DIR) : '不存在 —— 说明还没装过');
if (!installed) {
  console.log('\n=== 结论：本机尚未安装 LDCodex（或装到了别处） ===');
  console.log('下一步：运行 target\\release\\bundle\\nsis\\LDCodex_' + (expectedVer || '<版本>') + '_x64-setup.exe');
  console.log('       若出现「已存在版本为旧的」页面，选「请勿卸载」→ 下一步（见 overview.md 第七节）。');
  process.exitCode = STRICT ? 1 : 0;
  process.exit();
}

// ── 3) 运行时文件逐个比哈希：源码 vs 安装目录 ──
let names = [];
try {
  names = fs.readdirSync(SRC_RUNTIME, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .sort();
} catch (e) {
  rec('读取源码 runtime 目录', false, String(e && e.message));
}

const same = [], diff = [], missing = [];
for (const n of names) {
  const a = sha256(path.join(SRC_RUNTIME, n));
  const b = sha256(path.join(INSTALL_RUNTIME, n));
  if (b == null) missing.push(n);
  else if (a === b) same.push(n);
  else diff.push(n);
}

const total = names.length;
rec('安装目录 workbuddy-runtime 与源码逐文件一致（共 ' + total + ' 个）',
  diff.length === 0 && missing.length === 0,
  same.length + ' 一致 / ' + diff.length + ' 不一致 / ' + missing.length + ' 缺失');
if (diff.length) info('不一致：' + diff.join(', '));
if (missing.length) info('缺失：' + missing.join(', '));

// ── 4) 安装目录 daemon.js 的版本 ──
const insDaemon = readText(path.join(INSTALL_RUNTIME, 'daemon.js'));
const insDaemonVer = firstMatch(insDaemon, /const DAEMON_VERSION = '([^']+)'/);
const insBuildId = firstMatch(insDaemon, /const DAEMON_BUILD_ID = '([^']+)'/);
rec('安装目录 daemon.js 的 DAEMON_VERSION = 期望版本', insDaemonVer === expectedVer,
  '安装 = ' + insDaemonVer + ' / 期望 = ' + expectedVer);
if (insBuildId) info('安装 DAEMON_BUILD_ID = ' + insBuildId);

info('安装目录 uninstall.exe mtime = ' + (mtime(path.join(INSTALL_DIR, 'uninstall.exe')) || '（不存在）'));

// ── 5) 注册表（读不到就 SKIP，别误报） ──
const reg = readRegistry();
if (reg.status === 'ok') {
  const regVer = reg.values.DisplayVersion || null;
  rec('注册表 DisplayVersion = 期望版本', regVer === expectedVer,
    'DisplayVersion = ' + regVer);
  if (reg.values.UninstallString) info('UninstallString = ' + reg.values.UninstallString);
} else if (reg.status === 'missing') {
  rec('注册表卸载项存在', false, '键不存在（' + UNINSTALL_KEY + '）—— 说明已被卸载或从未写入');
} else if (reg.status === 'blocked') {
  skip('读注册表 DisplayVersion', 'reg.exe 与 powershell.exe 都被沙箱程序黑名单拦截，无法读取（不影响其它判据）');
} else {
  skip('读注册表 DisplayVersion', '读取失败：' + (reg.msg || '未知原因'));
}

// ── 6) 插件面板高度修复的落地标记（88.8.3 引入；插件侧，源码里应有 5 处） ──
const MARKER = '100vh - 44px';
function countOccurrences(haystack, needle) {
  if (!haystack || !needle) return 0;
  return haystack.split(needle).length - 1;
}
const srcHits = countOccurrences(readText(path.join(SRC_RUNTIME, 'inject.js')), MARKER);
const insHits = countOccurrences(readText(path.join(INSTALL_RUNTIME, 'inject.js')), MARKER);
rec('安装的 inject.js 含插件面板高度修复标记「' + MARKER + '」（88.8.3 引入）',
  insHits > 0 && insHits === srcHits,
  '安装命中 ' + insHits + ' 处 / 源码 ' + srcHits + ' 处');

// ── 7) 主程序本体：前端指纹（🔴 没有这一项，前面全绿也可能是旧版） ──
// 为什么这么判：Tauri 把 dist 打进 exe，资源的**文件名清单是明文**，但**内容是压缩包**
// —— 所以 JS 里的类名 / 中文文案在 exe 里**搜不到**（别再拿它们当证据），
// 而 `index-<hash>.js` 这个文件名能搜到，且 hash 随前端内容变化 → 天然的版本指纹。
const DIST_ASSETS = path.join(ROOT, 'apps', 'codex-plus-manager', 'dist', 'assets');
const INSTALL_EXE = path.join(INSTALL_DIR, 'LDCodexManager.exe');
let distJs = [];
try {
  distJs = fs.readdirSync(DIST_ASSETS)
    .filter((n) => /^index-[A-Za-z0-9_-]+\.js$/.test(n))
    .sort();
} catch (_) { /* 前端还没构建过 */ }

if (!exists(INSTALL_EXE)) {
  rec('已装主程序存在（' + INSTALL_EXE + '）', false, '不存在');
} else if (distJs.length === 0) {
  skip('已装主程序含当前 dist 前端指纹', 'dist/assets 里没有 index-*.js（前端尚未构建，跑一次 npm run build）');
} else {
  const exe = fs.readFileSync(INSTALL_EXE);
  const miss = distJs.filter((n) => exe.indexOf(Buffer.from(n, 'latin1')) === -1);
  rec('已装主程序含当前 dist 前端指纹（' + distJs.length + ' 个）',
    miss.length === 0,
    '命中 ' + (distJs.length - miss.length) + '/' + distJs.length +
      (miss.length ? '；缺：' + miss.join(', ') : '') + '  【' + distJs.join(', ') + '】');
  info('已装 exe ' + fs.statSync(INSTALL_EXE).size + ' B / mtime ' + mtime(INSTALL_EXE));
  if (miss.length) {
    info('含义：**装的还是上一轮的主程序**（版本号可能对，内容不是这轮的）→ 重跑 npm run build 再装一次。');
  }
}

// ── 汇总 ──
const checked = results.filter((r) => !r.skip);
const pass = checked.filter((r) => r.pass).length;
const fail = checked.length - pass;
const skipped = results.length - checked.length;
const skipNote = skipped ? '（另有 ' + skipped + ' 项 SKIP）' : '';
console.log('\n=== 安装版本核验：' + pass + '/' + checked.length + ' ' +
  (fail ? '❌ 失败 ' + fail : '✅ 全部通过') + skipNote + ' ===');
if (fail) {
  console.log('\n失败项：');
  checked.filter((r) => !r.pass).forEach((r) => console.log('  - ' + r.name + '  ::  ' + r.detail));
  console.log('\n含义：**本机跑的不是当前源码那一版**。最常见原因是安装器那步没走完');
  console.log('（「已存在版本为旧的」页面选了「安装前卸载」，旧卸载器 Abort 掉了）。');
  console.log('解法见 overview.md 第七节 ③④⑤：改选「请勿卸载」。');
} else {
  console.log('\n✅ 本机安装目录的运行时与源码逐字节一致，版本 ' + expectedVer + ' 已就位。');
}
process.exitCode = fail && STRICT ? 1 : 0;
