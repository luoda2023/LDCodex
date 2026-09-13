'use strict';
/*
 * 验证「账号列表 / 会话列表等长内容不会掉到窗口下边框之外」。
 *
 * 为什么需要它：这类 bug 是**纯 CSS 布局**问题 —— 源码级断言（grep 规则文本）只能证明
 * 「写了某条规则」，证明不了「算出来的高度真的没超出窗口」。历史上正是这样漏掉的：
 *   · .workspace 写了 height:100vh，而它位于 .shell 网格第 2 行（该行已是 100vh − 38px 标题栏）
 *     → 整体高出网格区域 38px，被 .shell 的 overflow:hidden 裁掉；
 *   · .workbuddy-pane 写了 max-height: calc(100vh - 330px)，是拍脑袋的估值，比真实可用高度大
 *     → 面板底部连同长列表一起掉出窗口。
 *
 * 做法：用 layout-harness.html 复刻管理器真实外壳结构（.shell / .ld-titlebar / .sidebar /
 * .workspace / .topbar / .screen / .panel.fill / .workbuddy-tabs / .workbuddy-pane），
 * 直接引用**构建产物里那份真实 CSS**，用无头 Chrome 在多个窗口高度下实测：
 *   ① 工作区底边不得超出视口；
 *   ② 滚到屏幕底部后，最后一张列表卡片必须落在视口内；
 *   ③ 侧栏最后一个导航项必须落在视口内；
 *   ④ 自检：把修复前的规则注入回去（?old=1 / ?old=2），夹具必须能判定为 FAIL
 *      —— 否则说明夹具本身失效了，测出来的「通过」不可信。
 *
 * 运行：由 test-run.sh 调用；也可单独 `node _test_daemon/verify-layout-scroll.mjs`。
 * 找不到 Chrome 时打印 SKIP 并以 0 退出，不阻塞其它测试。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MANAGER = path.join(ROOT, 'apps', 'codex-plus-manager');
const DIST_ASSETS = path.join(MANAGER, 'dist', 'assets');
const HARNESS = path.join(HERE, 'layout-harness.html');

const results = [];
function rec(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: String(detail == null ? '' : detail) });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? '  ::  ' + detail : ''));
}

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch (_) { /* ignore */ }
  }
  return null;
}

/** 取构建产物里最新的那份 index-*.css —— 必须测真实产物，不测源码。 */
function findBuiltCss() {
  if (!fs.existsSync(DIST_ASSETS)) return null;
  const files = fs.readdirSync(DIST_ASSETS).filter((f) => /^index-.*\.css$/.test(f));
  if (!files.length) return null;
  const withTime = files.map((f) => ({ f, t: fs.statSync(path.join(DIST_ASSETS, f)).mtimeMs }));
  withTime.sort((a, b) => b.t - a.t);
  return path.join(DIST_ASSETS, withTime[0].f);
}

function dumpMeasurements(chrome, htmlPath, profileDir, width, height, query) {
  const url = 'file:///' + htmlPath.replace(/\\/g, '/') + (query || '');
  let dom = '';
  try {
    dom = execFileSync(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--user-data-dir=' + profileDir,
      '--window-size=' + width + ',' + height,
      '--virtual-time-budget=4000',
      '--dump-dom',
      url,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 90000, maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    // 某些版本把 DOM 写在 stdout 后仍以非 0 退出，尽量取已有输出
    dom = (e && e.stdout) || '';
  }
  const m = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom);
  if (!m) return null;
  return m[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .split('\n').map((l) => l.trimEnd()).filter(Boolean);
}

function pick(lines, prefix) {
  const hit = lines.find((l) => l.startsWith(prefix));
  return hit || '';
}
function numAfter(text, re) {
  const m = re.exec(text);
  return m ? Number(m[1]) : NaN;
}

const chrome = findChrome();
if (!chrome) {
  console.log('SKIP 未找到 Chrome / Edge，跳过布局滚动实测（不影响其它测试）。');
  process.exit(0);
}
const cssPath = findBuiltCss();
if (!cssPath) {
  console.log('SKIP 未找到 apps/codex-plus-manager/dist/assets/index-*.css，请先 `npm run vite:build`。');
  process.exit(0);
}

console.log('使用浏览器: ' + chrome);
console.log('使用样式表: ' + path.relative(ROOT, cssPath));

// 生成临时夹具（把 __CSS_HREF__ 换成真实产物路径）
const harnessSrc = fs.readFileSync(HARNESS, 'utf8');
const cssHref = path.relative(HERE, cssPath).replace(/\\/g, '/');
const tmpHarness = path.join(HERE, '.layout-harness.tmp.html');
fs.writeFileSync(tmpHarness, harnessSrc.replace('__CSS_HREF__', cssHref), 'utf8');

const profileDir = path.join(os.tmpdir(), 'ldcodex-layout-profile');
// 本机 fs.rmSync 被 safe-delete shim 接管，偶发 ETIMEDOUT —— 清不掉也无所谓，Chrome 会复用
try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }

const SIZES = [
  { w: 1280, h: 900 },
  { w: 1280, h: 760 },
  { w: 1280, h: 620 },
  { w: 1280, h: 520 },
];

// ── 1) 修复后的行为：各窗口高度下都必须 PASS ──
for (const { w, h } of SIZES) {
  const lines = dumpMeasurements(chrome, tmpHarness, profileDir, w, h, '');
  if (!lines) { rec('布局实测 ' + w + 'x' + h + ' 能取到测量结果', false, '未解析到 #out'); continue; }
  const vh = numAfter(pick(lines, 'viewport'), /x\s+(\d+)/);
  const wsBottom = numAfter(pick(lines, 'workspace.top/bottom'), /\/\s*(\d+)/);
  const wsHeight = numAfter(pick(lines, 'workspace.height'), /=\s*(\d+)/);
  const cardLine = pick(lines, '  最后一张卡片 bottom');
  const cardBottom = numAfter(cardLine, /=\s*(\d+)/);
  const navLine = pick(lines, '  最后一个导航项 bottom');
  const navBottom = numAfter(navLine, /=\s*(\d+)/);
  const screenLine = pick(lines, 'screen.clientHeight');

  rec('布局 ' + w + 'x' + h + '：工作区不超出窗口下边框',
    wsBottom <= vh + 1 && wsHeight === vh - 38,
    'workspace bottom=' + wsBottom + ' height=' + wsHeight + ' (视口高 ' + vh + '，应为 ' + (vh - 38) + ')');
  rec('布局 ' + w + 'x' + h + '：滚到底后最后一张列表卡片可见',
    cardBottom <= vh + 1 && cardBottom > 0,
    cardLine + ' | ' + screenLine);
  rec('布局 ' + w + 'x' + h + '：侧栏最后一个导航项可见',
    navBottom <= vh + 1 && navBottom > 0,
    navLine);
}

// ── 2) 自检：把修复前的规则注入回去，夹具必须判定为 FAIL ──
//    否则「通过」没有意义（说明夹具根本没在测这件事）。
for (const { flag, label } of [
  { flag: '?old=1', label: '旧 .workspace{height:100vh}' },
  { flag: '?old=2', label: '旧 .workbuddy-pane{max-height:calc(100vh - 330px)}' },
]) {
  const lines = dumpMeasurements(chrome, tmpHarness, profileDir, 1280, 760, flag);
  if (!lines) { rec('自检 ' + label + ' 能复现问题', false, '未解析到 #out'); continue; }
  const vh = numAfter(pick(lines, 'viewport'), /x\s+(\d+)/);
  const wsBottom = numAfter(pick(lines, 'workspace.top/bottom'), /\/\s*(\d+)/);
  const cardBottom = numAfter(pick(lines, '  最后一张卡片 bottom'), /=\s*(\d+)/);
  const reproduced = wsBottom > vh + 1 || cardBottom > vh + 1 || !(cardBottom > 0);
  rec('自检：注入 ' + label + ' 后夹具能判定为「被裁掉」',
    reproduced,
    'workspace bottom=' + wsBottom + ' (视口 ' + vh + ')，最后一张卡片 bottom=' + cardBottom);
}

try { fs.rmSync(tmpHarness, { force: true }); } catch (_) { /* ignore */ }
try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }

const pass = results.filter((r) => r.pass).length;
const fail = results.length - pass;
console.log('\n=== 布局滚动实测：' + pass + '/' + results.length + ' ' + (fail ? '❌ 失败 ' + fail : '✅ 全部通过') + ' ===');
if (fail) {
  console.log('\n失败项：');
  results.filter((r) => !r.pass).forEach((r) => console.log('  - ' + r.name + '  ::  ' + r.detail));
}
process.exitCode = fail ? 1 : 0;
