'use strict';
const fs = require('node:fs');
const path = require('node:path');

// 账号「使用次数」统计：记录每个账号被切换/使用过多少次，供管理器账号列表展示，
// 让用户一眼看出「哪些账号是用过的」。
//
// 纯本地偏好数据（profile 目录下的 account-usage.json），与账号备份格式无关：
// 使用历史属于「这台机器上的使用记录」，导出/导入账号时**不**随账号迁移
// （换台机器次数归零，符合「本机使用历史」的语义）。
//
// 数据形状：
//   {
//     "version": 1,
//     "lastActiveUid": "99001777",          // 上次见到的活跃账号（用于去重）
//     "accounts": {
//       "99001777": { "total": 12, "today": 3, "day": "2026-09-13",
//                     "firstAt": "2026-09-01T02:00:00.000Z",
//                     "lastAt": "2026-09-13T08:30:00.000Z" }
//     }
//   }
// - total  累计使用次数
// - today  今天的使用次数（day 记录所属日期，跨天读取时自动视为 0，无需定时清零）
// - firstAt / lastAt  ISO 时间戳
//
// 关键点：计数入口只有 noteActive(uid) 一个，内部按 lastActiveUid 去重 ——
// 「已经是同一个活跃账号」时不重复计数。这样：
//   · 显式切换（管理器点「切换」）与「观察到活跃账号变化」两条路径不会对同一次切换重复计数；
//   · 重启管理器/daemon 后当前账号没变 → 不会平白 +1；
//   · 用户 A→B→A 来回切 → A 每次都算（确实切过）。
function createAccountUsageStore(dataDir) {
  const file = path.join(dataDir, 'account-usage.json');

  function empty() {
    return { version: 1, lastActiveUid: '', accounts: {} };
  }

  function readAll() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!raw || typeof raw !== 'object') return empty();
      const accounts = raw.accounts && typeof raw.accounts === 'object' ? raw.accounts : {};
      return {
        version: 1,
        lastActiveUid: typeof raw.lastActiveUid === 'string' ? raw.lastActiveUid : '',
        accounts,
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

  // 本地日期 YYYY-MM-DD（与 daemon 的 todayStr 同语义，本地时区）
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

  // 记录「活跃账号变为 uid」。同一账号重复上报不计数（含跨重启）。
  // 返回更新后的统计；uid 非法/为空则返回 null 且不写盘。
  function noteActive(uid, options = {}) {
    if (!isValidUid(uid)) return null;
    const now = options.at instanceof Date ? options.at : new Date();
    const day = typeof options.day === 'string' && options.day ? options.day : localDay(now);
    const data = readAll();
    if (data.lastActiveUid === uid) {
      // 已是同一个活跃账号：不重复计数，仅返回当前视图
      return summarize(data.accounts[uid], day);
    }
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

  return { noteActive, get, all, file };
}

module.exports = { createAccountUsageStore };
