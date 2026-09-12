// 为 WorkBuddy 增强界面补齐英文词条（只补缺失项，不动已有翻译）。
// 用法：node tools/wb-i18n-fill.mjs

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dictPath = path.join(repoRoot, "apps", "codex-plus-manager", "src", "i18n-en.ts");

const PLAIN = {
  "WorkBuddy增强": "WorkBuddy Enhancements",
  "管理 WorkBuddy 桌面端的账号、主题、会话、模型、免打扰与自动化；数据全部留在本机。":
    "Manage WorkBuddy desktop accounts, themes, sessions, models, do-not-disturb and automation. All data stays on this machine.",
  "账号": "Accounts",
  "主题": "Themes",
  "会话": "Sessions",
  "模型": "Models",
  "增强": "Enhancements",
  "自动化": "Automation",
  "电脑": "Power",
  "设置": "Settings",
  "进行中": "In progress",
  "已完成": "Completed",
  "已归档": "Archived",
  "已过期": "Expired",
  "当前登录": "Signed in",
  "退出登录": "Sign out",
  "昵称": "Nickname",
  "手机号": "Phone",
  "账号 ID": "Account ID",
  "登录有效期": "Sign-in validity",
  "没有读到当前登录信息。请先登录 WorkBuddy，或点上方「让增强生效」重启一次。":
    "No sign-in info found. Sign in to WorkBuddy first, or use “Activate enhancements” above to restart it once.",
  "切换后 WorkBuddy 会重新读取登录信息，无需重新扫码。":
    "After switching, WorkBuddy re-reads the sign-in info. No need to scan the QR code again.",
  "当前": "Current",
  "使用中": "In use",
  "切换": "Switch",
  "账号已切换。": "Account switched.",
  "还没有备份账号。WorkBuddy 登录后会自动备份，之后就能一键切换。":
    "No backup accounts yet. WorkBuddy backs them up automatically after sign-in, then you can switch with one click.",
  "应用主题后 WorkBuddy 界面会自动刷新，无需手动重启。":
    "Applying a theme refreshes the WorkBuddy UI automatically. No manual restart needed.",
  "深色": "Dark",
  "应用中…": "Applying…",
  "应用": "Apply",
  "主题已应用。": "Theme applied.",
  "暂无可用主题。": "No themes available.",
  "这里展示 WorkBuddy 本机的会话列表，便于排查工作目录与状态。":
    "This lists WorkBuddy sessions on this machine, handy for checking working directories and status.",
  "未命名会话": "Untitled session",
  "没有读到会话。确认 WorkBuddy 已登录并至少使用过一次。":
    "No sessions found. Make sure WorkBuddy is signed in and has been used at least once.",
  "读取自 WorkBuddy 的模型配置文件；改动会在客户端下次读取时生效。":
    "Read from WorkBuddy's model configuration file. Changes take effect the next time the client reads it.",
  "已启用": "Enabled",
  "已停用": "Disabled",
  "没有读到已安装模型。可以在 WorkBuddy 里配置模型后回到本页刷新。":
    "No installed models found. Configure models in WorkBuddy, then come back and refresh.",
  "免打扰": "Do not disturb",
  "让长任务不再卡在确认弹窗上。开启项越多，自动化越顺畅，请按需开启。":
    "Stop long tasks from stalling on confirmation dialogs. More switches on means smoother automation — enable only what you need.",
  "这些开关要等 WorkBuddy 打开调试通道后才能生效。":
    "These switches take effect only after WorkBuddy opens its debug channel.",
  "长任务自动化": "Long-task automation",
  "由 WorkBuddy 侧接管，无需保持管理器窗口打开。":
    "Handled on the WorkBuddy side; the manager window does not need to stay open.",
  "自动处理决策弹窗": "Auto-answer decision prompts",
  "会话中出现需要选择的问题时自动选择推荐项，下次会话生效。":
    "Automatically picks the recommended option when a session asks you to choose. Takes effect next session.",
  "任务中断后自动继续": "Auto-continue after interruption",
  "长任务被中断时自动补一句继续，减少人工盯着。":
    "Sends a “continue” when a long task is interrupted, so you do not have to babysit it.",
  "任务在 WorkBuddy 页面内执行，管理器关闭也不影响。":
    "Tasks run inside the WorkBuddy page and keep working even if the manager is closed.",
  "还没有自动化任务。": "No automation tasks yet.",
  "电脑休眠": "Computer sleep",
  "当前正在阻止休眠：长任务运行期间电脑不会睡着。":
    "Sleep is currently blocked: the computer will not sleep while a long task runs.",
  "当前不阻止休眠。": "Sleep is not currently blocked.",
  "保持常亮，不进入休眠": "Stay awake, never sleep",
  "开启后，运行中的任务不会因为电脑休眠而中断。":
    "While on, running tasks will not be interrupted by the computer going to sleep.",
  "仅任务期间阻止休眠": "Block sleep only during tasks",
  "任务结束后自动恢复，兼顾省电。": "Restores automatically when the task finishes, saving power.",
  "桌面图标": "Desktop shortcut",
  "桌面上会有一个「WorkBuddy增强」图标，双击直接打开本页面。":
    "A “WorkBuddy Enhancements” icon appears on the desktop; double-click it to open this page directly.",
  "状态": "Status",
  "已创建": "Created",
  "尚未创建": "Not created yet",
  "位置": "Location",
  "指向": "Target",
  "修复桌面图标": "Repair shortcut",
  "创建桌面图标": "Create shortcut",
  "移除桌面图标": "Remove shortcut",
  "运行时信息": "Runtime information",
  "排查问题时把这些信息发给技术支持即可。":
    "Send this information to support when troubleshooting.",
  "服务端口": "Service port",
  "服务版本": "Service version",
  "调试通道": "Debug channel",
  "已连接": "Connected",
  "未连接": "Not connected",
  "客户端": "Client",
  "已安装 · 正在运行": "Installed · running",
  "已安装 · 未运行": "Installed · not running",
  "未安装": "Not installed",
  "数据目录": "Data directory",
  "运行时目录": "Runtime directory",
  "Node 运行时": "Node runtime",
  "当前权限": "Current privilege",
  "管理员": "Administrator",
  "普通用户": "Standard user",
  "重新检测": "Re-check",
  "以管理员身份重启": "Restart as administrator",
  "LDCodex 正常使用不需要管理员权限。只有在排查权限相关问题时，才需要用「以管理员身份重启」，系统会弹出 UAC 让你确认。":
    "LDCodex does not need administrator rights for normal use. Only use “Restart as administrator” when troubleshooting privilege issues; Windows will show a UAC prompt for you to confirm.",
  "检测环境": "Check environment",
  "启动增强服务": "Start enhancement service",
  "重启并让增强生效": "Restart and activate",
  "让增强生效": "Activate enhancements",
  "停止服务": "Stop service",
  "正在检测增强服务…": "Checking the enhancement service…",
  "增强服务运行中 · 全部能力已就绪": "Service running · all capabilities ready",
  "增强服务运行中 · 部分能力待启用": "Service running · some capabilities pending",
  "增强服务未运行": "Enhancement service is not running",
  "正在读取本机运行时环境，请稍候。": "Reading the local runtime environment, please wait.",
  "刷新": "Refresh",
  "正在读取…": "Loading…",
  "增强服务还没有运行。点右上角「启动增强服务」，LDCodex 会自动把运行时和调试通道都准备好 —— 你不需要手动记任何参数。":
    "The enhancement service is not running yet. Click “Start enhancement service” at the top right — LDCodex prepares the runtime and debug channel for you, so you never have to remember any parameters.",
  "环境还没就绪。请先按上方提示处理，然后点「重新检测」。":
    "The environment is not ready yet. Follow the hint above, then click “Re-check”.",
  "已经用调试模式重启 WorkBuddy，增强能力会在它启动后自动接上。":
    "WorkBuddy was restarted in debug mode; enhancements will attach automatically once it is up.",
  "重启失败": "Restart failed",
  "操作失败": "Operation failed",
  "已退出登录并重新启动 WorkBuddy。": "Signed out and restarted WorkBuddy.",
  "自动点「允许」": "Auto-click “Allow”",
  "决策弹窗出现时自动点允许，避免长任务卡在授权上。":
    "Automatically clicks Allow on permission dialogs so long tasks do not stall on authorization.",
  "允许访问工作区外文件": "Allow files outside the workspace",
  "放开对工作目录之外文件的读写请求。": "Permits read/write requests for files outside the working directory.",
  "自动允许执行命令": "Auto-approve command execution",
  "跳过命令执行的确认步骤。": "Skips the confirmation step for command execution.",
  "自动允许批量删除": "Auto-approve bulk deletion",
  "跳过批量删除的确认步骤。": "Skips the confirmation step for bulk deletion.",
  "自动允许系统工具": "Auto-approve system tools",
  "跳过系统级工具的确认步骤。": "Skips the confirmation step for system-level tools.",
};

