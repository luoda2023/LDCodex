'use strict';
/*
 * 验证「插件面板（注入到 WorkBuddy 客户端里的那套 .wbs-* UI）不会超出客户端窗口下边框」。
 *
 * 为什么需要它：插件面板的高度是**两处硬编码/估值**堆出来的 ——
 *   · inject.js:7059  lockPanelHeight() 用 JS 内联把 panel 钉成 height/max-height: 650px
 *     （内联样式优先级高于样式表，改 CSS 没用）；
 *   · .wbs-body 上同时挂着 height:calc(650px - 170px) 与 max-height:calc(min(78vh,660px) - 118px)
 *     两条互相打架的估值 —— 78vh 是视口高度的比例，跟面板真正剩下多少空间毫无关系。
 * 结果：客户端窗口一矮（笔记本外接屏、拖小窗口），650px 的面板就装不进窗口，
 *       顶边被裁（标题栏和 ✕ 看不见），底部又留一大片空白，长列表够不到最后一项。
 *
 * 做法：plugin-panel-harness.html 复刻真实 DOM（.wbs-root > .wbs-panel > .wbs-head +
 * .wbs-tabs + .wbs-body > .wbs-pane），CSS **直接从 inject.js 的样式数组里抽出来**，
 * 保证量到的是真实规则。无头 Chrome 在多个窗口高度下实测，覆盖用户点名的三个页签：
 *   ?pane=account（账号） / ?pane=sessions（会话） / ?pane=enhance（增强）
 *   ① 面板顶边不得被窗口上沿裁掉；
 *   ② 面板底边不得超出窗口下边框；
 *   ③ 把内层列表滚到底后，最后一项必须落在面板可视区内；
 *   ④ 列表真的能滚时，滚动条滑块不得是透明的（否则用户不知道能滚）；
 *   ⑤ 自检：注入修复前的旧规则（?old=1），夹具必须判定为 FAIL。
 *
 * 运行：由 test-run.sh 调用；也可单独 `node _test_daemon/verify-plugin-layout.mjs`。
 * 找不到 Chrome 时打印 SKIP 并以 0 退出，不阻塞其它测试。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const INJECT = path.join(ROOT, 'apps', 'codex-plus-manager', 'src-tauri', 'workbuddy-runtime', 'inject.js');
const HARNESS = path.join(HERE, 'plugin-panel-harness.html');

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

/**
 * 从 inject.js 里把注入用的样式表抽出来。
 * 形如：
 *   var css = document.createElement('style');
 *   css.id = 'wbs-style';
 *   css.textContent = [
 *     '.wbs-root{...}',
 *     ...
 *   ].join('');
 * 把 `css.textContent =` 换成 `var __css =` 后整段求值即可 —— 数组里只有字符串字面量和注释。
 */
function extractPluginCss() {
  const src = fs.readFileSync(INJECT, 'utf8');
  const lines = src.split(/\r?\n/);
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (start < 0 && /css\.textContent\s*=\s*\[\s*$/.test(lines[i])) start = i;
    if (start >= 0 && /^\s*\]\.join\(''\);\s*$/.test(lines[i])) { end = i; break; }
  }
  if (start < 0 || end < 0) throw new Error('未在 inject.js 里找到 css.textContent = [ ... ].join(\'\') 数组');
  const chunk = lines.slice(start, end + 1).join('\n').replace(/css\.textContent\s*=\s*/, 'var __css = ');
  // eslint-disable-next-line no-new-func
  const fn = new Function(chunk + '\nreturn __css;');
  const css = fn();
  if (typeof css !== 'string' || css.length < 10000) {
    throw new Error('抽出的 CSS 长度异常：' + (typeof css === 'string' ? css.length : typeof css));
  }
  return css;
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
    dom = (e && e.stdout) || '';
  }
  const m = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom);
  if (!m) return null;
  const text = m[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  const map = {};
  text.split('\n').map((l) => l.trim()).filter(Boolean).forEach((line) => {
    const i = line.indexOf('=');
    if (i > 0) map[line.slice(0, i)] = line.slice(i + 1);
  });
  return map;
}

const num = (map, key) => {
  const v = Number(map[key]);
  return Number.isFinite(v) ? v : NaN;
};

/**
 * scrollbar-color 的计算值可能是 `transparent`，也可能是 `rgba(0, 0, 0, 0)`
 * —— 后者是浏览器把 transparent 规范化后的写法，光比对字符串 "transparent" 会漏判。
 * 这里统一解析成「滑块是否真的看得见」。
 */
function isInvisibleColor(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return true;
  if (s === 'transparent') return true;
  const m = /^rgba\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*\)$/.exec(s);
  if (m) return Number(m[4]) === 0;
  return false;
}

const chrome = findChrome();
if (!chrome) {
  console.log('SKIP 未找到 Chrome / Edge，跳过插件面板布局实测（不影响其它测试）。');
  process.exit(0);
}

