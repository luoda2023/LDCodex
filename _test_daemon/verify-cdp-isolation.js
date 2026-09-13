'use strict';
/*
 * 验证 daemon 1.2.9 的 CDP 端口隔离逻辑（双开互不影响的核心）。
 * 做法：从 daemon.js 提取真实函数源码，注入不同 profile 场景执行，检查候选端口与归属判定。
 *
 * 1.2.9 相对 1.2.8 的行为变更：
 *   - WBSWITCH_CDP_PORT 不再一票否决隔离判断。管理器每次拉起 daemon 都会下发该变量，
 *     旧逻辑下生产环境里这道保护等于不存在：selectCdpPort() 会把兄弟保留端口当候选，
 *     ownCdpPorts() 也会把对端端口算成自己的。
 *   - 回退端口按 profile 分段（CN 9236-9245 / AI 9246-9255 / CB-CN 9256-9265 / CB-intl 9266-9275），
 *     不再共用 9226-9232 + 9333，双开同时启动不再有抢同一端口的竞态窗口。
 */
const fs = require('node:fs');
const path = require('node:path');

const RUNTIME = 'D:/LUODA/LDcodex/apps/codex-plus-manager/src-tauri/workbuddy-runtime';
const src = fs.readFileSync(path.join(RUNTIME, 'daemon.js'), 'utf8');
const cdpTargets = require(path.join(RUNTIME, 'cdp-targets.js'));

function extractFn(source, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(');
  const m = re.exec(source);
  if (!m) return null;
  let i = source.indexOf('{', m.index);
  if (i < 0) return null;
  const start = m.index;
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}

const names = ['validCdpPort', 'cdpPortOwnedByOtherProfile', 'ownCdpPorts', 'cdpPortCandidates', 'cdpTargetMatcher'];
const fns = names.map((n) => extractFn(src, n));
const missing = names.filter((n, i) => !fns[i]);
const results = [];
function rec(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: String(detail == null ? '' : detail) });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + '  ::  ' + (detail || ''));
}

rec('提取 ' + names.join(' / '), missing.length === 0,
  missing.length ? ('缺失: ' + missing.join(', ')) : '全部函数源码均已提取');

// 与 daemon.js 保持一致：提取失败时下面会直接报错，这里先兜底声明避免整体崩掉。
const PROFILE_CDP_PORT = { 'workbuddy-cn': 9222, 'workbuddy-ai': 9223, 'codebuddy-cn': 9224, 'codebuddy-intl': 9225 };
const CDP_FALLBACK_BASE = { 'workbuddy-cn': 9236, 'workbuddy-ai': 9246, 'codebuddy-cn': 9256, 'codebuddy-intl': 9266 };

function withEnvCdpPort(envCdpPort, fn) {
  const saved = process.env.WBSWITCH_CDP_PORT;
  if (envCdpPort === undefined) delete process.env.WBSWITCH_CDP_PORT;
  else process.env.WBSWITCH_CDP_PORT = String(envCdpPort);
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.WBSWITCH_CDP_PORT;
    else process.env.WBSWITCH_CDP_PORT = saved;
  }
}

function candidatesFor(profileId, cdpHint, persistedPort, envCdpPort) {
  const body = `
    const PROFILE_CDP_PORT = ${JSON.stringify(PROFILE_CDP_PORT)};
    const CDP_FALLBACK_BASE = ${JSON.stringify(CDP_FALLBACK_BASE)};
    const PROFILE = { id: ${JSON.stringify(profileId)} };
    const CDP_PORT_HINT = ${cdpHint};
    function readCdpPortFile() { return ${persistedPort === null ? 'null' : persistedPort}; }
    ${fns.join('\n')}
    return { candidates: cdpPortCandidates(), own: Array.from(ownCdpPorts()) };
  `;
  return withEnvCdpPort(envCdpPort, () => new Function(body)());
}

function matchesPage(profileId, cdpHint, port, pageUrl) {
  const body = `
    const PROFILE_CDP_PORT = ${JSON.stringify(PROFILE_CDP_PORT)};
    const CDP_FALLBACK_BASE = ${JSON.stringify(CDP_FALLBACK_BASE)};
    const PROFILE = { id: ${JSON.stringify(profileId)}, kind: 'workbuddy' };
    const CDP_PORT_HINT = ${cdpHint};
    function readCdpPortFile() { return null; }
    ${fns.join('\n')}
    const classifyTarget = cdpTargets.classifyTarget;
    function isWorkBuddyCdpTarget(target) { return cdpTargets.isTargetForProfile(target, PROFILE); }
    return cdpTargetMatcher(${port})({ type: 'page', url: ${JSON.stringify(pageUrl)}, title: 'WorkBuddy' });
  `;
  return new Function('cdpTargets', body)(cdpTargets);
}

const AI_PAGE = 'file:///C:/Users/u/AppData/Local/Programs/WorkBuddyAI/resources/app.asar/renderer/index.html?locale=zh-CN';
const CN_PAGE = 'file:///C:/Users/u/AppData/Local/Programs/WorkBuddy/resources/app.asar/renderer/index.html?locale=zh-CN';