const TEMPLATE = {
  "{0} 天后过期": "Expires in {0} days",
  "{0}": "{0}",
  "已备份账号（{0}）": "Backup accounts ({0})",
  "可用主题（{0}）": "Available themes ({0})",
  "会话（{0}）": "Sessions ({0})",
  "{0} · 更新于 {1}": "{0} · updated {1}",
  "已安装模型（{0}）": "Installed models ({0})",
  "模型备份（{0}）": "Model backups ({0})",
  "模型配置文件：{0}": "Model configuration file: {0}",
  "自动化任务（{0}）": "Automation tasks ({0})",
  "触发方式：{0}": "Trigger: {0}",
};

/** 从 TS 源码里取出该对象已有的键。 */
function existingKeys(source, startMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`找不到标记：${startMarker}`);
  const keys = new Set();
  const re = /^\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*:/gm;
  let match;
  while ((match = re.exec(source)) !== null) {
    if (match.index < start) continue;
    const raw = match[1];
    const text = raw.startsWith('"') ? JSON.parse(raw) : raw.slice(1, -1);
    keys.add(text);
  }
  return keys;
}

function escapeKey(text) {
  return JSON.stringify(text);
}

function renderEntries(entries) {
  return entries
    .map(([key, value]) => `  ${escapeKey(key)}: ${JSON.stringify(value)},`)
    .join("\n");
}

