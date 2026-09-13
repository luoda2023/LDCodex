'use strict';
/*
 * LDCodex daemon 1.2.11 功能测试
 * 覆盖：双开隔离自检 / 账号导出导入（含安全校验）/ 跨版本镜像收敛 / 抗崩溃 / 鉴权 /
 *       弹窗自动点允许取样范围 / 快捷短语随账号导出导入去重 / 上弹面板行内新增入口 / 回归
 * 另见 verify-no-disturb.js：单独验证「弹窗自动点允许」的判定逻辑（1.2.10 修的积分误杀）
 * 运行方式：由 test-run.sh 在同一条命令内启动隔离 daemon 后调用，避免 Windows Job Object 连带杀进程。
 */
const fs = require('node:fs');
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
  const res = await fetch(BASE + p, init);
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
    typeof b.isolated === 'boolean' && Array.isArray(b.conflicts) && Array.isArray(b.warnings) && b.daemonVersion === '1.2.11',
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
  rec('T3 导出成功（count=1）', exp.status === 200 && exp.body && exp.body.ok === true && exp.body.count === 1, JSON.stringify(exp.body));
  rec('T3b 导出文件落盘', fs.existsSync(exportPath), exportPath);
  let raw = '';
  try { raw = fs.readFileSync(exportPath, 'utf8'); } catch (_) {}
  rec('T3c 导出内容已加密（不含明文 uid、含 wbsExport 标记）', raw.includes('wbsExport') && !raw.includes(uid), 'len=' + raw.length);

  // 往返：先删本地备份，再导入还原
  fs.rmSync(path.join(accountsDir, uid + '.info'), { force: true });
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
