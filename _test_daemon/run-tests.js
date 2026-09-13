'use strict';
/*
 * LDCodex daemon 88.8.3 功能测试
 * 覆盖：双开隔离自检 / 账号导出导入（含安全校验）/ 跨版本镜像收敛 / 抗崩溃 / 鉴权 /
 *       弹窗自动点允许取样范围 / 快捷短语随账号导出导入去重 / 上弹面板行内新增入口 / 回归
 * 另见 verify-no-disturb.js：单独验证「弹窗自动点允许」的判定逻辑（1.2.10 修的积分误杀）
 * 运行方式：由 test-run.sh 在同一条命令内启动隔离 daemon 后调用，避免 Windows Job Object 连带杀进程。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA_DIR = 'D:/LUODA/LDcodex/_test_daemon/data4';
const BASE = 'http://127.0.0.1:47999';
const RUNTIME = 'D:/LUODA/LDcodex/apps/codex-plus-manager/src-tauri/workbuddy-runtime';
const TMP = 'D:/LUODA/LDcodex/_test_daemon';

const results = [];
function rec(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: String(detail == null ? '' : detail) });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? '  ::  ' + detail : ''));
}
function section(title) { console.log('\n--- ' + title + ' ---'); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(BASE + '/api/status', { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch (_) { /* 还没起来 */ }
    await sleep(500);
  }
  return false;
}

let TOKEN = '';
async function api(p, opts = {}) {
  const { method = 'GET', body, useToken = true } = opts;
  const headers = { 'content-type': 'application/json' };
  if (useToken) headers['x-ldcodex-token'] = TOKEN;
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  // ⚠️ 必须容忍「连接复用失败」并重试。
  //    原因：本机 fs.rmSync 被 safe-delete shim 接管（走回收站二进制），一次删除可能阻塞
  //    数秒；这期间 daemon 的 HTTP keep-alive（默认 5s）会把空闲连接关掉，undici 连接池
  //    随后复用到这条已死的 socket → 抛 TypeError: fetch failed，整个套件随之崩掉
  //    （表现就是「跑到一半只剩十几条结果」）。重试即会拿到新连接。
  //    注意：这里只重试「连接层失败」；HTTP 状态码（4xx/5xx）照常返回给调用方断言。
  let res = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(BASE + p, init);
      break;
    } catch (e) {
      lastErr = e;
      await sleep(300);
    }
  }
  if (!res) throw lastErr;
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch (_) { /* 非 JSON */ }
  return { status: res.status, body: parsed };
}