/** 在“下一个块开头”之前、属于上一个块的 `};` 之前插入词条。 */
function insertBeforeBlock(source, nextBlockMarker, block) {
  const nextIndex = source.indexOf(nextBlockMarker);
  if (nextIndex < 0) throw new Error(`找不到下一个块标记：${nextBlockMarker}`);
  const closingIndex = source.lastIndexOf("};", nextIndex);
  if (closingIndex < 0) throw new Error(`找不到 ${nextBlockMarker} 之前的 };`);
  // 行首对齐：把插入内容接到 `};` 所在行的前面。
  const lineStart = source.lastIndexOf("\n", closingIndex) + 1;
  return `${source.slice(0, lineStart)}${block}\n${source.slice(lineStart)}`;
}

let source = readFileSync(dictPath, "utf8");

const plainExisting = existingKeys(source, "export const EN_PLAIN");
const templateStart = source.indexOf("export const EN_TEMPLATE");
const templateExisting = existingKeys(source.slice(templateStart), "export const EN_TEMPLATE");

const missingPlain = Object.entries(PLAIN).filter(([key]) => !plainExisting.has(key));
const missingTemplate = Object.entries(TEMPLATE).filter(([key]) => !templateExisting.has(key));

if (!missingPlain.length && !missingTemplate.length) {
  console.log("[wb-i18n-fill] 没有缺失词条，字典已是最新。");
  process.exit(0);
}

if (missingPlain.length) {
  source = insertBeforeBlock(
    source,
    "export const EN_TEMPLATE",
    `  // ── WorkBuddy 增强 ──\n${renderEntries(missingPlain)}`,
  );
}
if (missingTemplate.length) {
  source = insertBeforeBlock(
    source,
    "export const EN_BACKEND",
    `  // ── WorkBuddy 增强 ──\n${renderEntries(missingTemplate)}`,
  );
}

writeFileSync(dictPath, source, "utf8");
console.log(
  `[wb-i18n-fill] 已补充 ${missingPlain.length} 条普通词条、${missingTemplate.length} 条模板词条。`,
);
