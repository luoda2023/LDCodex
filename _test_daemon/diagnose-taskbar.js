/*
 * 任务栏多出图标的诊断工具（只读，不改动系统任何东西）
 *
 * 背景：有用户反馈「只要用了这个软件增加功能，任务栏上会多出一个国内版和国际版的图标」。
 *
 * 这个脚本从**现场**抓证据，输出四部分：
 *   1) 所有「可见的顶层窗口」（pid / 标题 / 类名 / 扩展样式 / 是否有 owner）
 *      —— 这才是任务栏图标的真正来源；用 MainWindowHandle 会漏掉同一进程的第二个窗口，
 *         所以这里直接 EnumWindows，把每个可见顶层窗口都列出来。
 *   2) 持有可见主窗口的进程（Get-Process 的 MainWindowHandle，最贴近任务栏的判据）
 *   3) LDCodex / node / WorkBuddy 相关进程的 PID、父进程、完整命令行
 *   4) conhost.exe（控制台宿主）及其父进程
 *
 * 说明：早期版本用 `tasklist /V` 的中文「暂缺」判断有无窗口，在 UTF-8 下会变乱码导致
 *       过滤失效；`wmic` 也已被新版 Windows 弃用/被安全策略拦截。现在统一改走
 *       PowerShell（并强制 UTF-8 输出），不再依赖 wmic，也不再匹配中文串。
 *
 * 用法：
 *   node _test_daemon/diagnose-taskbar.js
 * 然后把 _test_daemon/taskbar-diagnose-report.txt 发回即可。
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, 'taskbar-diagnose-report.txt');
const lines = [];
function say(s) { lines.push(s); console.log(s); }

/**
 * 跑一段 PowerShell 脚本。
 * 用 -EncodedCommand 传参，彻底绕开引号/换行转义问题；
 * 开头强制 [Console]::OutputEncoding=UTF8，否则中文会按控制台代码页输出成乱码。
 */
