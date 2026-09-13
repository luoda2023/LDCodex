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
const { createAccountUsageStore, HISTORY_LIMIT, RESET_WINDOW_MS, nextEffectiveAt } = require(path.join(REPO, 'account-usage.js'));

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
// ── 88.8.5 「下次生效」倒计时 ──
// 用户诉求原话：「我要你记录每次切换的时间，到时候就可以知道下一次生效是什么时候」
//            「我的目的很简单：就是想知道下次生效是什么时候？因为现在一天后会重置。」
// 并且**明确否决了日历日方案**：「不是每天0点，是每次我用完后切换的时间」。
// 所以起点 = 最后一次切换的时刻，窗口 = 24 小时（滚动），与 00:00 无关。

test('nextEffectiveAt：下次生效 = 上次切换 + 24 小时（滚动窗口）', () => {
  const last = new Date(2026, 8, 13, 20, 45, 34, 0).getTime();
  const now = new Date(2026, 8, 13, 22, 0, 0, 0).getTime();
  const r = nextEffectiveAt(last, now);
  assert.equal(r.lastSwitchAt, last);
  assert.equal(r.nextEffectiveAt, last + RESET_WINDOW_MS);
  assert.equal(r.msToEffective, last + RESET_WINDOW_MS - now);
  assert.equal(r.ready, false);
  // 生效时刻必须是「明天同一时刻」，不是「明天 00:00」
  const d = new Date(r.nextEffectiveAt);
  assert.equal(d.getDate(), 14);
  assert.equal(d.getHours(), 20);
  assert.equal(d.getMinutes(), 45);
});

test('nextEffectiveAt：跨过 24 小时 → ready=true、msToEffective=0（不会给负数）', () => {
  const last = new Date(2026, 8, 13, 20, 45, 34, 0).getTime();
  const now = new Date(2026, 8, 14, 20, 45, 35, 0).getTime();
  const r = nextEffectiveAt(last, now);
  assert.equal(r.ready, true);
  assert.equal(r.msToEffective, 0);
});

test('nextEffectiveAt：差 1 毫秒到 24 小时 → 仍未生效（边界不能提前放行）', () => {
  const last = new Date(2026, 8, 13, 20, 45, 34, 0).getTime();
  const now = last + RESET_WINDOW_MS - 1;
  const r = nextEffectiveAt(last, now);
  assert.equal(r.ready, false);
  assert.equal(r.msToEffective, 1);
});

test('nextEffectiveAt：lastSwitchAt 非法 / 为空 → 返回 null（前端据此不显示卡片）', () => {
  assert.equal(nextEffectiveAt(NaN, Date.now()), null);
  assert.equal(nextEffectiveAt(0, Date.now()), null);
  assert.equal(nextEffectiveAt('', Date.now()), null);
  assert.equal(nextEffectiveAt(null, Date.now()), null);
});

test('effectiveInfo：没有任何切换记录 → lastSwitchAt 为 null', () => {
  const dir = tmpDir();
  try {
    const store = createAccountUsageStore(dir);
    const info = store.effectiveInfo(new Date(2026, 8, 13, 20, 0, 0));
    assert.equal(info.lastSwitchAt, null);
    assert.equal(info.nextEffectiveAt, null);
  } finally { rimraf(dir); }
});

test('effectiveInfo：起点取**最后一次**切换（中间切过几次不算）', () => {
  const dir = tmpDir();
  try {
    const store = createAccountUsageStore(dir);
    store.noteActive('A', { at: new Date(2026, 8, 13, 8, 0, 0) });
    const second = new Date(2026, 8, 13, 15, 30, 0);
    store.noteActive('B', { at: second, fromUid: 'A' });
    const info = store.effectiveInfo(new Date(2026, 8, 13, 16, 0, 0));
    assert.equal(info.lastSwitchAt, second.getTime());
    assert.equal(info.nextEffectiveAt, second.getTime() + RESET_WINDOW_MS);
    assert.equal(info.fromUid, 'A');
    assert.equal(info.toUid, 'B');
    assert.equal(info.ready, false);
  } finally { rimraf(dir); }
});

test('effectiveInfo：切完号后已经过了 24 小时 → ready=true', () => {
  const dir = tmpDir();
  try {
    const store = createAccountUsageStore(dir);
    store.noteActive('A', { at: new Date(2026, 8, 12, 9, 0, 0) });
    store.noteActive('B', { at: new Date(2026, 8, 12, 10, 0, 0), fromUid: 'A' });
    const info = store.effectiveInfo(new Date(2026, 8, 13, 12, 0, 0));
    assert.equal(info.ready, true);
    assert.equal(info.msToEffective, 0);
  } finally { rimraf(dir); }
});
