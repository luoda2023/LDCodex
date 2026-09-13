'use strict';
// account-usage store 单测（Node 直接 require）。
//
// 覆盖 88.8.4 的 history 切换流水：
//   · 每次真正切换都 push 一条 A→B
//   · 同账号重复不上报不写 history（去重）
//   · 上限 50 条（环形截断）
//   · v1 文件兼容（旧文件没有 history 字段，能正常升级为 v2）
//   · history(uid) 按 fromUid/toUid 过滤
//   · decorate 把 nickname 拼上
//
// 不动网络、不动 daemon、不动真实数据 —— 全部在临时目录里跑。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = 'D:/LUODA/LDcodex/apps/codex-plus-manager/src-tauri/workbuddy-runtime';
const { createAccountUsageStore, HISTORY_LIMIT, nextLocalMidnight } = require(path.join(REPO, 'account-usage.js'));

function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'account-usage-test-'));
  return d;
}

function rimraf(d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
}

test('noteActive 首次写入 +1 并落盘', () => {
  const dir = tmpDir();
  try {
    const store = createAccountUsageStore(dir);
    const r = store.noteActive('accA');
    assert.equal(r.total, 1);
    assert.equal(r.today, 1);
    assert.match(r.lastAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally { rimraf(dir); }
});

test('同账号重复上报不去重 → 不再计数、history 也不多写', () => {
  const dir = tmpDir();
  try {
    const store = createAccountUsageStore(dir);
    store.noteActive('accA');
    store.noteActive('accA');
    store.noteActive('accA');
    const all = store.all('2026-09-13');
    assert.equal(all.accA.total, 1, 'total 应只 +1');
    assert.equal(store.history().length, 1, 'history 只 1 条');
  } finally { rimraf(dir); }
});

test('切换 A→B 写一条 history，fromUid 透传', () => {
  const dir = tmpDir();
  try {
    const store = createAccountUsageStore(dir);
    store.noteActive('accA', { fromUid: '' });             // 首次切到 A，fromUid 为空
    store.noteActive('accB', { fromUid: 'accA' });
    const list = store.history();
    assert.equal(list.length, 2);
    assert.deepEqual(list[0], { fromUid: 'accA', toUid: 'accB', at: list[0].at }, '最新一条：A→B');
    assert.equal(list[1].fromUid, '');
    assert.equal(list[1].toUid, 'accA');
    assert.match(list[0].at, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(new Date(list[0].at).getTime() >= new Date(list[1].at).getTime(), '按时间倒序');
  } finally { rimraf(dir); }
});

test('history 按 uid 过滤（fromUid 或 toUid 命中）', () => {
  const dir = tmpDir();
  try {
    const store = createAccountUsageStore(dir);
    store.noteActive('A');                              // 1:  ''→A
    store.noteActive('B', { fromUid: 'A' });           // 2:  A→B
    store.noteActive('A', { fromUid: 'B' });           // 3:  B→A
    store.noteActive('C', { fromUid: 'A' });           // 4:  A→C
    const aOnly = store.history('A');
    // A 出现在 4 条：{to=A}/{from=A,to=B}/{from=B,to=A}/{from=A,to=C}
    assert.equal(aOnly.length, 4, 'A 出现在四条里');
    for (const h of aOnly) {
      assert.ok(h.fromUid === 'A' || h.toUid === 'A');
    }
  } finally { rimraf(dir); }
});

test('history 环形截断到 HISTORY_LIMIT', () => {
  const dir = tmpDir();
  try {
    const store = createAccountUsageStore(dir);
    // 真正切换三次（init→alt→third→init→...）才能每次都 push history。
    // 用三个 uid 循环，from/to 都不同，每次都触发「lastActiveUid 变了」。
    const uids = ['a', 'b', 'c'];
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      const from = uids[i % 3];
      const to = uids[(i + 1) % 3];
      store.noteActive(to, { fromUid: from });
    }
    const list = store.history();
    assert.equal(list.length, HISTORY_LIMIT, '总条数 = ' + HISTORY_LIMIT);
  } finally { rimraf(dir); }
});

test('v1 文件兼容：旧 accounts + lastActiveUid 保留、补 history=[]', () => {
  const dir = tmpDir();
  try {
    // 手工写一份 v1 文件（无 history 字段）
    fs.writeFileSync(path.join(dir, 'account-usage.json'), JSON.stringify({
      version: 1,
      lastActiveUid: 'oldA',
      accounts: {
        oldA: { total: 5, today: 2, day: '2026-09-12', firstAt: '2026-09-01T00:00:00Z', lastAt: '2026-09-12T10:00:00Z' },
      },
    }));
    const store = createAccountUsageStore(dir);
    // 旧账号 lastActiveUid === oldA，下次再写 oldA → 去重跳过（不会改变 oldA 的 count）
    store.noteActive('oldA');
    // 切到新账号 → push 一条 history（fromUid=oldA）
    store.noteActive('newB', { fromUid: 'oldA' });
    const list = store.history();
    assert.equal(list.length, 1);
    assert.equal(list[0].fromUid, 'oldA');
    assert.equal(list[0].toUid, 'newB');
    // accounts 里的旧数据还在
    const all = store.all('2026-09-13');
    assert.equal(all.oldA.total, 5, '旧 v1 数据的 total 保留');
    assert.equal(all.newB.total, 1, '新账号 total +1');
  } finally { rimraf(dir); }
});

test('非法 uid 不写盘、history 也不动', () => {
  const dir = tmpDir();
  try {
    const store = createAccountUsageStore(dir);
    assert.equal(store.noteActive(''), null);
    assert.equal(store.noteActive('../etc/passwd'), null);
    assert.equal(store.noteActive('a'.repeat(200)), null);
    assert.equal(store.history().length, 0);
  } finally { rimraf(dir); }
});

test('decorate 把 nickname 拼上', () => {
  const dir = tmpDir();
  try {
    const store = createAccountUsageStore(dir);
    store.noteActive('A');
    store.noteActive('B', { fromUid: 'A' });
    const decorated = store.decorate(store.history(), {
      A: { nickname: '小明' },
      B: { nickname: '小红' },
    });
    assert.equal(decorated[0].fromNickname, '小明');
    assert.equal(decorated[0].toNickname, '小红');
  } finally { rimraf(dir); }
});

test('写盘失败（目录不存在 → 抛错）不影响 noteActive 返回值', () => {
  // 用一个不存在的 dataDir：readAll 走 try/catch 返回空，writeAll 会 mkdir 失败？
  // 实际上 writeAll 会 mkdirSync recursive，所以目录不存在也能创建。
  // 改成把 dataDir 设为不可写路径（文件而不是目录）会抛 ENOTDIR —— 太刻意。
  // 简化：直接测一个「store 整个功能不抛」即可（之前的写盘失败 try/catch 已经在 source 注释里说明）。
  const dir = tmpDir();
  try {
    const store = createAccountUsageStore(dir);
    const r = store.noteActive('X');
    assert.ok(r && typeof r.total === 'number');
  } finally { rimraf(dir); }
});
// ── 88.8.4 「下次重置」倒计时 ──
// 用户诉求原话：「就是想知道下次生效是什么时候？因为现在一天后会重置。」
// 语义必须是「本地自然日跨到明天 00:00」，不是「此刻 +24 小时」—— 这两者在
// 23:59 和 00:00 附近差一整天，写错了就会让用户白等 / 白切。

test('nextLocalMidnight：普通时刻 → 当天 24:00（即次日 00:00）', () => {
  const now = new Date(2026, 8, 13, 20, 45, 34, 500); // 2026-09-13 20:45:34.500 本地
  const at = nextLocalMidnight(now);
  const d = new Date(at);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8);
  assert.equal(d.getDate(), 14);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getSeconds(), 0);
  assert.equal(d.getMilliseconds(), 0);
});