let pluginCss;
try {
  pluginCss = extractPluginCss();
} catch (e) {
  console.log('SKIP 无法从 inject.js 抽出样式表：' + (e && e.message));
  process.exit(0);
}

console.log('使用浏览器: ' + chrome);
console.log('使用样式表: inject.js 内联样式数组（' + pluginCss.length + ' 字符）');

const harnessSrc = fs.readFileSync(HARNESS, 'utf8');
// 占位符必须全文件唯一，否则 replace 只替换第一处（注释里再写一遍就会踩这个坑）
const TOKEN = '__PLUGIN_CSS__';
const tokenCount = harnessSrc.split(TOKEN).length - 1;
if (tokenCount !== 1) {
  console.log('SKIP 夹具里 ' + TOKEN + ' 占位符出现 ' + tokenCount + ' 次（应为 1 次），无法安全注入样式。');
  process.exit(0);
}
// 用函数形式替换，避免 CSS 里的 $& / $1 之类被当成替换模式
const tmpHarness = path.join(HERE, '.plugin-panel-harness.tmp.html');
fs.writeFileSync(tmpHarness, harnessSrc.replace(TOKEN, () => pluginCss), 'utf8');

const profileDir = path.join(os.tmpdir(), 'ldcodex-plugin-layout-profile');
try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }

const PANES = [
  { id: 'account', label: '账号' },
  { id: 'sessions', label: '会话' },
  { id: 'enhance', label: '增强' },
];

const SIZES = [
  { w: 1280, h: 900 },
  { w: 1280, h: 760 },
  { w: 1280, h: 620 },
  { w: 1280, h: 520 },
];

// ── 1) 修复后的行为：三个页签 × 四种窗口高度都必须 PASS ──
for (const pane of PANES) {
  for (const { w, h } of SIZES) {
    const tag = pane.label + ' ' + w + 'x' + h;
    const m = dumpMeasurements(chrome, tmpHarness, profileDir, w, h, '?pane=' + pane.id + '&count=16');
    if (!m) { rec('插件面板 ' + tag + ' 能取到测量结果', false, '未解析到 #out'); continue; }

    const vh = num(m, 'viewportH');
    const panelTop = num(m, 'panel.top');
    const panelBottom = num(m, 'panel.bottom');
    const panelHeight = num(m, 'panel.height');
    const lastVisible = num(m, 'lastItemVisible');
    const lastBottom = num(m, 'lastItem.bottom');
    const listScrollH = num(m, 'list.scrollH');
    const listClientH = num(m, 'list.clientH');
    const sbColor = m['list.scrollbarColor'] || '';
    const detail = 'panel ' + panelTop + '→' + panelBottom + ' (高 ' + panelHeight + '，视口 ' + vh +
      ')，最后一项 bottom=' + lastBottom + '，list ' + listClientH + '/' + listScrollH;

    rec('插件面板 ' + tag + '：面板顶边没被窗口上沿裁掉', panelTop >= -1, detail);
    rec('插件面板 ' + tag + '：面板底边不超出窗口下边框', panelBottom <= vh + 1, detail);
    rec('插件面板 ' + tag + '：滚到底后最后一项在面板内可见', lastVisible === 1, detail);

    // ④ 真的能滚时，滑块不能是透明的
    if (listScrollH > listClientH + 1) {
      const thumb = sbColor.trim().split(/\s+/)[0] || '';
      rec('插件面板 ' + tag + '：可滚动列表的滚动条滑块可见',
        !isInvisibleColor(thumb),
        'scrollbar-color=' + sbColor);
    }
  }
}

// ── 2) 自检：注入修复前的旧规则，夹具必须判定为 FAIL ──
for (const pane of PANES) {
  const m = dumpMeasurements(chrome, tmpHarness, profileDir, 1280, 620, '?pane=' + pane.id + '&count=16&old=1');
  if (!m) { rec('自检 ' + pane.label + ' 能复现问题', false, '未解析到 #out'); continue; }
  const vh = num(m, 'viewportH');
  const panelTop = num(m, 'panel.top');
  const panelHeight = num(m, 'panel.height');
  const reproduced = panelTop < -1 || panelHeight > vh;
  rec('自检：注入旧「panel 钉死 650px」后，' + pane.label + ' 夹具能判定为「装不进窗口」',
    reproduced,
    'panel.top=' + panelTop + ' 高=' + panelHeight + '（视口高 ' + vh + '）');
}

try { fs.rmSync(tmpHarness, { force: true }); } catch (_) { /* ignore */ }
try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }

const pass = results.filter((r) => r.pass).length;
const fail = results.length - pass;
console.log('\n=== 插件面板布局实测：' + pass + '/' + results.length + ' ' + (fail ? '❌ 失败 ' + fail : '✅ 全部通过') + ' ===');
if (fail) {
  console.log('\n失败项：');
  results.filter((r) => !r.pass).forEach((r) => console.log('  - ' + r.name + '  ::  ' + r.detail));
}
process.exitCode = fail ? 1 : 0;
