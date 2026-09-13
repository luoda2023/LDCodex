'use strict';
const fs = require('node:fs');
const path = require('node:path');

// 账号「使用次数」统计 + 切换流水（88.8.4 新增）。
//
// 两个职责合一的原因是：它们都是「本机偏好数据」、都依赖活跃账号变化的去重判断、
// 共享同一个存储文件能避免多源数据漂移。
//
// 数据形状（v2）：
//   {
//     "version": 2,
//     "lastActiveUid": "99001777",
//     "accounts": {
//       "99001777": { "total": 12, "today": 3, "day": "2026-09-13",
//                     "firstAt": "2026-09-01T02:00:00.000Z",
//                     "lastAt": "2026-09-13T08:30:00.000Z" }
//     },
//     "history": [
//       { "fromUid": "99001666", "toUid": "99001777", "at": "2026-09-13T08:30:00.000Z" },
//       ...
//     ]
//   }
//
// accounts 字段：每个账号被切换/活跃过多少次 —— 用于「用过几次 / 今日切换 N 次」徽标。
// history 字段：每次切换的完整流水（A→B at 时间） —— 88.8.4 新增，用于「我上次切到哪个账号、
//               什么时候切的」这种问题。环形上限 50 条 —— 比这更老的覆盖掉（典型一天切不到 5 次）。
//
// 两者都在同一时机写入：noteActive() 检测到 lastActiveUid 真正变了（包含跨重启、面板轮询）
// 就 +1 + push 一条 history。同一账号重复上报不写：避免重启后 +1、避免「观察到活跃账号变化」
// 与「显式切换」两条路径重复计数。
//
// 纯本地偏好：导出/导入账号时**不**随账号迁移（换台机器流水归零，符合「本机使用历史」语义）。
const HISTORY_LIMIT = 50;

// 「下次生效」= **上次切换的时刻 + 24 小时**（88.8.5）。
//
// ⚠️⚠️ 语义一改再改，这里把两次都记下来，别再改回去：
//   【第一版（错）】按本地自然日算，重置点 = 次日 00:00。
//     用户明确否决：「不是每天0点，是每次我用完后切换的时间」。
//   【第二版（对）】按**每次切换**算 —— 用完了切到别的号，从切换那一刻起 24 小时后
//     才能再切回来。所以不存在「全站统一的重置点」，每个「上次切换」都有自己的倒计时。
//
// 用户诉求原话：「我要你记录每次切换的时间，到时候就可以知道下一次生效是什么时候」
//            「我的目的很简单：就是想知道下次生效是什么时候？因为现在一天后会重置。」
//
// 所以：RESET_WINDOW_MS 是**滚动窗口**（相对时刻），不是日历日。
// 写成纯函数、时钟由调用方传入，方便单测「刚好 24 小时 / 差 1 毫秒」这类边界。
const RESET_WINDOW_MS = 24 * 60 * 60 * 1000;

function nextEffectiveAt(lastSwitchAt, now) {
  const last = Number(lastSwitchAt);
  if (!Number.isFinite(last) || last <= 0) return null;
  const at = last + RESET_WINDOW_MS;
  const cur = Number(now);
  return {
    lastSwitchAt: last,
    nextEffectiveAt: at,
    msToEffective: Number.isFinite(cur) ? Math.max(0, at - cur) : 0,
    // 已经过了 24 小时 → 现在切回去就生效
    ready: Number.isFinite(cur) ? at - cur <= 0 : false,
  };
}