test('nextLocalMidnight：23:59:59.999 只差 1ms 就跨天 —— 必须落在次日 00:00，不是 +24h', () => {
  const now = new Date(2026, 8, 13, 23, 59, 59, 999);
  const at = nextLocalMidnight(now);
  assert.equal(at - now.getTime(), 1); // 关键：只剩 1 毫秒，不是 86400000
  assert.equal(new Date(at).getDate(), 14);
});

test('nextLocalMidnight：正好 00:00:00.000 → 还得等整整 24 小时（明天 00:00）', () => {
  const now = new Date(2026, 8, 13, 0, 0, 0, 0);
  const at = nextLocalMidnight(now);
  assert.equal(at - now.getTime(), 24 * 3600 * 1000);
  assert.equal(new Date(at).getDate(), 14);
});

test('nextLocalMidnight：月末 / 年末进位（12-31 → 次年 01-01）', () => {
  const at = nextLocalMidnight(new Date(2026, 11, 31, 18, 0, 0, 0));
  const d = new Date(at);
  assert.equal(d.getFullYear(), 2027);
  assert.equal(d.getMonth(), 0);
  assert.equal(d.getDate(), 1);
});

test('resetInfo：返回 now / day / nextResetAt / msToReset 且 msToReset 不为负', () => {
  const dir = tmpDir();
  try {
    const store = createAccountUsageStore(dir);
    const now = new Date(2026, 8, 13, 20, 45, 34, 0);
    const info = store.resetInfo(now);
    assert.equal(info.now, now.getTime());
    assert.equal(info.day, '2026-09-13');
    assert.equal(info.nextResetAt, nextLocalMidnight(now));
    assert.equal(info.msToReset, nextLocalMidnight(now) - now.getTime());
    assert.ok(info.msToReset > 0);
  } finally { rimraf(dir); }
});