/** 从源码里按函数名提取完整函数体（大括号配平） */
function extractFn(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(');
  const m = re.exec(src);
  if (!m) return null;
  let i = src.indexOf('{', m.index);
  if (i < 0) return null;
  const start = m.index;
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

/** 从 Rust 源码里按 `fn 名字(` 提取完整函数体（大括号配平） */
function extractRustFn(src, name) {
  const re = new RegExp('fn\\s+' + name + '\\s*(?:<[^>]*>)?\\s*\\(');
  const m = re.exec(src);
  if (!m) return null;
  let i = src.indexOf('{', m.index);
  if (i < 0) return null;
  const start = m.index;
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

(async () => {
  // ── T0 就绪 ──
  section('T0 环境就绪');
  const ready = await waitReady();
  rec('T0 隔离 daemon 在 47999 提供 HTTP', ready, ready ? '已响应 /api/status' : '45s 内未响应');
  if (!ready) { finish(); return; }
  try { TOKEN = fs.readFileSync(path.join(DATA_DIR, '.api-token'), 'utf8').trim(); } catch (_) {}
  rec('T0b 读取到 API token', /^[a-f0-9]{64}$/i.test(TOKEN), 'len=' + TOKEN.length);

  // ── T1 鉴权 ──
  section('T1 鉴权');
  const noAuth = await api('/api/profile/isolation', { useToken: false });
  rec('T1 无 token 访问受保护接口被拒', noAuth.status !== 200, 'status=' + noAuth.status);
  const pub = await api('/api/status', { useToken: false });
  rec('T1b /api/status 属公开路径', pub.status === 200, 'status=' + pub.status);

  // ── T2 双开隔离自检 ──
  section('T2 双开隔离自检 /api/profile/isolation');
  const iso = await api('/api/profile/isolation');
  const b = (iso.body && typeof iso.body === 'object') ? iso.body : {};
  rec('T2 接口 200 且 ok=true', iso.status === 200 && b.ok === true, 'status=' + iso.status);
  rec('T2b 返回 sides 数组（本端在首位）', Array.isArray(b.sides) && b.sides.length >= 1 && b.sides[0] && b.sides[0].id === 'workbuddy-cn',
    'sides=' + JSON.stringify((b.sides || []).map((s) => s.id)));
  rec('T2c 含 isolated/conflicts/warnings/daemonVersion',
    typeof b.isolated === 'boolean' && Array.isArray(b.conflicts) && Array.isArray(b.warnings) && b.daemonVersion === '88.8.3',
    'version=' + b.daemonVersion + ', isolated=' + b.isolated + ', conflicts=' + JSON.stringify(b.conflicts) + ', warnings=' + JSON.stringify(b.warnings));
  const s0 = (b.sides && b.sides[0]) || {};
  rec('T2d 本端字段完整（CDP/面板端口/目录/可执行文件）',
    Number.isFinite(Number(s0.cdpReservedPort)) && Array.isArray(s0.uiPorts) && !!s0.dataDir && 'dataRoot' in s0 && 'binary' in s0,
    'cdp=' + s0.cdpReservedPort + ', ui=' + JSON.stringify(s0.uiPorts) + ', dataDir=' + s0.dataDir);
  rec('T2h 每端含 cdpListening 实际监听探测结果',
    Array.isArray(s0.cdpListening) && (b.sides || []).every((s) => Array.isArray(s.cdpListening)),
    JSON.stringify((b.sides || []).map((s) => ({ id: s.id, reserved: s.cdpReservedPort, live: s.cdpLivePort || 0, listening: s.cdpListening }))));
  // 双 profile 时逐项对比是否两两不冲突
  if (Array.isArray(b.sides) && b.sides.length >= 2) {
    const [x, y] = b.sides;
    const uiOverlap = (x.uiPorts || []).filter((p) => (y.uiPorts || []).includes(p));
    rec('T2e 双 profile 面板端口不重叠', uiOverlap.length === 0, 'overlap=' + JSON.stringify(uiOverlap));
    rec('T2f 双 profile 数据目录不同', String(x.dataDir).toLowerCase() !== String(y.dataDir).toLowerCase(), x.dataDir + ' vs ' + y.dataDir);
    rec('T2g 双 profile CDP 保留端口不同', Number(x.cdpReservedPort) !== Number(y.cdpReservedPort), x.cdpReservedPort + ' vs ' + y.cdpReservedPort);
  } else {
    rec('T2e/f/g 双 profile 对比', false, '只返回了 ' + ((b.sides || []).length) + ' 个 profile（对端未识别）');
  }

  // ── T3 账号导出 / 导入 ──
  section('T3 账号导出 / 导入');
  const uid = '99001777';
  const accountsDir = path.join(DATA_DIR, 'accounts');
  fs.mkdirSync(accountsDir, { recursive: true });
  const acctInfo = JSON.stringify({ account: { uid, nickname: '测试账号A', uin: '10001' } });
  fs.writeFileSync(path.join(accountsDir, uid + '.info'), acctInfo);
  const PW = 'Test-Pass-2026';
  const exportPath = path.join(TMP, 'export1.json');
  try { fs.rmSync(exportPath, { force: true }); } catch (_) {}

  const exp = await api('/api/accounts/export', { method: 'POST', body: { password: PW, saveTo: exportPath } });
  // ⚠️ 不要断言 count === 1。隔离实例**只隔离数据目录，不隔离 auth 目录**（见 lib.js 的
  //    AUTH_FILE / listAuthRecords）：daemon 启动后会把用户真实的已登录账号**异步**备份进
  //    data4/accounts/，同步早于或晚于这次导出都可能发生 —— 写死 1 会在用户有账号时随机
  //    失败（实测 count=3：2 个真实账号 + 本测试写入的 99001777）。
  //    「导出确实含我们刚写入的账号」由 T3c（密文）+ T3d/T3e（删除后往返还原）保证。
  const infoCount = fs.readdirSync(accountsDir).filter((f) => f.endsWith('.info')).length;
  rec('T3 导出成功（count>=1，目录内 ' + infoCount + ' 个 .info）',
    exp.status === 200 && exp.body && exp.body.ok === true && Number(exp.body.count) >= 1,
    JSON.stringify(exp.body));
  rec('T3b 导出文件落盘', fs.existsSync(exportPath), exportPath);
  let raw = '';
  try { raw = fs.readFileSync(exportPath, 'utf8'); } catch (_) {}
  rec('T3c 导出内容已加密（不含明文 uid、含 wbsExport 标记）', raw.includes('wbsExport') && !raw.includes(uid), 'len=' + raw.length);

  // 往返：先删本地备份，再导入还原
  // 注意：本机 fs.rmSync 会被 WorkBuddy 的 safe-delete shim 接管（走回收站二进制），偶发
  // 超时（实测 ETIMEDOUT 会直接把整个套件打挂）。删不掉就退化成"清空内容"——对往返校验
  // 同样有效（导入必须把内容写回来），且不会让套件崩掉。
  try {
    fs.rmSync(path.join(accountsDir, uid + '.info'), { force: true });
  } catch (_) {
    try { fs.writeFileSync(path.join(accountsDir, uid + '.info'), ''); } catch (_) {}
  }
  const imp = await api('/api/accounts/import', { method: 'POST', body: { path: exportPath, password: PW } });
  rec('T3d 导入成功且含该 uid', imp.status === 200 && imp.body && imp.body.ok === true && Array.isArray(imp.body.imported) && imp.body.imported.includes(uid), JSON.stringify(imp.body));
  let restored = '';
  try { restored = fs.readFileSync(path.join(accountsDir, uid + '.info'), 'utf8'); } catch (_) {}
  rec('T3e 往返内容完全一致', restored === acctInfo, restored ? 'len=' + restored.length : '文件未恢复');
  rec('T3f 导出响应回传短语条数 phraseCount',
    exp.body && typeof exp.body.phraseCount === 'number', 'phraseCount=' + (exp.body && exp.body.phraseCount));

  // ── T4 导出/导入的健壮性 ──
  section('T4 导出 / 导入健壮性');
  const bad = await api('/api/accounts/import', { method: 'POST', body: { path: exportPath, password: 'wrong-password' } });
  rec('T4 错误密码被拒且提示明确', bad.body && bad.body.ok === false && /密码|损坏/.test(String(bad.body.error || '')), JSON.stringify(bad.body));
  const emptyPw = await api('/api/accounts/export', { method: 'POST', body: { password: '   ' } });
  rec('T4b 空密码导出被拒', emptyPw.body && emptyPw.body.ok === false, JSON.stringify(emptyPw.body));
  const notExport = await api('/api/accounts/import', { method: 'POST', body: { content: '{"a":1}', password: 'x' } });
  rec('T4c 非 LDCodex 导出文件被拒', notExport.body && notExport.body.ok === false && /LDCodex/.test(String(notExport.body.error || '')), JSON.stringify(notExport.body));
  const missing = await api('/api/accounts/import', { method: 'POST', body: { path: path.join(TMP, 'not-exist.json'), password: 'x' } });
  rec('T4d 文件不存在时优雅报错', missing.body && missing.body.ok === false, JSON.stringify(missing.body));

  // ── T5 导入安全：路径穿越防护 ──
  section('T5 导入安全（路径穿越）');
  const { createEncryptedExport } = require(path.join(RUNTIME, 'secure-transfer.js'));
  const evilUid = '../evil';
  const evilPayload = { exportType: 'LDCodex-accounts', version: 2, accounts: [{ uid: evilUid, info: JSON.stringify({ account: { uid: evilUid } }) }] };
  const evilPath = path.join(TMP, 'evil.json');
  fs.writeFileSync(evilPath, createEncryptedExport('accounts', evilPayload, PW));
  const evilRes = await api('/api/accounts/import', { method: 'POST', body: { path: evilPath, password: PW } });
  const evilImported = (evilRes.body && Array.isArray(evilRes.body.imported)) ? evilRes.body.imported : null;
  rec('T5 含 ../ 的恶意 uid 被跳过（未写入）',
    evilImported !== null && evilImported.length === 0 && !fs.existsSync(path.join(DATA_DIR, 'evil.info')) && !fs.existsSync(path.join(DATA_DIR, '..', 'evil.info')),
    JSON.stringify(evilRes.body));

  // ── T6 跨版本镜像收敛（提取真实函数源码测试）──
  section('T6 跨版本镜像收敛（1.2.8 核心修复）');
  const daemonSrc = fs.readFileSync(path.join(RUNTIME, 'daemon.js'), 'utf8');
  const fnAlign = extractFn(daemonSrc, 'alignTreeTimestamps');
  const fnMtime = extractFn(daemonSrc, 'sessionContentMtime');
  rec('T6a 成功提取 alignTreeTimestamps 源码', !!fnAlign && fnAlign.includes('utimesSync'), fnAlign ? 'len=' + fnAlign.length : '未找到');
  rec('T6b 成功提取 sessionContentMtime 源码', !!fnMtime && fnMtime.includes('isFile'), fnMtime ? 'len=' + fnMtime.length : '未找到');
  if (fnAlign && fnMtime) {
    const factory = new Function('fs', 'path', fnAlign + '\n' + fnMtime + '\nreturn { alignTreeTimestamps, sessionContentMtime };');
    const { alignTreeTimestamps, sessionContentMtime } = factory(fs, path);

    // 6c：alignTreeTimestamps 把复制后的目标时间对齐回源时间（含目录）
    const t = path.join(TMP, 'mirror');
    fs.rmSync(t, { recursive: true, force: true });
    const sRoot = path.join(t, 'src');
    const tRoot = path.join(t, 'dst');
    fs.mkdirSync(path.join(sRoot, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(sRoot, 'a', 'b', 'x.jsonl'), 'hello');
    const past = new Date('2026-01-01T00:00:00Z');
    const pastMs = past.getTime();
    for (const p of [path.join(sRoot, 'a', 'b', 'x.jsonl'), path.join(sRoot, 'a', 'b'), path.join(sRoot, 'a'), sRoot]) {
      fs.utimesSync(p, past, past);
    }
    fs.cpSync(sRoot, tRoot, { recursive: true }); // 模拟不带 preserveTimestamps 的复制
    const beforeFile = fs.statSync(path.join(tRoot, 'a', 'b', 'x.jsonl')).mtimeMs;
    alignTreeTimestamps(sRoot, tRoot);
    const afterFile = fs.statSync(path.join(tRoot, 'a', 'b', 'x.jsonl')).mtimeMs;
    const afterDir = fs.statSync(path.join(tRoot, 'a', 'b')).mtimeMs;
    rec('T6c 复制出目标文件（前置）', fs.existsSync(path.join(tRoot, 'a', 'b', 'x.jsonl')), 'cpSync 后 mtime=' + new Date(beforeFile).toISOString() + '（是否保留取决于平台）');
    rec('T6d align 后文件 mtime 对齐到源时间', Math.abs(afterFile - pastMs) < 2000, 'after=' + new Date(afterFile).toISOString() + ' 期望≈' + past.toISOString());
    rec('T6e align 后目录 mtime 也对齐（目录最后设置生效）', Math.abs(afterDir - pastMs) < 2000, 'dir=' + new Date(afterDir).toISOString());

    // 6f：sessionContentMtime 只统计文件，忽略目录 mtime（ping-pong 根因修复）
    const wb = path.join(t, 'wb');
    fs.mkdirSync(path.join(wb, 'projects', 'p1', 'sid1'), { recursive: true });
    fs.writeFileSync(path.join(wb, 'projects', 'p1', 'sid1.jsonl'), 'x');
    fs.writeFileSync(path.join(wb, 'projects', 'p1', 'sid1', 'a.txt'), 'y');
    const fileMs = new Date('2026-02-02T00:00:00Z').getTime();
    fs.utimesSync(path.join(wb, 'projects', 'p1', 'sid1.jsonl'), new Date(fileMs), new Date(fileMs));
    fs.utimesSync(path.join(wb, 'projects', 'p1', 'sid1', 'a.txt'), new Date(fileMs), new Date(fileMs));
    const nowD = new Date();
    for (const p of [path.join(wb, 'projects', 'p1', 'sid1'), path.join(wb, 'projects', 'p1'), path.join(wb, 'projects')]) {
      fs.utimesSync(p, nowD, nowD);
    }
    const m = sessionContentMtime(wb, 'sid1');
    rec('T6f sessionContentMtime 只算文件、忽略目录（不会永远显得更新）', Math.abs(m - fileMs) < 2000,
      'mtime=' + new Date(m).toISOString() + ' 期望≈' + new Date(fileMs).toISOString() + '（目录 mtime 已是现在）');
  }

  // ── T8 抗崩溃：收件箱目录不可建时不能让异常冒泡（否则 daemon 整体退出）──
  section('T8 抗崩溃（1.2.9 修复）');
  const { importAgentInbox } = require(path.join(RUNTIME, 'automation.js'));
  const blocker = path.join(TMP, 'not-a-dir');
  try { fs.rmSync(blocker, { recursive: true, force: true }); } catch (_) {}
  fs.writeFileSync(blocker, 'x');
  let inboxThrew = null;
  let inboxOut = null;
  try { inboxOut = importAgentInbox(path.join(blocker, 'child'), { profileId: 'workbuddy-cn' }); }
  catch (e) { inboxThrew = e; }
  rec('T8 收件箱目录不可建时返回空数组而非抛异常',
    inboxThrew === null && Array.isArray(inboxOut) && inboxOut.length === 0,
    inboxThrew ? ('抛出: ' + inboxThrew.message) : '返回 ' + JSON.stringify(inboxOut));
  const daemonSrcEarly = fs.readFileSync(path.join(RUNTIME, 'daemon.js'), 'utf8');
  rec('T8b daemon 启动阶段对 ensureAgentBridge 做了降级保护',
    /try \{\s*\n\s*ensureAgentBridge\(DATA_DIR/.test(daemonSrcEarly),
    '源码中 ensureAgentBridge 调用点已包 try/catch');

  // ── T9 CDP 隔离加固（1.2.9 修复）──
  section('T9 CDP 隔离加固（1.2.9 修复）');
  rec('T9 cdpPortOwnedByOtherProfile 不再被 WBSWITCH_CDP_PORT 一票否决',
    !/if \(process\.env\.WBSWITCH_CDP_PORT\) return false/.test(daemonSrcEarly),
    '源码中已无该短路语句');
  rec('T9b 回退端口已按 profile 分段（CDP_FALLBACK_BASE）',
    /const CDP_FALLBACK_BASE = \{/.test(daemonSrcEarly), '存在 CDP_FALLBACK_BASE 定义');
  const fnCandidates = extractFn(daemonSrcEarly, 'cdpPortCandidates');
  rec('T9c cdpPortCandidates 里不再共用 9222-9232 / 9333 回退段',
    !!fnCandidates && !fnCandidates.includes('9222; port <= 9232') && !fnCandidates.includes('add(9333)'),
    fnCandidates ? 'len=' + fnCandidates.length : '未提取到');

  // ── T10 弹窗自动点允许：扣费防护取样范围（1.2.10 修复）──
  section('T10 弹窗自动点允许（1.2.10 修复）');
  const injectSrc = fs.readFileSync(path.join(RUNTIME, 'inject.js'), 'utf8');
  rec('T10 存在页面根判定 ndIsPageRoot',
    /function ndIsPageRoot\(el\)/.test(injectSrc), '已定义 ndIsPageRoot');
  const fnCreditText = extractFn(injectSrc, 'ndCreditText');
  rec('T10b 扣费取样排除页面根',
    !!fnCreditText && /ndIsPageRoot\(el\)/.test(fnCreditText), fnCreditText ? 'len=' + fnCreditText.length : '未提取到');
  const fnCtx = extractFn(injectSrc, 'ndApprovalContext');
  rec('T10c 扣费探测循环在页面根处中断',
    !!fnCtx && /ndIsPageRoot\(creditBox\)\)\s*break/.test(fnCtx), fnCtx ? 'len=' + fnCtx.length : '未提取到');
  rec('T10d 主循环不再把 body/html 当决策容器',
    !!fnCtx && /if \(ndIsPageRoot\(box\)\) break;/.test(fnCtx), '已加页面根短路');
  rec('T10e 扣费取样上限常量存在',
    /var ND_CREDIT_SCOPE_MAX = 1200;/.test(injectSrc), 'ND_CREDIT_SCOPE_MAX=1200');

  // ── T11 快捷短语随账号导出 / 导入去重（1.2.11）──
  section('T11 快捷短语随账号导出 / 导入去重');
  // 源码级：合并函数按 text 去重；导出 payload 带 phrases；导入走合并并回传计数
  const fnMerge = extractFn(daemonSrc, 'mergeQuickPhrases');
  rec('T11 提取到 mergeQuickPhrases 源码且按 text 去重',
    !!fnMerge && fnMerge.includes('existing.has(text)'), fnMerge ? 'len=' + fnMerge.length : '未找到');
  rec('T11b 账号导出 payload 带上 phrases 字段',
    /exportType: 'LDCodex-accounts', version: 2, accounts: items, phrases/.test(daemonSrc), '导出 payload 已含 phrases');
  rec('T11c 账号导入调用 mergeQuickPhrases 合并',
    /const merged = mergeQuickPhrases\(incomingPhrases\)/.test(daemonSrc), '导入已走去重合并');
  rec('T11d 账号导入响应回传 phrasesImported / phrasesSkipped',
    /phrasesImported, phrasesSkipped/.test(daemonSrc), '响应字段已加');

  // 行为级：真实 HTTP 走一遍（在隔离 daemon 的独立 data4 上，不影响用户数据）
  const beforeQp = await api('/api/session-module');
  const seedIds = (beforeQp.body && Array.isArray(beforeQp.body.phrases)) ? beforeQp.body.phrases.map((x) => x.id) : [];
  if (seedIds.length) await api('/api/quick-phrase-delete', { method: 'POST', body: { ids: seedIds } });
  for (const text of ['T11 常用语甲', 'T11 常用语乙', 'T11 常用语丙']) {
    await api('/api/quick-phrase-add', { method: 'POST', body: { text } });
  }
  const afterAdd = await api('/api/session-module');
  const curList = (afterAdd.body && Array.isArray(afterAdd.body.phrases)) ? afterAdd.body.phrases : [];
  rec('T11e 通过接口写入 3 条常用语', curList.length === 3, 'phrases=' + JSON.stringify(curList.map((x) => x.text)));

  // 隔离回归：settings.json 是「客户端自己的」配置文件，位置由 profile 决定，不跟随
  // WBSWITCH_DATA_DIR。若不加隔离开关，测试用语会写进用户真实的 ~/.workbuddy/settings.json
  // ——既污染用户配置，又让本用例受上一轮残留影响而随机失败（实测：T11e 期望 3 条却拿到 4 条）。
  const isoSettings = path.join(DATA_DIR, 'settings.json');
  const realSettings = path.join(os.homedir(), '.workbuddy', 'settings.json');
  let isoHas = false;
  let realLeak = false;
  try { isoHas = /T11 常用语甲/.test(fs.readFileSync(isoSettings, 'utf8')); } catch (_) {}
  try { realLeak = /T11 常用语甲/.test(fs.readFileSync(realSettings, 'utf8')); } catch (_) {}
  rec('T11l 测试用语只写入隔离 settings.json，不污染用户真实配置',
    isoHas && !realLeak, 'isolatedSettings=' + isoHas + ', leakedToUserConfig=' + realLeak);

  // 导出：响应带 phraseCount，且文件解密后确实含 phrases 数组
  const { openEncryptedExport } = require(path.join(RUNTIME, 'secure-transfer.js'));
  const exportPath2 = path.join(TMP, 'export-phrases.json');
  try { fs.rmSync(exportPath2, { force: true }); } catch (_) {}
  const exp2 = await api('/api/accounts/export', { method: 'POST', body: { password: PW, saveTo: exportPath2 } });
  rec('T11f 导出响应 phraseCount=3', exp2.body && exp2.body.phraseCount === 3, JSON.stringify(exp2.body));
  let decoded = null;
  try { decoded = openEncryptedExport(fs.readFileSync(exportPath2, 'utf8'), 'accounts', PW); } catch (e) { decoded = { error: e.message }; }
  rec('T11g 导出文件解密后含 3 条 phrases（纯文本 + createdAt）',
    !!(decoded && Array.isArray(decoded.phrases) && decoded.phrases.length === 3
      && decoded.phrases.every((x) => typeof x.text === 'string' && Number.isFinite(Number(x.createdAt)))),
    decoded && decoded.phrases ? JSON.stringify(decoded.phrases.map((x) => x.text)) : JSON.stringify(decoded));

  // 造「2 条重复 + 1 条全新」的导入文件，验证先查重再追加
  const dupPayload = {
    exportType: 'LDCodex-accounts',
    version: 2,
    accounts: [{ uid, info: acctInfo }],
    phrases: [
      { text: 'T11 常用语甲', createdAt: Date.now() },
      { text: 'T11 常用语乙', createdAt: Date.now() },
      { text: 'T11 常用语丁', createdAt: Date.now() },
    ],
  };
  const dupPath = path.join(TMP, 'dup-phrases.json');
  fs.writeFileSync(dupPath, createEncryptedExport('accounts', dupPayload, PW));
  const dupRes = await api('/api/accounts/import', { method: 'POST', body: { path: dupPath, password: PW } });
  rec('T11h 导入时相同文案跳过、新文案追加（新增 1 / 跳过 2）',
    !!(dupRes.body && dupRes.body.ok === true && dupRes.body.phrasesImported === 1 && dupRes.body.phrasesSkipped === 2),
    JSON.stringify(dupRes.body));
  const afterImp = await api('/api/session-module');
  const finalTexts = (afterImp.body && Array.isArray(afterImp.body.phrases)) ? afterImp.body.phrases.map((x) => x.text) : [];
  const textCount = {};
  finalTexts.forEach((t) => { textCount[t] = (textCount[t] || 0) + 1; });
  rec('T11i 最终列表 4 条、无重复且含新文案',
    finalTexts.length === 4 && finalTexts.includes('T11 常用语丁') && Object.keys(textCount).every((k) => textCount[k] === 1),
    JSON.stringify(finalTexts));

  // 幂等：同一个文件再导一次，全部重复 → 新增 0
  const dupRes2 = await api('/api/accounts/import', { method: 'POST', body: { path: dupPath, password: PW } });
  rec('T11j 重复导入幂等（新增 0 / 跳过 3）',
    !!(dupRes2.body && dupRes2.body.ok === true && dupRes2.body.phrasesImported === 0 && dupRes2.body.phrasesSkipped === 3),
    JSON.stringify(dupRes2.body));

  // 向后兼容：旧版导出文件没有 phrases 字段，导入不应报错、短语列表不变
  const legacyPath = path.join(TMP, 'legacy-accounts.json');
  fs.writeFileSync(legacyPath, createEncryptedExport('accounts',
    { exportType: 'LDCodex-accounts', version: 2, accounts: [{ uid, info: acctInfo }] }, PW));
  const legacyRes = await api('/api/accounts/import', { method: 'POST', body: { path: legacyPath, password: PW } });
  const afterLegacy = await api('/api/session-module');
  const legacyTexts = (afterLegacy.body && Array.isArray(afterLegacy.body.phrases)) ? afterLegacy.body.phrases.map((x) => x.text) : [];
  rec('T11k 旧版导出文件（无 phrases）仍可导入，短语列表不变',
    !!(legacyRes.body && legacyRes.body.ok === true && Number(legacyRes.body.phrasesImported || 0) === 0 && legacyTexts.length === 4),
    JSON.stringify(legacyRes.body) + ' phrases=' + legacyTexts.length);

  // ── T12 上弹面板「添加常用语」入口（inject.js 源码级）──
  section('T12 上弹面板「添加」入口（inject.js）');
  rec('T12 面板底部存在「添加」按钮 #wbs-explore-add',
    /id="wbs-explore-add"/.test(injectSrc) && /wbs-explore-add/.test(injectSrc), '按钮已加入 explore 面板');
  rec('T12b 存在行内新增流程 exploreAddRow / exploreSaveRow / exploreEndEdit',
    /function exploreAddRow\(\)/.test(injectSrc) && /function exploreSaveRow\(row\)/.test(injectSrc) && /function exploreEndEdit\(\)/.test(injectSrc),
    '三个函数均已定义');
  rec('T12c Ctrl/Cmd+Enter 在捕获阶段保存（防客户端抢发送）',
    /\(e\.ctrlKey \|\| e\.metaKey\) && e\.key === 'Enter'/.test(injectSrc) && /exploreSaveRow\(row\)/.test(injectSrc),
    '键盘处理已加');
  rec('T12d 编辑期间强制展开（wbs-explore-editing 覆盖 wbs-menu-closed）',
    /\.wbs-explore-inline\.wbs-explore-editing\.wbs-menu-closed \.wbs-explore-pop/.test(injectSrc),
    '编辑态样式已加');
  const fnRender = extractFn(injectSrc, 'renderExploreOptions');
  rec('T12e 编辑期间不重建列表（防草稿被 innerHTML 冲掉）',
    !!fnRender && /if \(exploreEditRow\) return;/.test(fnRender), fnRender ? 'len=' + fnRender.length : '未提取到');
  const fnMenuClose = extractFn(injectSrc, 'acMenuClose');
  rec('T12f 关闭面板时收掉行内新增',
    !!fnMenuClose && /exploreEndEdit\(\)/.test(fnMenuClose), fnMenuClose ? 'len=' + fnMenuClose.length : '未提取到');
  rec('T12g 底部右侧文案为「进入插件设置」（原「编辑 →」已替换）',
    /进入插件设置<\/a>/.test(injectSrc) && !/编辑 →<\/a>/.test(injectSrc),
    '文案已更新，且旧文案不再出现');
  rec('T12h 「进入插件设置」已收录英文词条',
    /'进入插件设置': 'Open plugin settings'/.test(injectSrc), '英文词条已加');
  rec('T12i 该链接设了 white-space:nowrap（防中文折行）',
    /\.wbs-explore-edit\{[^}]*white-space:nowrap/.test(injectSrc), 'nowrap 已加');

  // ── T13 任务栏不产生幽灵图标（1.2.12）──
  // 背景：用户反馈「只要用了这个软件增加功能，任务栏上会多出一个国内版和国际版的图标」。
  // 根因是窗口激活逻辑会强行 SW_SHOW 客户端进程里隐藏的辅助窗口（OLE 消息窗口等）。
  // 这里做源码级断言：修复必须长期在位，不能被后续改动回退掉。
  section('T13 任务栏不产生幽灵图标');
  const WIN_INTEG = 'D:/LUODA/LDcodex/crates/codex-plus-core/src/windows_integration.rs';
  const winSrc = fs.readFileSync(WIN_INTEG, 'utf8');
  const fnActivate = extractRustFn(winSrc, 'activate_process_window');
  const fnFront = extractRustFn(winSrc, 'bring_window_to_front');
  const fnGenuine = extractRustFn(winSrc, 'is_genuine_app_window');

  rec('T13 窗口激活优先只在"已可见"集合里挑（visible_only=true）',
    !!fnActivate && /process_window\(process_id, true\)/.test(fnActivate),
    fnActivate ? 'len=' + fnActivate.length : '未提取到 activate_process_window');
  rec('T13b 兜底恢复隐藏窗口前必须过 is_genuine_app_window 校验',
    !!fnActivate && /if !is_genuine_app_window\(hwnd\) \{\s*return false;\s*\}/.test(fnActivate),
    '隐藏窗口不再被无条件显示');
  rec('T13c 「真·应用窗口」判定：有标题 + 非工具窗口 + 非辅助类 + 无 owner',
    !!fnGenuine && /GetWindowTextLengthW\(hwnd\)\s*\}\s*<=\s*0/.test(fnGenuine)
      && /WS_EX_TOOLWINDOW\.0 != 0/.test(fnGenuine)
      && /is_auxiliary_window_class\(&class_name\)/.test(fnGenuine)
      && /GetWindow\(hwnd, GW_OWNER\)/.test(fnGenuine) && /owner\.is_invalid\(\)/.test(fnGenuine),
    fnGenuine ? 'len=' + fnGenuine.length : '未提取到 is_genuine_app_window');
  rec('T13c2 不依赖 WS_EX_APPWINDOW（实机主窗口没有该样式位，要求它会弄坏托盘恢复）',
    !!fnGenuine && !/WS_EX_APPWINDOW\.0 != 0/.test(fnGenuine),
    '未把 WS_EX_APPWINDOW 当必要条件');
  rec('T13c3 辅助窗口类黑名单含实机抓到的 OLE 消息窗口',
    /"olemainthreadwndname"/.test(winSrc) && /"olemainthreadwndclass"/.test(winSrc)
      && /"chrome_messagewindow"/.test(winSrc),
    '已收录 OleMainThreadWndName / OleMainThreadWndClass / Chrome_MessageWindow');
  rec('T13d 唯一的 ShowWindow 调用集中在 bring_window_to_front',
    !!fnFront && (winSrc.match(/ShowWindow\(/g) || []).length === 2
      && /ShowWindow\(hwnd, SW_RESTORE\)/.test(fnFront) && /ShowWindow\(hwnd, SW_SHOW\)/.test(fnFront),
    'ShowWindow 出现次数=' + (winSrc.match(/ShowWindow\(/g) || []).length + '（应为 2，全在 bring_window_to_front）');
  rec('T13e 任务栏身份改写默认关闭（避免与固定图标分成两个按钮）',
    /fn rebrand_taskbar_identity_enabled\(\) -> bool/.test(winSrc)
      && /if rebrand_taskbar_identity_enabled\(\) && apply_taskbar_properties/.test(winSrc)
      && !/if apply_taskbar_properties\(hwnd, &icon_resource_path\)\.is_ok\(\)/.test(winSrc),
    'AppUserModelID 改写已改为 LDCODEX_REBRAND_TASKBAR 门控，默认不动任务栏身份');
  rec('T13f 窗口图标品牌化保留（WM_SETICON 仍在）',
    /apply_window_icons\(hwnd, &icon_resource_path\)/.test(winSrc), '图标仍会换成 LDCodex');

  // daemon 侧：restoreWorkBuddyWindow 的 C# 也必须做同样的过滤
  const fnRestore = extractFn(daemonSrc, 'restoreWorkBuddyWindow');
  rec('T13g daemon 恢复窗口时跳过工具窗口/无标题窗口',
    !!fnRestore && /WS_EX_TOOLWINDOW = 0x00000080/.test(fnRestore)
      && /WS_EX_APPWINDOW = 0x00040000/.test(fnRestore)
      && /GetWindowTextLength\(hWnd\) <= 0\) return true;/.test(fnRestore),
    fnRestore ? 'len=' + fnRestore.length : '未提取到 restoreWorkBuddyWindow');
  rec('T13h daemon 不再对枚举到的第一个窗口无脑 SW_RESTORE',
    !!fnRestore && /if \(found == IntPtr\.Zero\) return false;/.test(fnRestore)
      && !/if \(owner == targetPid\) \{ ShowWindowAsync\(hWnd, 9\);/.test(fnRestore),
    '已改为先筛选候选再恢复');
  rec('T13i daemon 版本已统一为 88.8.3',
    /const DAEMON_VERSION = '88\.8\.3';/.test(daemonSrc), 'DAEMON_VERSION=88.8.3');

  // ── T14 版本号统一（约定：当前基线 88.8.3，以后每升级一次加 1）──
  // 背景：用户要求「软件的版本号统一为 88.8.1，以后每升级一次升一个」。此前各生态版本号各自为政
  // （安装包 1.2.56 / 运行时 package.json 1.2.11 / daemon 1.2.12）。这里做源码级
  // 断言，守住「所有版本号来源必须完全一致」这条约定，防止后续升级只改一半。
  // 升级步骤：改下方 UNIFIED_VERSION + 6 处版本号来源，本系列会逐条校验是否漏改。
  section('T14 版本号统一为 88.8.3');
  const UNIFIED_VERSION = '88.8.3';
  const readJsonVersion = (rel) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(RUNTIME, rel), 'utf8')).version || null;
    } catch (_) { return null; }
  };
  const runtimePkgVersion = readJsonVersion('package.json');
  const managerPkgVersion = readJsonVersion(path.join('..', '..', 'package.json'));
  const tauriConfVersion = readJsonVersion(path.join('..', 'tauri.conf.json'));
  const cargoToml = (() => {
    try {
      return fs.readFileSync(path.join(RUNTIME, '..', '..', '..', '..', 'Cargo.toml'), 'utf8');
    } catch (_) { return ''; }
  })();
  const cargoVersion = (cargoToml.match(/\[workspace\.package\][\s\S]*?version\s*=\s*"([^"]+)"/) || [])[1] || null;
  rec('T14 daemon 运行时版本 = ' + UNIFIED_VERSION,
    new RegExp("const DAEMON_VERSION = '" + UNIFIED_VERSION.replace(/\./g, '\\.') + "';").test(daemonSrc),
    'DAEMON_VERSION');
  rec('T14b 运行时 package.json 版本 = ' + UNIFIED_VERSION,
    runtimePkgVersion === UNIFIED_VERSION, 'version=' + runtimePkgVersion);
  rec('T14c 管理器 package.json 版本 = ' + UNIFIED_VERSION,
    managerPkgVersion === UNIFIED_VERSION, 'version=' + managerPkgVersion);
  rec('T14d tauri.conf.json 版本 = ' + UNIFIED_VERSION,
    tauriConfVersion === UNIFIED_VERSION, 'version=' + tauriConfVersion);
  rec('T14e Cargo 工作区版本 = ' + UNIFIED_VERSION + '（各 Rust crate 继承此值）',
    cargoVersion === UNIFIED_VERSION, 'workspace.package.version=' + cargoVersion);
  rec('T14f DAEMON_BUILD_ID 与版本号一致',
    new RegExp("const DAEMON_BUILD_ID = 'release-" + UNIFIED_VERSION.replace(/\./g, '\\.') + "-").test(daemonSrc),
    'buildId 前缀已对齐');

  // ── T15 账号使用次数统计（「哪个账号被用过、切换了几次」）──
  // 需求：「如果我今天哪一个被切换了几个，做个记数，我就知道哪个帐号是被用过了」。
  // 注意：这里**不做**真实的 /api/switch 端到端调用 —— switchTo 会写客户端**真实**的
  // 登录文件（隔离实例只隔离数据目录，不隔离 auth 目录），会把用户当前登录顶掉。
  // 因此覆盖方式：① 存储模块直接单测；② daemon 源码级接线断言；③ 只读的 /api/accounts 断言。
  section('T15 账号使用次数统计');
  const { createAccountUsageStore } = require(path.join(RUNTIME, 'account-usage.js'));
  const usageDir = path.join(TMP, 'usage-test');
  try { fs.rmSync(usageDir, { recursive: true, force: true }); } catch (_) {
    try { fs.writeFileSync(path.join(usageDir, 'account-usage.json'), ''); } catch (_) {}
  }
  const usageStore = createAccountUsageStore(usageDir);
  const D1 = '2026-09-13';
  const D2 = '2026-09-14';

  let ur = usageStore.noteActive('99001777', { day: D1 });
  rec('T15 首次观察活跃账号即计 1 次', ur && ur.total === 1 && ur.today === 1, JSON.stringify(ur));
  ur = usageStore.noteActive('99001777', { day: D1 });
  rec('T15b 同一账号重复上报不重复计数（去重，防轮询/重启虚增）', ur.total === 1 && ur.today === 1, JSON.stringify(ur));
  ur = usageStore.noteActive('88008800', { day: D1 });
  rec('T15c 切到另一个账号各自计数', ur.total === 1 && ur.today === 1, JSON.stringify(ur));
  ur = usageStore.noteActive('99001777', { day: D1 });
  rec('T15d A→B→A 回切 A 再 +1（today=2）', ur.total === 2 && ur.today === 2, JSON.stringify(ur));
  ur = usageStore.noteActive('99001777', { day: D2 });
  rec('T15e 同一账号跨天未切换 → 不计数（只统计「切换」）', ur.total === 2 && ur.today === 0, JSON.stringify(ur));
  ur = usageStore.noteActive('88008800', { day: D2 });
  rec('T15f 新一天真实切换 → 该账号 today 从 1 重新起算、total 累加', ur.total === 2 && ur.today === 1, JSON.stringify(ur));
  const usageAll = usageStore.all(D1);
  const usageAll2 = usageStore.all(D2);
  // 只保留「当天」计数（不存历史日历）：账号的存储日一旦推进到 D2，
  // 它在 D1 视图里的 today 自然为 0。A 的存储日仍是 D1，故 D1 视图保留 2。
  rec('T15g all(day) 的 today 只反映该日切换次数（跨天后旧日视图归 0）',
    usageAll['99001777'].today === 2 && usageAll['88008800'].today === 0
      && usageAll2['99001777'].today === 0 && usageAll2['88008800'].today === 1,
    'd1=' + JSON.stringify(usageAll) + ' d2=' + JSON.stringify(usageAll2));
  rec('T15h 非法 uid 不计数（拒绝路径穿越等）',
    usageStore.noteActive('') === null && usageStore.noteActive('../evil') === null, 'null');
  rec('T15i 统计落盘为合法 JSON 且带 lastActiveUid',
    (() => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(usageDir, 'account-usage.json'), 'utf8'));
        return raw.lastActiveUid === '88008800' && !!raw.accounts['99001777'];
      } catch (_) { return false; }
    })(), 'account-usage.json');
  rec('T15j 文件损坏时退化为空统计、不抛错（不影响切换主流程）',
    (() => {
      try { fs.writeFileSync(path.join(usageDir, 'account-usage.json'), '{ 坏文件'); } catch (_) {}
      return usageStore.get('99001777').total === 0 && usageStore.all()['99001777'] === undefined;
    })(), 'graceful');

  // daemon 接线：两个切换入口都要记账
  rec('T15k daemon 引入并实例化 accountUsageStore',
    /require\('\.\/account-usage\.js'\)/.test(daemonSrc) && /const accountUsageStore = createAccountUsageStore\(DATA_DIR\)/.test(daemonSrc),
    'account-usage.js 已接入');
  rec('T15l /api/switch 切换成功后记账',
    /const acct = switchTo\(DATA_DIR, uid, log\);[\s\S]{0,400}?noteAccountUsage\(acct\.uid\)/.test(daemonSrc),
    '显式切换已记账');
  const fnAutoSwitch = extractFn(daemonSrc, 'automationSwitchAccount');
  rec('T15m 自动化切换账号也记账',
    !!fnAutoSwitch && /switchTo\(DATA_DIR, uid, log\);[\s\S]{0,200}?noteAccountUsage\(acct\.uid\)/.test(fnAutoSwitch),
    fnAutoSwitch ? 'len=' + fnAutoSwitch.length : '未提取到 automationSwitchAccount');
  rec('T15n /api/accounts 顺带观察活跃账号（客户端里直接换号也能记上）',
    /const activeAccount = currentAccount\(\);[\s\S]{0,200}?noteAccountUsage\(activeAccount\.uid\)/.test(daemonSrc),
    '观察点已加');
  rec('T15o /api/accounts 每个账号返回 usage 字段',
    /usage: usageByUid\[a\.uid\] \|\| emptyUsage/.test(daemonSrc), 'usage 已随账号下发');

  // 只读接口断言：真实隔离 daemon 返回的账号对象必须带 usage
  const accRes = await api('/api/accounts');
  const accList = Array.isArray(accRes.body && accRes.body.accounts) ? accRes.body.accounts : [];
  rec('T15p /api/accounts 每个账号都带合法 usage 结构',
    accRes.status === 200 && accList.length > 0 && accList.every((a) =>
      a.usage && typeof a.usage === 'object'
      && Number.isFinite(Number(a.usage.total)) && Number.isFinite(Number(a.usage.today))
      && typeof a.usage.lastAt === 'string'),
    'accounts=' + accList.length + ', sample=' + JSON.stringify(accList[0] && accList[0].usage));

  // ── T16 插件（inject.js）账号使用次数徽标 ──
  section('T16 插件侧账号使用次数（inject.js）');
  rec('T16a 定义了 accountUsageBadgeHtml',
    /function accountUsageBadgeHtml\(a\)/.test(injectSrc), '函数已定义');
  rec('T16b 账号卡片拼接包含 usageBadge（紧跟签到徽标之后）',
    /\+ primaryBadge \+ badge \+ checkinBadge \+ usageBadge \+/.test(injectSrc)
      && /var usageBadge = accountUsageBadgeHtml\(a\);/.test(injectSrc),
    '卡片已接入徽标');
  const fnLayoutKey = extractFn(injectSrc, 'accountCardLayoutKey');
  rec('T16c 布局指纹纳入 usage.total / usage.today（否则次数变化不重建卡片）',
    !!fnLayoutKey && /a\.usage && a\.usage\.total\) \|\| 0/.test(fnLayoutKey) && /a\.usage && a\.usage\.today\) \|\| 0/.test(fnLayoutKey),
    fnLayoutKey ? 'len=' + fnLayoutKey.length : '未提取到');
  rec('T16d 徽标样式已定义（ok / pending / 暗色）',
    /\.wbs-usage-count\.ok\{/.test(injectSrc) && /\.wbs-usage-count\.pending\{/.test(injectSrc)
      && /data-theme="dark"\] \.wbs-usage-count\.ok/.test(injectSrc),
    '样式已加');
  rec('T16e 英文词条齐全（含命名占位符）',
    /'用过 \{n\} 次 · 今日 \{m\} 次': 'Used \{n\}× · \{m\} today'/.test(injectSrc)
      && /'尚未用过': 'Never used'/.test(injectSrc)
      && /'尚未切换使用过': 'Never switched'/.test(injectSrc)
      && /'最后使用 \{t\}': 'Last used \{t\}'/.test(injectSrc)
      && /'切换使用次数': 'Switch count'/.test(injectSrc),
    '5 条词条已加');

  // 功能级：把 accountUsageBadgeHtml 抽出来在 stub 环境里真跑一遍
  const fnUsage = extractFn(injectSrc, 'accountUsageBadgeHtml');
  let renderUsage = null;
  if (fnUsage) {
    const stubFmt = (ts) => {
      const d = new Date(ts);
      const p = (n) => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    };
    const stubEscAttr = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    try {
      renderUsage = new Function('fmtDateTime', 'escAttr', fnUsage + '\nreturn accountUsageBadgeHtml;')(stubFmt, stubEscAttr);
    } catch (e) { renderUsage = null; }
  }
  const htmlUsed = renderUsage ? renderUsage({ usage: { total: 3, today: 1, lastAt: '2026-09-13T05:20:00.000Z' } }) : '';
  rec('T16f 用过 N 次 → 输出「用过 3 次 · 今日 1 次」+ ok 态 + 最后使用时间',
    !!htmlUsed && htmlUsed.indexOf('用过 3 次 · 今日 1 次') >= 0
      && /class="wbs-ck wbs-checkin-tag wbs-usage-count ok"/.test(htmlUsed)
      && /title="最后使用 \d{4}-\d{2}-\d{2} \d{2}:\d{2}"/.test(htmlUsed),
    htmlUsed || '未提取到函数');
  const htmlIdle = renderUsage ? renderUsage({ usage: { total: 0, today: 0, lastAt: '' } }) : '';
  rec('T16g 从未切换过 → 输出「尚未用过」+ pending 态',
    !!htmlIdle && htmlIdle.indexOf('尚未用过') >= 0
      && /wbs-usage-count pending/.test(htmlIdle)
      && /title="尚未切换使用过"/.test(htmlIdle),
    htmlIdle || '未提取到函数');
  let htmlNull = '';
  try { htmlNull = renderUsage ? renderUsage(null) : ''; } catch (e) { htmlNull = 'THREW:' + e.message; }
  rec('T16h 账号无 usage 字段 / 传 null → 退化为「尚未用过」，不抛错',
    htmlNull.indexOf('尚未用过') >= 0 && htmlNull.indexOf('THREW') < 0,
    htmlNull || '未提取到函数');

  // ── T17 布局滚动（源码级静态守卫；行为级实测见 verify-layout-scroll.mjs）──
  // 用户反馈：「账号列表、会话列表等都超出软件窗口下部边框，看不到了」。
  // 根因见 styles.css 里 .workspace / .workbuddy-pane 的注释。这里守住这几条不变量，
  // 防止后续有人再写回「算错高度」的规则。
  section('T17 布局滚动不变量（styles.css）');
  const stylesSrc = fs.readFileSync(path.join(RUNTIME, '..', '..', 'src', 'styles.css'), 'utf8');
  // 先把注释剥掉再匹配规则：否则「注释里提到的旧写法」会被误判成「还在用旧写法」，
  // 也会让「上一条规则 } 与目标选择器之间的注释块」打断匹配。
  const stylesCode = stylesSrc.replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleOf = (selector) => {
    // 取该选择器的**所有**规则体（同选择器可能在文件里出现多次，后者覆盖前者）
    const out = [];
    const re = new RegExp('(^|\\})\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g');
    let m;
    while ((m = re.exec(stylesCode)) !== null) out.push(m[2]);
    return out;
  };
  const wsRules = ruleOf('.workspace');
  rec('T17a .workspace 不得使用 height:100vh（它位于网格第 2 行，会高出 38px 被裁掉）',
    wsRules.length > 0 && !wsRules.some((b) => /height\s*:\s*100vh/.test(b)),
    '共 ' + wsRules.length + ' 条 .workspace 规则');
  const paneRules = ruleOf('.workbuddy-pane');
  rec('T17b .workbuddy-pane 不得使用 max-height:calc(100vh …)（估值不可靠，会顶出窗口）',
    paneRules.length > 0 && !paneRules.some((b) => /max-height\s*:\s*calc\(100vh/.test(b)),
    '共 ' + paneRules.length + ' 条 .workbuddy-pane 规则');
  rec('T17c 滚动条滑块不得再用 --hairline（与背景同色，看不见）',
    /scrollbar-color:\s*hsl\(var\(--muted-foreground\)/.test(stylesCode)
      && !/scrollbar-color:\s*hsl\(var\(--hairline\)/.test(stylesCode),
    '已改用 --muted-foreground');
  const fillRules = ruleOf('.fill').filter((b) => /min-height/.test(b));
  rec('T17d .fill 的 min-height 只保留一处定义（曾有两处 188px / 132px 互相覆盖）',
    fillRules.length === 1,
    '含 min-height 的 .fill 规则数 = ' + fillRules.length);

  // ── T18 插件面板布局（源码级静态守卫；行为级实测见 verify-plugin-layout.mjs）──
  // 用户反馈：「账号，会话，增强菜单 这些都超出了软件底边框，这个软件和 插件内的 窗口都要重新修复」。
  // 插件面板（注入到 WorkBuddy 客户端里的 .wbs-* UI，页签就是 账号/主题/会话/模型/增强/自动化/电脑/关于）
  // 之前被两处硬编码 / 估值撑爆：
  //   · inject.js 的 lockPanelHeight() 用 **JS 内联样式**把 panel 钉成 height/max-height:650px
  //     —— 内联优先级高于样式表，所以「只改 CSS」是没用的；
  //   · .wbs-body 上同时挂着 height:calc(650px - 170px) 与 max-height:calc(min(78vh,660px) - 118px)。
  // 客户端窗口一矮（≤700px），650px 的面板就装不进窗口，顶边（标题栏 + ✕ 关闭按钮）被裁到窗口外面。
  section('T18 插件面板布局不变量（inject.js）');
  const injectLayoutSrc = fs.readFileSync(path.join(RUNTIME, 'inject.js'), 'utf8');
  // 抽注入用的样式表：形如 css.textContent = [ ... ].join('');
  let pluginCss = '';
  {
    const lines = injectLayoutSrc.split(/\r?\n/);
    let s = -1;
    let e = -1;
    for (let i = 0; i < lines.length; i++) {
      if (s < 0 && /css\.textContent\s*=\s*\[\s*$/.test(lines[i])) s = i;
      if (s >= 0 && /^\s*\]\.join\(''\);\s*$/.test(lines[i])) { e = i; break; }
    }
    if (s >= 0 && e > s) {
      const chunk = lines.slice(s, e + 1).join('\n').replace(/css\.textContent\s*=\s*/, 'var __css = ');
      try { pluginCss = new Function(chunk + '\nreturn __css;')(); } catch (_) { pluginCss = ''; }
    }
  }
  rec('T18 能从 inject.js 抽出注入样式表', pluginCss.length > 10000, '长度 ' + pluginCss.length);
  const pluginCode = pluginCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const pluginRuleOf = (selector) => {
    const out = [];
    const re = new RegExp('(^|\\})\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g');
    let m;
    while ((m = re.exec(pluginCode)) !== null) out.push(m[2]);
    return out;
  };
  const panelRule = pluginRuleOf('.wbs-panel').join(' ');
  rec('T18a .wbs-panel 的高度上限必须受视口约束（不得写死 650px）',
    panelRule.length > 0 && /max-height\s*:\s*calc\(100vh/.test(panelRule) && !/max-height\s*:\s*650px/.test(panelRule),
    'max-height 约束=' + (/max-height\s*:\s*([^;]+)/.exec(panelRule) || [, '未找到'])[1]);
  rec('T18b .wbs-body 不得再写 height / max-height 估值（calc(650px…) 与 calc(min(78vh…))）',
    !/calc\(\s*650px/.test(pluginCode) && !/calc\(min\(78vh/.test(pluginCode),
    /calc\(\s*650px/.test(pluginCode) ? '仍存在 calc(650px…)' : (/calc\(min\(78vh/.test(pluginCode) ? '仍存在 calc(min(78vh…))' : '两处估值均已移除'));
  rec('T18c JS lockPanelHeight 不得把 maxHeight 钉成 650px（内联样式会盖掉 CSS）',
    !/panel\.style\.maxHeight\s*=\s*'650px'/.test(injectLayoutSrc)
      && /panel\.style\.maxHeight\s*=\s*'calc\(100vh/.test(injectLayoutSrc),
    '内联 maxHeight 已改为 calc(100vh - …)');
  const sbBad = ['.wbs-acct-list', '.wbs-sess-list', '.wbs-model-list']
    .filter((sel) => pluginRuleOf(sel).some((body) => /scrollbar-color\s*:\s*transparent/.test(body)));
  rec('T18d 账号 / 会话 / 模型列表的滚动条滑块不得是透明的（transparent 等于看不见）',
    sbBad.length === 0,
    sbBad.length ? '仍透明的选择器：' + sbBad.join(', ') : '三处都显式给了可见滑块色');

  // ── T19 安装器钩子不变量（windows/hooks.nsh）──
  // 用户反馈：装 88.8.2 时弹「无法卸载！」→ 升级中断，装完还是 88.8.1。
  // 根因：「已安装」页选「安装前卸载」会去调**旧版**卸载器，而旧卸载器删不掉正在运行的
  // LDCodexManager.exe，删完文件还在原地 → installer.nsi 的
  // ${FileExists "$INSTDIR\LDCodexManager.exe"} 命中 → MessageBox + Abort。
  // 解法：在 hooks.nsh 里注册 MUI_CUSTOMFUNCTION_GUIINIT，抢在「已安装」页面出现**之前**
  // 就把程序关干净。这一节守住这个机制，以及两条「会让 NSIS 直接编译失败」的禁令。
  section('T19 安装器钩子不变量（windows/hooks.nsh）');
  const hooksSrc = fs.readFileSync(path.join(RUNTIME, '..', 'windows', 'hooks.nsh'), 'utf8');
  // ⚠️ 先剥掉整行注释再断言：本文件的注释里**特意写了** nsis_tauri_utils:: 和 ${StrLoc}
  // 来说明「为什么不能用」，不剥的话会把注释本身当成违规用法（T17 踩过同一个坑）。
  const hooksCode = hooksSrc.split(/\r?\n/).filter((l) => !/^\s*;/.test(l)).join('\n');
  rec('T19a 必须注册 MUI_CUSTOMFUNCTION_GUIINIT 并实现 .onGUIInit 回调',
    /!define\s+MUI_CUSTOMFUNCTION_GUIINIT\s+\w+/.test(hooksCode) && /Function\s+LDCodexOnGuiInit/.test(hooksCode),
    '抢在「已安装」页面之前关掉程序，旧卸载器才无文件可锁');
  rec('T19b 不得使用 nsis_tauri_utils::（它的 !addplugindir 在 hooks.nsh 之后，会编译失败）',
    !/nsis_tauri_utils::/.test(hooksCode),
    '只使用默认插件目录里的 nsExec');
  rec('T19c 不得使用 ${StrLoc}/${StrCase}/${StrRep}（卸载区要求 un. 前缀，会编译失败）',
    !/\$\{(Un)?(StrLoc|StrCase|StrRep|StrStr|StrTrim)\}/.test(hooksCode),
    '改用 cmd /c tasklist … | find 的退出码做进程探测');
  rec('T19d 停进程必须轮询等待 + 兜底杀 daemon（不能只发一次 taskkill 就走）',
    /workbuddy-runtime/.test(hooksCode) && /\$\{Do\}/.test(hooksCode) && /taskkill \/IM LDCodexManager\.exe/.test(hooksCode),
    '轮询 + taskkill + PowerShell 兜底 daemon');
  rec('T19e 静默安装（/S）不得弹窗（否则无人值守安装会卡死）',
    /IfSilent/.test(hooksCode),
    'GUIINIT 里有 IfSilent 分支');

  // T19f：上面那个技巧**依赖一个顺序** —— hooks.nsh 必须在「第一个 MUI_LANGUAGE」之前被 include。
  // 因为 MUI2 是在第一个 MUI_LANGUAGE 时才展开 MUI_FUNCTION_GUIINIT（也就是 .onGUIInit），
  // 而 MUI_FUNCTION_GUIINIT 里才有 !ifdef MUI_CUSTOMFUNCTION_GUIINIT 那一段。
  // Tauri 哪天调整了模板里 !include 的位置，这个技巧就会静默失效（退化成只靠 PREINSTALL 兜底），
  // 所以这里直接盯住生成出来的 installer.nsi 的行号顺序。
  const genNsiPath = path.join(RUNTIME, '..', '..', '..', '..', 'target', 'release', 'nsis', 'x64', 'installer.nsi');
  let genNsi = '';
  try { genNsi = fs.readFileSync(genNsiPath, 'utf8'); } catch (_) { genNsi = ''; }
  if (!genNsi) {
    rec('T19f 生成的 installer.nsi 里 hooks.nsh 必须先于第一个 MUI_LANGUAGE 被 include',
      true, '未找到生成产物（未打包过），跳过');
  } else {
    const hooksLine = genNsi.split(/\r?\n/).findIndex((l) => /hooks\.nsh/.test(l) && /^\s*!include/.test(l));
    const langLine = genNsi.split(/\r?\n/).findIndex((l) => /!insertmacro\s+MUI_LANGUAGE/.test(l));
    rec('T19f 生成的 installer.nsi 里 hooks.nsh 必须先于第一个 MUI_LANGUAGE 被 include',
      hooksLine > 0 && langLine > 0 && hooksLine < langLine,
      'hooks.nsh 第 ' + (hooksLine + 1) + ' 行，MUI_LANGUAGE 第 ' + (langLine + 1) + ' 行');
  }

  // ── T20 安装版本核验脚本的不变量（verify-installed-version.mjs）──
  // 用户两次质问「你怎么回事？你没有构建出来新版本吗还是原来的那一版」，
  // 真实原因都是**根本没装上**（88.8.2 那次也是）。所以有了这个「源码 vs 安装目录
  // 逐文件比 sha256」的核验脚本。这一节守三件事：
  //   ① 它必须仍从 test-run.sh 被调用（否则下次没人会想起它）；
  //   ② 它必须保持**只读** —— 它跑在用户真实的安装目录上，写一下就是事故；
  //   ③ 读注册表必须带降级 —— 本机 reg.exe 在沙箱程序黑名单里（Node 侧只报
  //      `spawnSync reg EPERM`），直接判 FAIL 会把「读不到」误报成「版本不对」。
  section('T20 安装版本核验脚本不变量（verify-installed-version.mjs）');
  let ivSrc = '';
  try { ivSrc = fs.readFileSync(path.join(TMP, 'verify-installed-version.mjs'), 'utf8'); } catch (_) { ivSrc = ''; }
  rec('T20a verify-installed-version.mjs 存在', ivSrc.length > 1000, '长度 ' + ivSrc.length);

  let shSrc = '';
  try { shSrc = fs.readFileSync(path.join(TMP, 'test-run.sh'), 'utf8'); } catch (_) { shSrc = ''; }
  rec('T20b test-run.sh 必须调用它（并用 || true 保持信息性、不参与成败判定）',
    /verify-installed-version\.mjs/.test(shSrc) && /\|\|\s*true/.test(shSrc),
    '否则「本机装的是哪版」又只能靠肉眼猜');

  // 断言前先剥注释：脚本头部**特意写了** toISOString() 来说明「为什么不能用」，
  // 不剥的话会把注释本身当成违规用法（T17 / T19 踩过同一个坑）。
  const ivCode = ivSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');

  rec('T20c 必须保持只读（不得出现任何写文件 API）',
    !/(writeFileSync|appendFileSync|unlinkSync|rmSync|rmdirSync|mkdirSync|renameSync|copyFileSync|createWriteStream|writeFile\()/.test(ivCode),
    '它跑在用户的真实安装目录上，写一下就是事故');

  rec('T20d 读注册表必须带降级（reg.exe 被沙箱拦截时要降级 PowerShell，而不是判 FAIL）',
    /\breg\b/.test(ivCode) && /Get-ItemProperty/.test(ivCode) && /status: 'blocked'/.test(ivCode),
    '否则 spawnSync reg EPERM 会被误报成「版本不对」');

  rec('T20e 打时间戳不得用 toISOString()（UTC 比北京时间少 8 小时，17:15 会显示成 09:15）',
    !/toISOString\(\)/.test(ivCode),
    '要手工拼本地时间');

  // ── T7 回归 ──
  section('T7 回归');
  const sess = await api('/api/sessions');
  rec('T7 /api/sessions 可访问', sess.status === 200, 'status=' + sess.status + ', ok=' + (sess.body && sess.body.ok));
  const mirror = await api('/api/sessions/cross-profile-mirror');
  rec('T7b 镜像开关接口可用（默认关）', mirror.status === 200 && mirror.body && mirror.body.ok !== false,
    'status=' + mirror.status + ', enabled=' + (mirror.body && mirror.body.enabled));

  finish();
})().catch((e) => {
  console.log('\n[测试脚本异常] ' + (e && e.stack || e));
  finish();
});

function finish() {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.log('\n================ 汇总 ================');
  console.log('通过 ' + pass + ' / 共 ' + results.length + (fail ? ('  ❌ 失败 ' + fail) : '  ✅ 全部通过'));
  if (fail) {
    console.log('\n失败项：');
    results.filter((r) => !r.pass).forEach((r) => console.log('  - ' + r.name + '  ::  ' + r.detail));
  }
  try {
    fs.writeFileSync(path.join(TMP, 'test-report.json'), JSON.stringify({ pass, fail, total: results.length, results, at: new Date().toISOString() }, null, 2));
  } catch (_) {}
  process.exitCode = fail ? 1 : 0;
}