/* ── 场景 1：国际版（workbuddy-ai），历史脏数据 cdp-port.json = 9222 ── */
const ai = candidatesFor('workbuddy-ai', 9223, 9222);
rec('国际版首选端口 = 9223（不被脏数据 9222 带偏）', ai.candidates[0] === 9223, 'candidates[0]=' + ai.candidates[0]);
rec('国际版候选里已排除兄弟 profile 的 9222', !ai.candidates.includes(9222), '候选=' + JSON.stringify(ai.candidates));
rec('国际版候选里不包含 9224/9225（CodeBuddy 保留端口）',
  !ai.candidates.includes(9224) && !ai.candidates.includes(9225), '候选=' + JSON.stringify(ai.candidates));
rec('国际版候选走 9246-9255 专属回退段',
  ai.candidates.includes(9246) && ai.candidates.includes(9255), '候选=' + JSON.stringify(ai.candidates));

/* ── 场景 2：国内版（workbuddy-cn） ── */
const cn = candidatesFor('workbuddy-cn', 9222, 9222);
rec('国内版首选端口 = 9222', cn.candidates[0] === 9222, 'candidates[0]=' + cn.candidates[0]);
rec('国内版候选里已排除国际版的 9223', !cn.candidates.includes(9223), '候选=' + JSON.stringify(cn.candidates));
rec('国内版候选走 9236-9245 专属回退段',
  cn.candidates.includes(9236) && cn.candidates.includes(9245), '候选=' + JSON.stringify(cn.candidates));

/* ── 场景 3：两端候选集完全不重叠（双开真正互不影响） ── */
const overlap = ai.candidates.filter((p) => cn.candidates.includes(p));
rec('两端 CDP 候选集零重叠', overlap.length === 0, '交集=' + JSON.stringify(overlap));

/* ── 场景 4：管理器下发 WBSWITCH_CDP_PORT 时的行为（1.2.9 行为变更） ──
 * 管理器总是传 profile.cdp_port()，所以"显式指定"不是用户意图，而是常规路径。
 * 若显式端口落在兄弟保留端口上，必须仍然被隔离逻辑挡住。 */
const forced = candidatesFor('workbuddy-ai', 9222, 9222, 9222);
rec('显式 WBSWITCH_CDP_PORT=9222 时国际版候选里仍排除 9222（隔离不再让位）',
  !forced.candidates.includes(9222), '候选=' + JSON.stringify(forced.candidates));
rec('显式 WBSWITCH_CDP_PORT=9222 时国际版首选回落到本档案保留端口 9223',
  forced.candidates[0] === 9223, 'candidates[0]=' + forced.candidates[0]);

/* ── 场景 5：ownCdpPorts 不把兄弟保留端口算成自己的 ──
 * 否则 cdpTargetMatcher 会走宽松匹配，把对端客户端页面认下来。 */
const ownForced = candidatesFor('workbuddy-ai', 9222, 9222, 9222).own;
rec('ownCdpPorts 在显式端口=9222 时不包含 9222', !ownForced.includes(9222), 'own=' + JSON.stringify(ownForced));
rec('ownCdpPorts 始终包含本档案保留端口 9223', ownForced.includes(9223), 'own=' + JSON.stringify(ownForced));

/* ── 场景 6：页面归属强信号优先（客户端被手动起在默认端口时仍能正确认领/拒绝） ── */
rec('国际版 daemon 在 9222 上认领自己的客户端页面（端口漂移仍可用）',
  matchesPage('workbuddy-ai', 9223, 9222, AI_PAGE) === true, 'AI 页面 @9222');
rec('国际版 daemon 在 9222 上拒绝国内版客户端页面（不串台）',
  matchesPage('workbuddy-ai', 9223, 9222, CN_PAGE) === false, 'CN 页面 @9222');
rec('国内版 daemon 在 9222 上认领自己的客户端页面',
  matchesPage('workbuddy-cn', 9222, 9222, CN_PAGE) === true, 'CN 页面 @9222');
rec('国内版 daemon 在 9222 上拒绝国际版客户端页面（不串台）',
  matchesPage('workbuddy-cn', 9222, 9222, AI_PAGE) === false, 'AI 页面 @9222');
rec('国际版 daemon 在本档案保留端口 9223 上认领自己的客户端页面',
  matchesPage('workbuddy-ai', 9223, 9223, AI_PAGE) === true, 'AI 页面 @9223');

const pass = results.filter((r) => r.pass).length;
const fail = results.length - pass;
console.log('\n================ 汇总 ================');
console.log('通过 ' + pass + ' / 共 ' + results.length + (fail ? ('  ❌ 失败 ' + fail) : '  ✅ 全部通过'));
if (fail) results.filter((r) => !r.pass).forEach((r) => console.log('  - ' + r.name + '  ::  ' + r.detail));
fs.writeFileSync('D:/LUODA/LDcodex/_test_daemon/cdp-isolation-report.json',
  JSON.stringify({ pass, fail, total: results.length, results, at: new Date().toISOString() }, null, 2));
process.exitCode = fail ? 1 : 0;