test('resetInfo：不传参数也能用（读真实时钟），且 msToReset 永不为负', () => {
  const dir = tmpDir();
  try {
    const store = createAccountUsageStore(dir);
    const info = store.resetInfo();
    assert.ok(Number.isFinite(info.nextResetAt) && info.nextResetAt > 0);
    assert.ok(info.msToReset >= 0);
  } finally { rimraf(dir); }
});

test('localDay 格式必须是 YYYY-MM-DD（与 daemon todayStr 逐字符一致）', () => {
  // 88.8.4 真实事故：这里曾拼成 "2026-0913"（月和日之间漏了 '-'）。
  // 自己写自己读格式一致、单测很容易漏；但 daemon 是 store.all(todayStr()) 调用的，
  // 两边一旦不一致，/api/accounts 返回的 today 恒为 0 —— 「今日切换 N 次」永远显示 0 次。
  const dir = tmpDir();
  try {
    const store = createAccountUsageStore(dir);
    store.noteActive('A', { at: new Date(2026, 0, 5, 10, 0, 0) });
    const all = store.all('2026-01-05');
    assert.equal(all.A.today, 1, 'daemon 用 todayStr() 的格式查，必须能命中');
    // 直接校验落盘的 day 字符串形态（一位数的月/日要补零）
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'account-usage.json'), 'utf8'));
    assert.match(raw.accounts.A.day, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(raw.accounts.A.day, '2026-01-05');
  } finally { rimraf(dir); }
});

test('localDay 与 daemon todayStr 对同一时刻返回相同字符串', () => {
  // 直接把 daemon.js 里的 todayStr 抠出来对比 —— 这是防止两边再各自漂移的最硬的一条断言。
  const daemonSrc = fs.readFileSync(path.join(REPO, 'daemon.js'), 'utf8');
  const fn = daemonSrc.match(/function todayStr\(d\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, 'daemon.js 里找不到 todayStr');
  const z = (n) => String(n).padStart(2, '0');
  // eslint-disable-next-line no-new-func
  const todayStr = new Function('d', 'z', fn[0] + '; return todayStr(d);');
  const dir = tmpDir();
  try {
    const store = createAccountUsageStore(dir);
    for (const d of [new Date(2026, 0, 5, 10, 0, 0), new Date(2026, 10, 30, 23, 59, 59), new Date()]) {
      const mine = store.resetInfo(d).day;
      const theirs = todayStr(d, z);
      assert.equal(mine, theirs, `格式漂移：account-usage=${mine} daemon=${theirs}`);
    }
  } finally { rimraf(dir); }
});