function createAccountUsageStore(dataDir) {
  const file = path.join(dataDir, 'account-usage.json');

  function empty() {
    return { version: 2, lastActiveUid: '', accounts: {}, history: [] };
  }

  function readAll() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!raw || typeof raw !== 'object') return empty();
      const accounts = raw.accounts && typeof raw.accounts === 'object' ? raw.accounts : {};
      const history = Array.isArray(raw.history) ? raw.history : [];
      // 兼容老 v1 文件：缺 history 字段，视为空数组。
      return {
        version: 2,
        lastActiveUid: typeof raw.lastActiveUid === 'string' ? raw.lastActiveUid : '',
        accounts,
        history,
      };
    } catch (_) {
      // 文件不存在或损坏：从空数据起步（坏文件不会让调用方抛错）
      return empty();
    }
  }

  function writeAll(data) {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = file + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function isValidUid(uid) {
    return typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
  }

  // 本地日期 YYYY-MM-DD（与 daemon 的 todayStr **逐字符**同格式，本地时区）。
  //
  // ⚠️ 88.8.4 修：这里曾经漏了月份和日之间的 '-'，拼出来是 "2026-0913"。
  // 后果很隐蔽 —— noteActive 自己写自己读格式一致，看不出问题；但 daemon 的
  // /api/accounts 是 `accountUsageStore.all(todayStr())`（正确的 "2026-09-13"），
  // 两边字符串永远不相等 → `today` 恒为 0，「今日切换 N 次」永远显示 0 次。
  // 所以这个格式必须和 daemon.js 的 todayStr 完全一致，不是「看起来差不多」就行。
  function localDay(date) {
    const d = date instanceof Date ? date : new Date();
    const z = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }

  // 把内部条目整理成对外视图（today 只在 day 匹配当天时才有意义）
  function summarize(entry, day) {
    const e = entry && typeof entry === 'object' ? entry : {};
    const total = Number(e.total) || 0;
    return {
      total,
      today: e.day === day ? Number(e.today) || 0 : 0,
      day: typeof e.day === 'string' ? e.day : '',
      firstAt: typeof e.firstAt === 'string' ? e.firstAt : '',
      lastAt: typeof e.lastAt === 'string' ? e.lastAt : '',
    };
  }

  // 记录「活跃账号变为 uid」。
  //   options.fromUid：切换前那个账号（用于 history 流水；可省略，省略时不写来源）
  // 同一账号重复上报不计数（accounts 与 history 都不动）。
  // 返回更新后的统计；uid 非法/为空则返回 null 且不写盘。
  function noteActive(uid, options = {}) {
    if (!isValidUid(uid)) return null;
    const now = options.at instanceof Date ? options.at : new Date();
    const day = typeof options.day === 'string' && options.day ? options.day : localDay(now);
    const fromUid = typeof options.fromUid === 'string' && options.fromUid ? options.fromUid : '';
    const data = readAll();
    if (data.lastActiveUid === uid) {
      // 已是同一个活跃账号：不重复计数，仅返回当前视图
      return summarize(data.accounts[uid], day);
    }
    // accounts：累加 total / today（保持 88.8.1 起的语义）
    const prev = data.accounts[uid] && typeof data.accounts[uid] === 'object' ? data.accounts[uid] : {};
    const next = {
      total: (Number(prev.total) || 0) + 1,
      today: (prev.day === day ? Number(prev.today) || 0 : 0) + 1,
      day,
      firstAt: typeof prev.firstAt === 'string' && prev.firstAt ? prev.firstAt : now.toISOString(),
      lastAt: now.toISOString(),
    };
    data.accounts[uid] = next;
    data.lastActiveUid = uid;

    // history：推一条 A→B；环形截断到 HISTORY_LIMIT
    data.history.push({
      fromUid,
      toUid: uid,
      at: now.toISOString(),
    });
    if (data.history.length > HISTORY_LIMIT) {
      data.history.splice(0, data.history.length - HISTORY_LIMIT);
    }

    try {
      writeAll(data);
    } catch (_) {
      // 写盘失败不能影响账号切换主流程
    }
    return summarize(next, day);
  }

  // 只读：某账号统计
  function get(uid, day) {
    const data = readAll();
    return summarize(data.accounts[uid], day || localDay());
  }

  // 只读：全部账号统计（uid -> 统计）
  function all(day) {
    const d = day || localDay();
    const data = readAll();
    const out = {};
    for (const [uid, entry] of Object.entries(data.accounts)) out[uid] = summarize(entry, d);
    return out;
  }

  // 切换流水（88.8.4 新增）。
  //   filterUid：可选，传了则只返回 fromUid 或 toUid 等于该 uid 的项；否则返回全部。
  //   返回数组按「最新在前」排序（直接读 + 反转，避免 reverse 副作用）。
  function historyFn(filterUid) {
    const list = readAll().history || [];
    const filtered = filterUid
      ? list.filter((h) => h && (h.fromUid === filterUid || h.toUid === filterUid))
      : list;
    const out = [];
    for (let i = filtered.length - 1; i >= 0; i--) out.push(filtered[i]);
    return out;
  }

  // 把「流水里出现的所有账号 + nickname」映射出来，给前端展示用；
  // nickname 需要外部传入（account-usage 不维护账号清单 —— 那是 accounts API 的事）。
  function decorate(entries, byUid) {
    return entries.map((h) => ({
      fromUid: h.fromUid,
      toUid: h.toUid,
      at: h.at,
      fromNickname: (byUid && h.fromUid && byUid[h.fromUid] && byUid[h.fromUid].nickname) || h.fromUid || '',
      toNickname: (byUid && h.toUid && byUid[h.toUid] && byUid[h.toUid].nickname) || h.toUid || '',
    }));
  }

  // 只读：「下次生效」还有多久（88.8.5）。
  // ⚠️ 起点是**最后一次切换的时刻**（history 最后一条），不是日历日 00:00 ——
  // 用户明确说过「不是每天0点，是每次我用完后切换的时间」。
  // 没有任何切换记录时返回 { lastSwitchAt: null, ... }，前端据此不显示倒计时卡。
  function effectiveInfo(now) {
    const d = now instanceof Date ? now : now ? new Date(now) : new Date();
    const ms = d.getTime();
    const data = readAll();
    const list = Array.isArray(data.history) ? data.history : [];
    const last = list.length ? list[list.length - 1] : null;
    const lastMs = last && typeof last.at === 'string' ? Date.parse(last.at) : NaN;
    if (!Number.isFinite(lastMs)) {
      return { now: ms, day: localDay(d), lastSwitchAt: null, nextEffectiveAt: null, msToEffective: 0, ready: true };
    }
    const r = nextEffectiveAt(lastMs, ms) || {};
    return {
      now: ms,
      day: localDay(d),
      lastSwitchAt: r.lastSwitchAt,
      nextEffectiveAt: r.nextEffectiveAt,
      msToEffective: r.msToEffective,
      ready: r.ready,
      fromUid: last && typeof last.fromUid === 'string' ? last.fromUid : '',
      toUid: last && typeof last.toUid === 'string' ? last.toUid : '',
    };
  }

  return { noteActive, get, all, history: historyFn, decorate, effectiveInfo, historyLimit: HISTORY_LIMIT, file };
}

module.exports = { createAccountUsageStore, HISTORY_LIMIT, RESET_WINDOW_MS, nextEffectiveAt };