function ps(script, timeout = 90000) {
  const full = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;\n' + script;
  const encoded = Buffer.from(full, 'utf16le').toString('base64');
  try {
    const r = spawnSync('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded,
    ], { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    if (!r) return { out: '', err: 'spawn 无返回' };
    if (r.error) return { out: '', err: r.error.message };
    // PowerShell 把错误以 CLIXML 写到 stderr，这里抽掉标记便于人读
    const err = String(r.stderr || '').replace(/#< CLIXML/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return { out: String(r.stdout || ''), err };
  } catch (e) {
    return { out: '', err: e && e.message };
  }
}

/** 枚举所有可见顶层窗口：pid / owner / exstyle / class / title */
const PS_SCAN_WINDOWS = `
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class LDWinScan {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  public static string Scan() {
    var sb = new StringBuilder();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) && !IsIconic(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      var t = new StringBuilder(512); GetWindowTextW(h, t, 512);
      var c = new StringBuilder(256); GetClassNameW(h, c, 256);
      int ex = GetWindowLong(h, -20);
      IntPtr owner = GetWindow(h, 4);
      sb.Append(pid).Append('\\t').Append(owner == IntPtr.Zero ? "no-owner" : "owned")
        .Append('\\t').Append(ex).Append('\\t').Append(c.ToString()).Append('\\t').Append(t.ToString()).Append('\\n');
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
}
'@
[LDWinScan]::Scan()
`;

/** 取进程快照：Name / PID / PPID / ExecutablePath / CommandLine */
const PS_PROC_SNAPSHOT = `
Get-CimInstance Win32_Process |
  Select-Object Name, ProcessId, ParentProcessId, ExecutablePath, CommandLine |
  ConvertTo-Csv -NoTypeInformation
`;

/** 取「持有可见主窗口」的进程：MainWindowHandle != 0 */
const PS_MAIN_WINDOWS = `
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } |
  Select-Object Id, ProcessName, MainWindowTitle |
  Sort-Object ProcessName |
  ForEach-Object { "" + $_.Id + "\`t" + $_.ProcessName + "\`t" + $_.MainWindowTitle }
`;

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

const EX_TOOLWINDOW = 0x00000080;
const EX_APPWINDOW = 0x00040000;

say('===== LDCodex 任务栏图标诊断 =====');
say('时间: ' + new Date().toISOString());
say('主机: ' + (process.env.COMPUTERNAME || '?') + '  用户: ' + (process.env.USERNAME || '?'));
say('');

/* ── 0) 进程快照（后面三部分都要用）── */
const procRes = ps(PS_PROC_SNAPSHOT);
const procRaw = procRes.out;
const procs = [];
{
  const pl = procRaw.split(/\r?\n/).filter((s) => s.trim());
  if (pl.length > 1) {
    const cols = parseCsvLine(pl[0]).map((s) => s.replace(/^"|"$/g, ''));
    for (let i = 1; i < pl.length; i++) {
      const vals = parseCsvLine(pl[i]);
      const row = {};
      cols.forEach((c, j) => { row[c] = String(vals[j] == null ? '' : vals[j]).replace(/^"|"$/g, ''); });
      procs.push(row);
    }
  }
}
const pidMap = new Map();
for (const p of procs) pidMap.set(String(p.ProcessId), p);
const nameOf = (pid) => {
  const p = pidMap.get(String(pid));
  return p ? String(p.Name || '?') : '(已退出)';
};

/* ── 一、所有可见顶层窗口 ── */
say('===== 一、所有可见顶层窗口（任务栏图标的唯一来源）=====');
say('    格式: pid  进程名  [owner]  exstyle 类名  ←  标题');
say('    owner=owned 的窗口通常不在任务栏占位；no-owner 的可见顶层窗口才会。');
say('    exstyle 含 0x40000=APPWINDOW / 0x80=TOOLWINDOW（TOOLWINDOW 不进任务栏）。');
say('');
const winRes = ps(PS_SCAN_WINDOWS);
const winRaw = winRes.out;
const visibleWindows = [];
for (const ln of winRaw.split(/\r?\n/)) {
  const f = ln.split('\t');
  if (f.length < 5) continue;
  const [pid, owner, ex, cls, ...rest] = f;
  if (!/^\d+$/.test(String(pid).trim())) continue;
  const exNum = Number(ex) || 0;
  visibleWindows.push({
    pid: String(pid).trim(),
    owner,
    ex: exNum,
    cls: cls,
    title: rest.join('\t'),
  });
}
if (!visibleWindows.length) {
  say('  （拿不到窗口列表 —— 请看「二」的 MainWindowHandle 结果）');
  if (winRes.err) say('  PowerShell 报错: ' + winRes.err.slice(0, 400));
  if (procRes.err) say('  进程快照报错: ' + procRes.err.slice(0, 400));
} else {
  visibleWindows.sort((a, b) => Number(a.pid) - Number(b.pid));
  for (const w of visibleWindows) {
    const flags = [];
    if (w.ex & EX_APPWINDOW) flags.push('APPWINDOW');
    if (w.ex & EX_TOOLWINDOW) flags.push('TOOLWINDOW');
    say(`  ${w.pid.padEnd(7)} ${nameOf(w.pid).padEnd(22)} [${w.owner}]  ex=0x${w.ex.toString(16).padEnd(8)} ${w.cls.padEnd(28)} ←  ${w.title}`);
  }
}
say('');
say(`小计: ${visibleWindows.length} 个可见顶层窗口`);
say('');

/* ── 二、持有可见主窗口的进程 ── */
say('===== 二、持有可见主窗口的进程（Get-Process MainWindowHandle != 0）=====');
say('');
const mwRes = ps(PS_MAIN_WINDOWS);
const mwRaw = mwRes.out;
const mw = mwRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
if (!mw.length) {
  say('  （没有 —— 可能是权限或策略限制）');
} else {
  for (const ln of mw) {
    const f = ln.split('\t');
    say(`  ${String(f[0] || '').padEnd(7)} ${String(f[1] || '').padEnd(22)} ←  ${String(f[2] || '')}`);
  }
}
say('');

/* ── 三、LDCodex / node / WorkBuddy 相关进程 ── */
say('===== 三、LDCodex / node / WorkBuddy 相关进程（含父进程与完整命令行）=====');
say('');
const INTEREST = /ldcodex|codexplus|workbuddy|codebuddy|^node\.exe$|^conhost\.exe$/i;
const interesting = procs.filter((p) =>
  INTEREST.test(String(p.Name || '')) ||
  INTEREST.test(String(p.ExecutablePath || '')) ||
  INTEREST.test(String(p.CommandLine || '')));

const windowedPids = new Set(visibleWindows.map((w) => w.pid));

if (!interesting.length) {
  say('  （未找到相关进程 —— 如果此时任务栏仍有图标，请在有图标时再跑一次）');
}
for (const p of interesting) {
  const pid = String(p.ProcessId);
  const parent = pidMap.get(String(p.ParentProcessId));
  const wins = visibleWindows.filter((w) => w.pid === pid);
  say(`  ${String(p.Name || '?').padEnd(22)} pid=${pid.padEnd(7)} ppid=${String(p.ParentProcessId || '?').padEnd(7)} ${wins.length ? '★有可见窗口(' + wins.length + ')' : '  无可见窗口'}`);
  say(`      路径: ${p.ExecutablePath || '(未知)'}`);
  say(`      父进程: ${parent ? (parent.Name + ' pid=' + parent.ProcessId) : '(已退出)'}`);
  for (const w of wins) say(`      窗口: class=${w.cls} ex=0x${w.ex.toString(16)} [${w.owner}] 标题="${w.title}"`);
  say(`      命令行: ${String(p.CommandLine || '').slice(0, 300)}`);
  say('');
}

/* ── 四、conhost 与控制台窗口 ── */
say('===== 四、conhost.exe（控制台宿主）=====');
say('');
const hosts = procs.filter((p) => /^conhost\.exe$/i.test(String(p.Name || '')));
if (!hosts.length) {
  say('  （没有 conhost.exe）');
} else {
  for (const h of hosts) {
    const pid = String(h.ProcessId);
    const parent = pidMap.get(String(h.ParentProcessId));
    const wins = visibleWindows.filter((w) => w.pid === pid);
    say(`  conhost pid=${pid.padEnd(7)} 父进程=${(parent ? (parent.Name + ' pid=' + parent.ProcessId) : '(已退出)').padEnd(34)} ${wins.length ? '★该控制台窗口可见' : '窗口不可见'}`);
  }
  say('');
  say('  说明：conhost 的存在**不能**证明有可见控制台窗口 —— 用 CREATE_NO_WINDOW 启动的');
  say('        控制台进程同样会带一个 conhost，但窗口不显示。只有上面标了「★该控制台窗口');
  say('        可见」的才真正会在任务栏出现图标。');
}
say('');

/* ── 五、结论指引 ── */
say('===== 五、怎么读这份报告 =====');
say('');
say('  A. 「一」里出现 node.exe / powershell.exe / cmd.exe 的可见窗口');
say('     → 某个子进程带着控制台窗口在跑，说明启动路径漏了隐藏标志。');
say('  B. 「一」里同一个 WorkBuddy/WorkBuddyAI pid 出现**两个以上** no-owner 可见窗口');
say('     → 客户端进程里的辅助窗口被强行显示出来了（1.2.12 修的就是这个）。');
say('       典型特征：标题是 "OleMainThreadWndName"、类名是 Chrome_WidgetWin_* 等。');
say('  C. 「一」里只有一个 WorkBuddy/WorkBuddyAI 窗口，但任务栏有两个图标');
say('     → 任务栏身份被改写、与固定的快捷方式分成了两个按钮（LDCODEX_REBRAND_TASKBAR 相关）。');
say('  D. 「一」里完全没有多余窗口、任务栏却仍有图标');
say('     → 图标来自系统托盘区或第三方工具，请截图确认。');
say('');

try {
  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log('\n报告已写入: ' + OUT);
} catch (e) {
  console.log('\n报告写盘失败: ' + e.message);
}
