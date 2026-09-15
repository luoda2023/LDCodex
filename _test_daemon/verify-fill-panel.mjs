// 验证 .fill Panel 的「高度跟着内容变长」（不再被 grid stretch 钉死）
//
// 覆盖：WorkBuddy 国际/国内版 8 个 tab + MCP&插件页面（都用 Panel fill）
// 反向自检：注入修复前的旧规则必须判 FAIL
//
// 用法：node _test_daemon/verify-fill-panel.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import pathNode from 'node:path';

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const htmlPath = 'D:/LUODA/LDcodex/_test_daemon/fill-panel-harness.html';
// ⚠️ 必须用系统临时目录：原先放在 _test_daemon/ 下，一次跑 30 个 case 就在仓库里
// 留下 30 个 `_chrome-profile-fill-panel-*` 未跟踪目录（git status 一堆 ??）。
// os.tmpdir() 下用完即删，仓库保持干净。
const profileDir = fs.mkdtempSync(pathNode.join(os.tmpdir(), 'chrome-profile-fill-panel-'));

function dump(htmlPath, profileDir, w, h, query) {
  const dom = execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--user-data-dir=' + profileDir,
    '--window-size=' + w + ',' + h, '--virtual-time-budget=4000', '--dump-dom',
    'file:///' + htmlPath.replace(/\\/g, '/') + (query || ''),
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 });
  const m = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom);
  if (!m) return null;
  const map = {};
  m[1].split('\n').map(l => l.trim()).filter(Boolean).forEach(l => {
    const i = l.indexOf('=');
    if (i > 0) map[l.slice(0, i)] = l.slice(i + 1);
  });
  return map;
}

function runCase(tab, count, cardH, windowH, old) {
  const q = '?tab=' + tab + '&count=' + count + '&cardH=' + cardH + '&height=' + windowH + (old ? '&old=1' : '');
  // 子目录建在 profileDir **里面**，末尾统一 rmSync(profileDir) 就能清干净
  return dump(htmlPath, pathNode.join(profileDir, tab + '-' + windowH + (old ? '-old' : '')), 1280, windowH, q);
}

function pass(name, ok, detail) {
  return { name, ok, detail };
}

// ── 用例设计 ──
// 每个 tab 的「长内容」参数：count × cardH ≈ 内容总高
// 极端用例：sessions tab（用户报告最严重的）= 4 张 × 280 = 1120px 内容
//           account tab（用户也点名）= 5 张 × 180 = 900px 内容
//           enhance tab（用户也点名）= 3 张 × 320 = 960px 内容
// 短 tab 故意少内容（settings/pc/theme）= 2 张 × 120 = 240px
//
// 窗口高度覆盖：760（标准）/ 620（中等矮）/ 520（矮）
// 反向自检：极端用例 + 旧规则注入，必须 FAIL
const TABS = [
  { id: 'sessions',  count: 4, cardH: 280 },
  { id: 'account',   count: 5, cardH: 180 },
  { id: 'enhance',   count: 3, cardH: 320 },
  { id: 'theme',     count: 2, cardH: 120 },
  { id: 'models',    count: 3, cardH: 240 },
  { id: 'automations', count: 2, cardH: 220 },
  { id: 'pc',        count: 2, cardH: 140 },
  { id: 'settings',  count: 2, cardH: 100 },
  { id: 'mcp',       count: 4, cardH: 260 }, // ContextScreen（MCP&插件）共用 .fill
];
const HEIGHTS = [760, 620, 520];

const results = [];

// 正向：每个 tab × 每个高度都 PASS
for (const t of TABS) {
  for (const h of HEIGHTS) {
    const m = runCase(t.id, t.count, t.cardH, h, false);
    if (!m) { results.push(pass(`${t.id}@${h} dump 失败`, false, '')); continue; }
    const overflow = m.lastOutsidePanel === 'true';
    const delta = Number(m.lastOutsidePanelDelta);
    results.push(pass(
      `${t.id}@${h}px：最后一张卡片不超出 Panel（delta=${delta}px）`,
      !overflow,
      `panelH=${m.panelH} ccH=${m.ccH} lastBottom=${m.lastCardBottom} panelBottom=${m.panelBottom} alignSelf=${m.panelAlignSelf}`
    ));
  }
}

// 反向自检：注入旧规则（align-self: stretch + height calc），极端用例必须判 FAIL
const oldCases = [
  { id: 'sessions',  count: 4, cardH: 280, h: 620 },
  { id: 'account',   count: 5, cardH: 180, h: 620 },
  { id: 'mcp',       count: 4, cardH: 260, h: 620 },
];
for (const c of oldCases) {
  const m = runCase(c.id, c.count, c.cardH, c.h, true);
  if (!m) { results.push(pass(`${c.id}@${c.h}+old dump 失败`, false, '')); continue; }
  const overflow = m.lastOutsidePanel === 'true';
  results.push(pass(
    `反向自检：${c.id}@${c.h}+旧规则 必须判 FAIL（确实溢出 ${overflow}）`,
    overflow,
    `panelAlignSelf=${m.panelAlignSelf} delta=${m.lastOutsidePanelDelta}`
  ));
}

// 输出
let passN = 0, failN = 0;
for (const r of results) {
  if (r.ok) { passN++; console.log('PASS  ' + r.name); }
  else      { failN++; console.log('FAIL  ' + r.name + (r.detail ? ' :: ' + r.detail : '')); }
}
console.log('');
console.log(`通过 ${passN} / 共 ${passN + failN} ${failN ? '❌ 失败 ' + failN : '✅ 全部通过'}`);
fs.rmSync(profileDir, { recursive: true, force: true });
process.exit(failN ? 1 : 0);