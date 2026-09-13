# LDCodex daemon 1.2.12 功能测试报告

- **测试时间**：2026-09-13 12:30 – 13:05（1.2.9）；14:20（1.2.10 复跑）；15:40（1.2.11 全量复跑）；16:00（1.2.12 全量复跑）
- **被测代码**：
  - `apps/codex-plus-manager/src-tauri/workbuddy-runtime/daemon.js`（DAEMON_VERSION **1.2.12**）
  - `apps/codex-plus-manager/src-tauri/workbuddy-runtime/inject.js`（1.2.11：上弹面板行内新增常用语；含 1.2.10 的扣费取样范围修复）
  - `crates/codex-plus-core/src/windows_integration.rs`（**1.2.12：窗口激活不再制造幽灵窗口 + 任务栏身份改写默认关闭**）
  - `apps/codex-plus-manager/src-tauri/workbuddy-runtime/automation.js`（抗崩溃加固）
  - `apps/codex-plus-manager/src-tauri/src/workbuddy.rs`（「重启并启用」真正结束旧客户端）
- **测试方式**：隔离实例（独立数据目录 `data4` + 独立端口 47999 + CDP 指向空端口 47998），**不影响正在运行的真实客户端**

## 一、总体结果

| 测试集 | 结果 |
|---|---|
| 功能接口测试（`run-tests.js`） | **73 / 73 全部通过** ✅ |
| 自动点允许判定逻辑（`verify-no-disturb.js`） | **16 / 16 全部通过** ✅ |
| CDP 端口隔离逻辑（`verify-cdp-isolation.js`） | **18 / 18 全部通过** ✅ |
| Rust 单元测试（`codex-plus-core` windows_integration） | **2 / 2 通过** ✅ |
| 真实页面 UI 只读验证（`_test_daemon/cdp-qp-ui-verify.mjs`） | 全部符合预期 ✅ |
| 前端类型检查（`tsc --noEmit`） | 通过 ✅ |

## 一之四、1.2.12 修掉的缺陷：任务栏多出一个「国内版/国际版」图标

### 需求（用户原话）

> 还有一个功能：为什么有些电脑的任务栏，只要用了这个软件增加功能，在任务栏上会多出一个国内版和国际版的图标。这个图标可以隐藏，不要出现。

### 排查过程（先证伪，再定位）

| 假设 | 结论 | 依据 |
|---|---|---|
| daemon 带了控制台窗口 | ❌ 排除 | 实机 `Get-Process`：4 个 `node.exe`（含两个 daemon）`MainWindowHandle` 全为 0，所有 `conhost.exe` 同样为 0 |
| 某个子进程漏了隐藏标志 | ❌ 排除 | JS 侧 26 处子进程调用、Rust 侧 Windows 关键 spawn 全部带 `windowsHide` / `CREATE_NO_WINDOW`（唯一例外是安装器启动器，它本来就要弹 UAC 与安装向导） |
| daemon 设置了 `process.title` 覆盖控制台标题 | ❌ 排除 | 全仓库（除 `node_modules` 类型定义）**没有任何一处** `process.title` / `SetConsoleTitle` |
| **窗口激活逻辑强行显示隐藏窗口** | ✅ **根因之一** | 见下 |
| **任务栏身份（AppUserModelID）被改写** | ✅ **根因之二** | 见下 |

### 根因一：`activate_process_window` 会把客户端进程里的隐藏辅助窗口「显示出来」

`apps/codex-plus-launcher/src/main.rs:231-236`：

```rust
let process_ids = codex_plus_core::watcher::find_codex_processes();
let activated = process_ids.iter().copied().any(codex_plus_core::windows_activate_process_window);
```

`find_codex_processes()` 返回的是**所有 exe 名为 `workbuddy.exe`/`workbuddyai.exe` 的进程** —— 包括渲染进程、GPU 进程、utility 进程、crashpad-handler。而 `activate_process_window` 内部：

```rust
let Some(hwnd) = process_window(process_id, false) else { return false; };  // visible_only = false
if IsIconic(hwnd) { ShowWindow(hwnd, SW_RESTORE); }
else if !IsWindowVisible(hwnd) { ShowWindow(hwnd, SW_SHOW); }   // ← 把隐藏窗口强行变可见
```

诊断报告实机抓到的证据：`WorkBuddyAI.exe pid=2992`（`--type=utility`）带着一个隐藏的顶层窗口，标题 `OleMainThreadWndName`。它有标题 → 打分是 `Titled`，是该 PID 里得分最高的窗口 → 被选中 → `SW_SHOW` 之后**变成可见窗口** → 任务栏凭空多出一个图标。

`SetForegroundWindow` 对这类窗口通常返回 `false`，于是 `.any()` **不会短路**，会沿着进程列表继续显示下一个 —— 所以是「多出一个（或几个）图标」，且**只出现在部分机器上**（取决于客户端有几个这类辅助窗口、以及任务栏是否合并按钮）。

### 根因二：改写窗口的 `AppUserModelID` 会让任务栏分成两个按钮

`windows_integration.rs` 的 `apply_taskbar_properties` 会把客户端主窗口的：

| 属性 | 值 |
|---|---|
| `PKEY_AppUserModel_ID` | `cn.dicad.ldcodex.codex` |
| `PKEY_AppUserModel_RelaunchDisplayNameResource` | `LDCodex` |
| `PKEY_AppUserModel_RelaunchCommand` | `ldcodex.exe` |

`AppUserModelID` 决定 Windows 任务栏如何给窗口分组。客户端自己有身份，用户如果把客户端**固定到任务栏**，那个固定按钮用的也是客户端身份；我们再改运行中窗口的身份 → 两者不再合并 → 任务栏出现**两个**按钮：一个是固定的、一个是正在运行的。这正好解释「有些电脑」（只有固定了客户端的机器才明显）。

### 修复

**（1）窗口激活：只碰「本来就该显示」的窗口**（`windows_integration.rs`）

```rust
pub fn activate_process_window(process_id: u32) -> bool {
    // 先只在「已经可见」的窗口里挑（被最小化的窗口依然算可见）。
    // 把这个集合里的窗口置前，不会改变任务栏里的图标数量，永远是安全的。
    if let Some(hwnd) = process_window(process_id, true) {
        return bring_window_to_front(hwnd);
    }
    // 兜底恢复「被最小化到托盘」的主窗口 —— 但必须过 is_genuine_app_window 校验，
    // 否则 utility 进程里的隐藏 OLE 消息窗口会被显示出来。
    let Some(hwnd) = process_window(process_id, false) else { return false; };
    if !is_genuine_app_window(hwnd) { return false; }
    bring_window_to_front(hwnd)
}
```

`is_genuine_app_window` 的判据**来自实机抓到的窗口清单**，而不是猜的：

| 条件 | 理由 |
|---|---|
| 有非空标题 | 辅助窗口常无标题 |
| 非 `WS_EX_TOOLWINDOW` | 工具窗口本就不进任务栏 |
| 类名不在辅助类黑名单 | 新增 `OleMainThreadWndName` / `OleMainThreadWndClass` / `Chrome_MessageWindow` / `Chrome_WidgetWin_0`（实机抓到） |
| **无 owner** | 附属窗口（OLE 消息窗口、弹出层）都有 owner |

> **特别注意**：这里**刻意不要求** `WS_EX_APPWINDOW`。实机抓到客户端主窗口 `class=Chrome_WidgetWin_1 ex=0x100` —— 并没有这个样式位。若把它当必要条件，「客户端被最小化到托盘后恢复主窗口」这个正常功能会一起失效。

**（2）任务栏身份改写默认关闭**（`windows_integration.rs`）

新增开关 `LDCODEX_REBRAND_TASKBAR`，**默认关闭**任务栏身份改写；窗口图标仍由 `WM_SETICON` 换成 LDCodex 图标，品牌效果保留。需要恢复旧行为时设 `LDCODEX_REBRAND_TASKBAR=1`。

**（3）daemon 侧同样的问题**（`daemon.js` 的 `restoreWorkBuddyWindow`）

原 C# 对目标 PID 枚举到的**第一个**顶层窗口无脑 `ShowWindowAsync(hWnd, 9)`。现改为先筛选：只恢复「已可见 / 已最小化」或「有标题 + `WS_EX_APPWINDOW` + 非 `WS_EX_TOOLWINDOW`」的候选，找不到就返回 `false` 什么都不做。

### 配套：把诊断脚本修成可信的

`_test_daemon/diagnose-taskbar.js` 早期版本有两个实测缺陷：① 依赖 `tasklist /V` 的中文「暂缺」判断有无窗口，UTF-8 下变乱码导致过滤失效（把系统进程全列了出来）；② 优先走 `wmic`，而该机器安全策略直接拦截 `wmic.exe`。

现在改为：

- 统一走 PowerShell，并强制 `[Console]::OutputEncoding=UTF8`，报告写 UTF-8；
- 用 `EnumWindows` 直接列出**所有可见顶层窗口**（pid / owner / exstyle / 类名 / 标题）—— 这才是任务栏图标的真正来源（`MainWindowHandle` 会漏掉同一进程的第二个窗口，正是本 bug 的形态）；
- 交叉输出 `Get-Process MainWindowHandle != 0` 与进程树、`conhost` 及其可见性；
- 修掉 C# 里 `'no-owner'` 单引号导致的多字符字符字面量编译错误（`Add-Type` 会直接失败）。

实机结果（本机当前状态）：`WorkBuddyAI.exe pid=9772` 只有 **1** 个可见顶层窗口（`Chrome_WidgetWin_1`，标题 `WorkBuddy AI`），**没有任何辅助进程带可见窗口** —— 与「部分机器才复现」的描述一致。


## 一之五、顺带修掉：隔离测试会把用语写进用户**真实**的 `settings.json`

排查 T11 用例随机失败时发现的**真问题**（非本轮引入，但本轮修掉）。

`settings.json` 是**客户端自己的**配置文件，位置由 profile 决定（国内版 `~/.workbuddy`、国际版 `~/.workbuddy-ai`），**不跟随 `WBSWITCH_DATA_DIR`**：

```js
function workbuddySettingsPath() {
  return path.join(PROFILE.dataRoot, 'settings.json');
}
```

于是隔离测试实例（`WBSWITCH_DATA_DIR=data4`）在跑「快捷短语增删」用例时，实际写的是 `C:\Users\Administrator\.workbuddy\settings.json`。两个后果：

1. **污染用户真实配置** —— 实测该文件里躺着 `T11 常用语甲/乙/丙/丁`，用户原本的默认短语「继续执行」被测试的「先清空再写入」逻辑删掉了；
2. **用例受上一轮残留影响而随机失败** —— 上一轮结束时留下 4 条，下一轮 `T11e` 期望 3 条却拿到 4 条（`T11e/T11f/T11g/T11h` 四项连带失败）。

**修复**：新增一个**仅供测试**的显式覆盖开关（生产环境不设置该变量，行为完全不变）：

```js
function workbuddySettingsPath() {
  // 测试隔离开关：WBSWITCH_SETTINGS_FILE 显式指定 settings.json 位置。
  const override = String(process.env.WBSWITCH_SETTINGS_FILE || '').trim();
  if (override) return override;
  return path.join(PROFILE.dataRoot, 'settings.json');
}
```

`test-run.sh` 里补上 `WBSWITCH_SETTINGS_FILE="$DATADIR/settings.json"`，并新增回归用例：

| 断言 | 含义 |
|---|---|
| `T11l 测试用语只写入隔离 settings.json，不污染用户真实配置` | 隔离文件里有测试用语 **且** 用户真实文件里没有 |

同时把用户真实配置里被写入的 4 条测试用语清理掉、恢复默认短语「继续执行」（原文件已备份到 `_tmp/settings-cn.before-cleanup.json`）。

> 另：`run-tests.js` 里 `fs.rmSync` 会被 WorkBuddy 的 safe-delete shim 接管（走回收站二进制），实测偶发 `ETIMEDOUT` 会把整个套件打挂。现已改为「删不掉就退化成清空内容」，对往返校验同样有效且不再中断。

## 一之三、1.2.11 新增：上弹面板行内新增常用语 + 短语随账号同步

### 需求（用户原话）

> 在国内版，国际版的输入框内的那个图标功能你改一下：点击后，向上弹出的发送常用语的选择，但是没有添加功能呀。你在下面第 1 行加一个添加按钮，点击添加按钮后，上面多一行空白的，我可以粘贴常用语或输入进去就就行了。CTRL+回车 自动保存成功。这些自定义的用语，在改出软件配置、帐号时，也要一起导出，将来导入时，先检查有没有相同的，没有话，自动添加到这个位置来。

### 实现要点

**（1）面板底部第 1 行加「+ 添加」按钮**（`inject.js`，explore 面板 HTML）

底部行原本只有右侧的「点击后发送 / 编辑 →」，现改为左右两段：左侧是新增的 `#wbs-explore-add`，右侧内容用 `.wbs-explore-foot-right` 包起来。加号图标 `QP_PLUS_SVG` 按 12px 文字尺寸对齐（`width/height=12`）。

右侧那个链接（`.wbs-explore-edit`）的文案由「编辑 →」改为 **「进入插件设置」**：它点下去是唤起 LDCodex 面板并跳到「增强」页的快捷短语管理区，叫「编辑」名不副实。文案变长（4 字 → 6 字）后补了 `white-space:nowrap`，防止中文被折成两行；实机实测单行 72×16px，底部行左右两段合计 202px，容器内容区 268px，余量充足。

**（2）点「添加」→ 列表顶部插入空白行 → Ctrl+Enter 保存**

`exploreAddRow()` 在 `#wbs-explore-list` 的**首位**插入一行 `.wbs-explore-edit-row`，内含自适应高度的 `<textarea>`；`Ctrl/Cmd+Enter` 在**捕获阶段**拦截并 `preventDefault + stopPropagation`（客户端自身把 Ctrl+Enter 绑成了「发送」，不先吃掉会被抢走），随后 `exploreSaveRow()` 调 `/api/quick-phrase-add`；`Escape` 取消。

三个必须处理的陷阱（已在代码注释里写明原因）：

| 陷阱 | 处理 |
|---|---|
| 面板由 hover 驱动显隐，鼠标移开即 `visibility:hidden`，而隐藏元素**收不到键盘输入**，Ctrl+Enter 会失效 | 编辑期间给按钮挂 `wbs-explore-editing`，用一条特异性更高的规则强制展开 |
| `renderExploreOptions()` 用 `innerHTML` 重建列表，会**冲掉输入到一半的草稿** | 函数开头 `if (exploreEditRow) return;` |
| 外层按钮的 `mousedown` 被 `preventDefault()`（防输入框失焦），事件冒泡会让点 textarea 拿不到焦点 | textarea 与添加按钮都 `stopPropagation()`，再程序化 `focus()` |

另有 `data-saving` 防 Ctrl+Enter 连击重复提交、`acMenuClose()` 关闭面板时收掉未保存的编辑行、动态节点显式补 `applyI18n()`。

**（3）常用语随账号备份一起导出 / 导入去重**

daemon 侧抽出可复用的 `mergeQuickPhrases(incoming)`：按 `text`（trim 后）去重，**已存在的跳过、其余追加**，没有新增时不写盘（避免无谓整文件重写 `settings.json`）。

- 账号导出：payload 增加 `phrases` 字段（`exportType` / `version` **不变** → 旧文件仍可导入，新文件旧版本读到会忽略该字段）；响应增加 `phraseCount`。
- 账号导入：`payload.phrases` 走 `mergeQuickPhrases` 合并；响应增加 `phrasesImported` / `phrasesSkipped`。短语合并**单独 try/catch**，失败不会把已成功的账号导入判为失败（否则用户会重复导入账号）。
- 前端：导出/导入成功提示带上短语条数；全部已存在时明确提示「没有新的账号或常用语需要导入」，而不是静默无反应。

### 顺带修掉的 i18n 缺陷：模板键被放进了 `EN_PLAIN`

前端字典分两张表：`EN_PLAIN`（`t()` 用）与 `EN_TEMPLATE`（`tf()` 用，键含 `{0}` 占位符）。`t()` 只查 `EN_PLAIN`、`tf()` **只查 `EN_TEMPLATE`**，找不到就原样返回中文。

而「账号导出 / 导入」这几条带占位符的提示一直被放在 `EN_PLAIN` 里 → 英文环境下**一直显示中文**（`tf()` 在 `EN_TEMPLATE` 里查不到）。本次把 5 条模板键归位：

| 键 | 原位置 | 现位置 |
|---|---|---|
| `已导出{0}个账号到：{1}` | EN_PLAIN | EN_TEMPLATE |
| `已导入{0}个账号，现在可以一键切换。` | EN_PLAIN | EN_TEMPLATE |
| `有{0}个文件导入失败：{1}` | EN_PLAIN | EN_TEMPLATE |
| `已导出{0}个账号、{1}条常用语到：{2}`（新） | — | EN_TEMPLATE |
| `已导入{0}个账号、{1}条常用语，现在可以一键切换。`（新） | — | EN_TEMPLATE |

`tools/i18n-verify.mjs` 前后对比（同一份源码）：

| 指标 | 修复前 | 修复后 |
|---|---|---|
| `template` MISSING | 32 | **27** |
| `template` translated | 119 | **124** |
| `plain` STALE | 159 | **156** |
| `plain` MISSING | 144 | **143** |

> 仍存在**项目级**既有技术债：`plain` 143 MISSING / 156 STALE、`template` 27 MISSING / 24 STALE（大量字符串被 `t()/tf()` 包裹但字典缺失，或字典条目无人引用）。**非本次引入**，未在本轮处理。

### 与既有增强页入口的关系

增强页的快捷短语管理区（`#wbs-qp-area`）保持不变，两个入口共用同一份 `settings.json` 的 `wbs.session.phrases`，新增后两边同步刷新。

## 一之二、1.2.10 修掉的缺陷：「弹窗自动点允许」长期不生效

### 现象

免打扰里 5 个开关**全部处于开启状态**（`~/.workbuddy-ai/settings.json` 的 `wbs.noDisturb.state` 实测 `autoApprove: true`），面板里的复选框也是勾选态，但**弹窗出现时不会被自动点掉**。

### 根因（实机复现）

`inject.js` 的 `ndApprovalContext()` 带一道「扣费弹窗防护」：若弹窗附近出现积分/付费类文案，就不自动点，避免误点图片/视频生成的扣费确认。但它的取样循环**会从按钮一路向上探到 `document.body`**：

```js
for (var creditDepth = 0; creditDepth < 8 && creditBox; creditDepth++) {
  creditBox = creditBox.parentElement;
  if (creditBox && ND_CREDIT_PATTERN.test(String(creditBox.textContent || '').slice(0, 700))) {
    creditSeen = true; break;
  }
}
```

而 WorkBuddy 首页常驻一条邀请横幅 —— 「好友加入，**积分**上涨邀请一位好友可获得 100 积分」。于是 `body.textContent` 必然命中 `ND_CREDIT_PATTERN`（含「积分」），`creditSeen` 恒为 `true`，分类器一律返回 `null` → **任何确认弹窗都不会被自动点允许**。

CDP 实机对比（同一个合成「允许/拒绝」权限弹窗，真实页面上执行）：

```json
{ "旧逻辑": { "kind": null,  "creditSeen": true  },
  "新逻辑": { "kind": "once", "creditSeen": false } }
```

纯判定逻辑侧同样复现：

```json
{ "前700字含积分类词": true,
  "命中片段": "...好友加入，积分上涨邀请一位好友可获得 100 积分",
  "分类结果_真实页面": null,
  "分类结果_若页面无积分": "once" }
```

也解释了为什么审计日志里只留下寥寥 4 次成功记录（`audit-log/no-disturb.jsonl`，09-12 19:59 与 09-13 02:18）——那几次恰好是弹窗层级较深、或横幅尚未渲染的时刻。

### 修复

`inject.js` 新增取样范围约束，**页面根永不参与扣费判定，也不作为决策容器**：

```js
var ND_CREDIT_SCOPE_MAX = 1200;
function ndIsPageRoot(el) {
  return !!el && (el === document.body || el === document.documentElement);
}
function ndCreditText(el) {
  if (!el || ndIsPageRoot(el)) return '';       // 页面根不取样
  var full = String(el.textContent || '');
  if (full.length > ND_CREDIT_SCOPE_MAX) return '';  // 页面级超长包裹层同样排除
  return full.slice(0, 700);
}
```

扣费探测循环与主循环都改用 `ndCreditText()`，并在主循环补 `if (ndIsPageRoot(box)) break;`。

### 效果

- 首页带「积分」横幅时，权限确认弹窗**恢复正常自动点允许**；
- 真正的扣费弹窗（弹窗自身含「本次生成将消耗 30 积分」）**仍被拒绝**，防护没有被削弱；
- 通用「确认 / 取消」弹窗依旧不被点（保持「宁可漏点也不错点」）。

## 二、1.2.9 修掉的三个真实缺陷

## 二、1.2.9 修掉的三个真实缺陷

### 缺陷 1（严重）：`WBSWITCH_CDP_PORT` 一票否决了 CDP 端口隔离

`daemon.js` 的 `cdpPortOwnedByOtherProfile()` 旧实现：

```js
if (process.env.WBSWITCH_CDP_PORT) return false;   // 一旦设置，不排除任何兄弟端口
```

而管理器 `workbuddy.rs:536` **每次拉起 daemon 都会下发该变量**：

```rust
.env("WBSWITCH_CDP_PORT", profile.cdp_port().to_string())
```

也就是说：**生产环境下这道隔离保护从来没有生效过**（1.2.8 的单元测试恰好没带该变量，测出了假绿灯）。连带影响：

- `selectCdpPort()` / `findAvailableCdpPort()`（重启客户端时分配端口）会把兄弟的保留端口当候选 → 国际版可能把客户端重启到 9222（国内版保留端口）；
- `ownCdpPorts()` 会把对端端口算成自己的 → `cdpTargetMatcher` 退化成宽松匹配。

**修复**：删掉该短路语句；`ownCdpPorts()` 排除兄弟保留端口；显式端口若落在兄弟保留端口上仍按"兄弟端口"处理。

### 缺陷 2（严重）：回退端口区间两端重叠

旧实现让所有 profile 共用 `9226–9232 + 9333` 作为回退段，两端交集非空，双开同时启动时存在抢同一端口的竞态窗口。

**修复**：按 profile 分段 —— 国内 `9236–9245` / 国际 `9246–9255` / CodeBuddy CN `9256–9265` / CodeBuddy 国际 `9266–9275`；并去掉全体共用的 `9333`（客户端真在 9333 时 `cdp-port.json` 会把它带进候选）。

### 缺陷 3（严重）：收件箱目录不可写会击穿 daemon

`automation.js` 的 `importAgentInbox()` 里 `fs.mkdirSync` 未做保护，1 秒一次的定时器上一旦抛出 `EPERM`，daemon 顶层 `uncaughtException` 会在 5.5 秒后 `process.exit(1)` —— 客户端面板随即全线 `Failed to fetch`。

**修复**：`importAgentInbox` 降级为「本轮没有可导入的任务」；启动阶段的 `ensureAgentBridge` 也包了 try/catch。**这正是用户遇到的「Failed to fetch 不停弹出」的一条真实成因。**

## 三、功能接口测试明细（35/35 通过）

### T0 环境
隔离 daemon 在 47999 正常提供 HTTP；API token 读取正常（64 位 hex）

### T1 鉴权
无 token 访问受保护接口 → 401 ✅；`/api/status` 公开路径 → 200 ✅

### T2 双开隔离自检 `/api/profile/isolation`（1.2.9 重写）
改为**探测实际监听端口 + 页面归属强信号**判定，不再拿 `cdp-port.json` 历史值当结论：

- 返回 `sides` / `isolated` / `conflicts` / **`warnings`** / `daemonVersion=1.2.9` ✅
- 每端新增 `cdpListening`（实际监听探测结果）与 `cdpLivePort` ✅
- 两 profile 面板端口不重叠（47832 vs 47833）✅
- 两 profile 数据目录不同 ✅
- 两 profile CDP **保留**端口不同（9222 vs 9223）✅

**实测输出（真实环境，AI 客户端跑在 9222）**：

```json
{
  "isolated": false,
  "conflicts": ["WorkBuddy 保留的 CDP 端口 9222 上跑的是其它版本的客户端；请用管理器以正确端口重启 WorkBuddy 客户端"],
  "warnings": ["WorkBuddy AI 客户端当前监听 CDP 9222，本档案保留 9223；建议在管理器里以正确端口重启客户端"],
  "sides": [
    { "id": "workbuddy-cn", "reserved": 9222, "live": 0,    "listening": [{ "port": 9222, "owner": "workbuddy-ai" }] },
    { "id": "workbuddy-ai", "reserved": 9223, "live": 9222, "listening": [{ "port": 9222, "owner": "workbuddy-ai" }] }
  ]
}
```

自检给出的正是**可操作**的结论，而不是 1.2.8 那种「CDP 端口重叠：9222」的含糊误报。

### T3 账号导出 / 导入
导出 `count:1` 落盘 ✅；内容加密（不含明文 uid）✅；导入 `imported:["99001777"]` ✅；**往返字节级一致** ✅

### T4 健壮性
错误密码 / 空密码 / 非 LDCodex 文件 / 文件不存在 —— 四种情况均优雅报错不崩溃 ✅

### T5 导入安全
含 `../evil` 的恶意 uid → 被跳过且未写出任何文件（防路径穿越）✅

### T6 跨版本镜像收敛（1.2.8 核心修复，本次回归）
`alignTreeTimestamps` 文件与目录 mtime 均对齐 ✅；`sessionContentMtime` 只算文件忽略目录 ✅ → 同步即收敛，不再 ping-pong

### T7 回归
`/api/sessions` 200 ✅；镜像开关接口 200 且默认关 ✅

### T8 抗崩溃（1.2.9 修复）
把收件箱父路径构造成「文件」使其必然 mkdir 失败 → `importAgentInbox` **返回 `[]` 而非抛异常** ✅；源码级确认启动阶段 `ensureAgentBridge` 已包 try/catch ✅

### T9 CDP 隔离加固（1.2.9 修复）
源码中已无 `if (process.env.WBSWITCH_CDP_PORT) return false` ✅；存在 `CDP_FALLBACK_BASE` ✅；`cdpPortCandidates` 不再共用 9222–9232 / 9333 回退段 ✅

### T10 弹窗自动点允许（1.2.10 修复）
源码级确认：`ndIsPageRoot` 已定义 ✅；`ndCreditText` 排除页面根 ✅；扣费探测循环在页面根处 `break` ✅；主循环不再把 `body/html` 当决策容器 ✅；`ND_CREDIT_SCOPE_MAX = 1200` 存在 ✅

### T11 快捷短语随账号导出 / 导入去重（1.2.11，真实 HTTP 端到端）
源码级 4 项：`mergeQuickPhrases` 按 `text` 去重 ✅；导出 payload 带 `phrases` ✅；导入调 `mergeQuickPhrases` ✅；响应回传 `phrasesImported/phrasesSkipped` ✅

行为级 7 项（在隔离 daemon 上真跑一遍）：

| 断言 | 实测 |
|---|---|
| 通过接口写入 3 条常用语 | `["T11 常用语甲","T11 常用语乙","T11 常用语丙"]` ✅ |
| 导出响应 `phraseCount=3` | `{"ok":true,"count":1,"phraseCount":3}` ✅ |
| 导出文件解密后含 3 条 `phrases`（`text` + `createdAt`） | 3 条齐全 ✅ |
| 导入「2 重复 + 1 全新」→ 新增 1 / 跳过 2 | `phrasesImported:1, phrasesSkipped:2` ✅ |
| 最终列表 4 条、**无重复**且含新文案 | `[甲,乙,丙,丁]` ✅ |
| **重复导入幂等**（同文件再导 → 新增 0 / 跳过 3） | `phrasesImported:0, phrasesSkipped:3` ✅ |
| 旧版导出文件（无 `phrases` 字段）仍可导入、短语列表不变 | `ok:true, phrasesImported:0`，列表仍 4 条 ✅ |

### T12 上弹面板「添加」入口（inject.js 源码级）
`#wbs-explore-add` 按钮存在 ✅；`exploreAddRow` / `exploreSaveRow` / `exploreEndEdit` 三函数齐全 ✅；`Ctrl/Cmd+Enter` 捕获阶段保存 ✅；`wbs-explore-editing` 覆盖 `wbs-menu-closed` 的强制展开规则存在 ✅；`renderExploreOptions` 含 `if (exploreEditRow) return;` 保护 ✅；`acMenuClose` 调 `exploreEndEdit()` ✅

## 四之二、自动点允许判定测试明细（16/16 通过）

从 `inject.js` 提取真实函数（`classifyNoDisturbApprovalCandidate` / `ndNormalizeLabel` / `ndIsDecisionGroup` / `ndIsPageRoot` / `ndCreditText` / `ndClassifyApprovalCandidate` / `ndApprovalContext`）注入最小 DOM 桩执行：

| 断言 | 结果 |
|---|---|
| `ndIsPageRoot(body/html)` 为真、普通 div 为假 | ✅ |
| `ndCreditText(body)` / 超长容器返回空（页面根不取样） | ✅ |
| 紧凑容器原样返回（扣费判定仍有效） | ✅ |
| 分类器：上下文含「积分」一律拒绝 | ✅ |
| 分类器：「允许」+权限语境 ⇒ `once`；「1允许」规范化后 ⇒ `once` | ✅ |
| 分类器：「始终允许」⇒ `session` | ✅ |
| 分类器：通用「确认」/ 禁用按钮 不通过 | ✅ |
| **回归：首页含积分横幅时，「允许」仍判定为 `once`** | ✅ |
| 回归：判定上下文只取弹窗容器，不含首页积分文案 | ✅ |
| 扣费弹窗（弹窗自身含积分）仍被拒绝 | ✅ |
| 通用「确认/取消」弹窗不被自动点 | ✅ |

## 四、CDP 隔离逻辑测试明细（18/18 通过）

从 `daemon.js` 提取真实函数源码（`validCdpPort` / `cdpPortOwnedByOtherProfile` / `ownCdpPorts` / `cdpPortCandidates` / `cdpTargetMatcher`）注入不同 profile 场景执行：

| 断言 | 结果 |
|---|---|
| 国际版首选 9223，不被脏数据 9222 带偏 | ✅ |
| 国际版候选 = `[9223, 9246…9255]`，无 9222/9224/9225 | ✅ |
| 国内版候选 = `[9222, 9236…9245]`，无 9223 | ✅ |
| **两端候选集零重叠**（交集 `[]`） | ✅ |
| 显式 `WBSWITCH_CDP_PORT=9222` 时国际版**仍排除 9222**（隔离不再让位） | ✅ |
| 显式端口冲突时首选回落本档案保留端口 9223 | ✅ |
| `ownCdpPorts` 不把兄弟保留端口算成自己的 | ✅ |
| AI daemon 在 9222 上**认领**自己的客户端页面（端口漂移仍可用） | ✅ |
| AI daemon 在 9222 上**拒绝**国内版客户端页面（不串台） | ✅ |
| CN daemon 在 9222 上认领自己的 / 拒绝国际版页面 | ✅ |
| AI daemon 在本档案保留端口 9223 上认领自己的页面 | ✅ |

## 四之三、真实页面 UI 只读验证（`_test_daemon/cdp-qp-ui-verify.mjs`）

在**真实运行的 WorkBuddy 客户端页面**（CDP 9222）上核对改造所依赖的锚点与样式假设。**全程只读**：不点击、不落库、不改动既有面板；仅创建一个 `left:-9999px` 的临时容器验证 CSS 解析后立即移除。

### 1. 真实页面锚点（我的 HTML 改造正是基于这些节点）

| 选择器 | 真实页面 | 说明 |
|---|---|---|
| `.wbs-explore-inline`（面板按钮） | ✅ 存在 | class = `wbs-stash-inline wbs-explore-inline wbs-stash-inline-inline` |
| `.wbs-explore-foot`（底部行） | ✅ 存在 | 我的「添加」按钮就插在这一行 |
| `.wbs-explore-edit`（进入插件设置）/ `.wbs-explore-send-txt`（点击后发送） | ✅ 存在 | 被 `.wbs-explore-foot-right` 包起来后仍在 |
| `#wbs-explore-list` / `.wbs-explore-item` | ✅ 存在 | 编辑行 `className='wbs-explore-item wbs-explore-edit-row'` 与既有项兼容 |
| `#wbs-explore-add` / `.wbs-explore-foot-right` / `wbs-explore-editing` 规则 | ❌ 不存在 | **确认当前客户端跑的仍是旧版注入**（`inject.js` 改动需重新构建安装包才生效） |

### 2. 新样式在真实主题下的解析结果

| 检查项 | 结果 |
|---|---|
| `color-mix()` 支持 | ✅ 真实页面解析为 `color(srgb 0.94902 0.94902 0.94902 / 0.8)` |
| CSS 变量解析 | `--wb-border-subtle:#F2F2F2`、`--wb-icon-secondary:rgba(0,0,0,0.7)`、`--wb-button-primary-bg:rgba(0,0,0,0.9)` ✅ |
| **`--wb-bg-input` 未定义时的 fallback 链** | ✅ 正确回退到 `var(--wb-bg-primary,#fff)` → `rgb(255,255,255)` |
| 「添加」按钮 | `display:flex`、`border-radius:999px`、`font-size:12px`、实测 60×25px ✅ |
| 编辑行 `display` | ✅ `block` —— 成功覆盖 `.wbs-explore-item` 的 `display:flex` |
| 输入框在 280px 面板内 | ✅ 铺满 276px、高 32px、`min-height:30px`、`resize:none` |
| 编辑行位于列表首位 / 高度未被压塌 | ✅ 均为真 |
| 临时容器与样式残留 | ✅ 已彻底清理（零副作用） |

> **可访问性取舍（已知）**：按钮实测 25px 高，低于 WCAG AA 的 44px 触摸目标建议。这是**桌面鼠标场景**下的刻意选择 —— 面板内既有元素（「进入插件设置」「点击后发送」均为 12px 文字）统一是紧凑尺寸，保持一致比单点放大更重要。

## 五、关键机制说明：双开为什么会互相影响

客户端（WorkBuddy / WorkBuddy AI）只在启动时读环境变量，事后无法补开调试通道。app.asar 实证：

```js
const cdpPort = process.env.WORKBUDDY_REMOTE_DEBUGGING_PORT;
if (cdpPort && /^\d+$/.test(cdpPort)) {
  electron.app.commandLine.appendSwitch("remote-debugging-port", cdpPort);
}
```

而**用户级环境变量是全局单值**，两个版本读同一个值 → 必然有一个抢不到，于是退回 Electron 默认端口 9222：

- 管理器启动客户端时按 profile 注入（`workbuddy.rs:690`）→ 正确；
- 用户**手动双击**客户端图标 → 只能读到全局值 → 两个版本都想要 9222 → 后启动的那个开不了调试通道。

**实证**：`WorkBuddyAI.exe(9772)` 的 renderer 命令行带 `--remote-debugging-port=9222`，启动于 10:48（当时用户级变量还是 9222，后来被改成 9223 但客户端没重启）。

**配套修复**：
1. 管理器新增「以正确端口重启客户端」按钮（挂在双开隔离自检卡片每一端）；
2. `workbuddy_launch_client` 的 force 路径**先真正结束旧客户端再拉起** —— Electron 有单实例锁，只 spawn 不 kill 会让新进程立刻退出、旧进程继续用旧端口跑，表现为「重启了但还是连不上」；
3. 启动后校验调试端口是否真的就绪，不就绪时明确报「通常是另一个版本占用了同一端口」，而不是假成功。

## 六、复跑方式

```bash
# 功能接口测试（自动起停隔离 daemon）
bash D:/LUODA/LDcodex/_test_daemon/test-run.sh
# CDP 端口隔离逻辑（纯本地，无需 daemon）
"C:/Users/Administrator/.workbuddy-ai/binaries/node/versions/22.22.2-2/node.exe" D:/LUODA/LDcodex/_test_daemon/verify-cdp-isolation.js
# 自动点允许判定逻辑（纯本地，无需 daemon）
"C:/Users/Administrator/.workbuddy-ai/binaries/node/versions/22.22.2-2/node.exe" D:/LUODA/LDcodex/_test_daemon/verify-no-disturb.js
# 真实页面 UI 只读验证（需客户端已开 CDP；参数为 CDP 端口，默认 9222）
"C:/Users/Administrator/.workbuddy-ai/binaries/node/versions/22.22.2-2/node.exe" D:/LUODA/LDcodex/_test_daemon/cdp-qp-ui-verify.mjs 9222
# 任务栏图标诊断（只读；在"任务栏出现多余图标"的现场跑，结果见 taskbar-diagnose-report.txt）
"C:/Users/Administrator/.workbuddy-ai/binaries/node/versions/22.22.2-2/node.exe" D:/LUODA/LDcodex/_test_daemon/diagnose-taskbar.js
# Rust 单元测试（窗口打分 / 辅助窗口黑名单）
cd D:/LUODA/LDcodex && cargo test -p codex-plus-core --lib windows_integration
# 前端类型检查
cd D:/LUODA/LDcodex/apps/codex-plus-manager && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```

## 七、遗留事项

- 用户级环境变量 `WORKBUDDY_REMOTE_DEBUGGING_PORT` 仍是全局单值。它是「手动双击启动也能用 CDP」的兜底，但双开时必然冲突。当前策略：保留它，靠管理器的「以正确端口重启客户端」纠正。
- **daemon 单实例锁存在主/备双锁竞态**（本次实测到同 profile 同时跑了两个 daemon：pid 7872 与 pid 10720）。`acquireDaemonLock()` 的候选是 `[主锁, 备锁]`，两个进程可能各持一个都认为自己独占。未修：改动锁逻辑一旦出错会让 daemon 起不来，需单独设计后验证。
- **daemon 会继承客户端注入的 `NODE_OPTIONS`**（实测：`--require .../WorkBuddyAI/resources/app.asar.unpacked/cli/vendor/shim/node-language-shim.cjs`）。该 shim 代理 fs 操作，会把部分操作拦成 `EPERM`（如 `mkdir .../automation-agent/inbox`、`watch .../CodeBuddyExtension/.../auth`）。1.2.9 的抗崩溃加固已让 daemon 不再因此退出；彻底规避可在 `spawn_daemon` 里 `env_remove("NODE_OPTIONS")`。
- **前端 i18n 技术债**：`tools/i18n-verify.mjs` 目前仍报 `plain` 143 MISSING / 156 STALE、`template` 27 MISSING / 24 STALE。成因是「模板键被放进 `EN_PLAIN`」与「字典条目无人引用」两类，属**既有**问题（本轮只归位了账号导出/导入这一区块的 5 条）。建议后续单独跑一轮 `tools/wb-i18n-fill.mjs` + `tools/i18n-codemod.mjs` 统一清理。
- **安装包需重新构建才能生效**：当前已安装版本是 **1.2.8**，1.2.9 / 1.2.10 / 1.2.11 / 1.2.12 的全部改动（CDP 隔离、弹窗自动点允许修复、上弹面板行内新增常用语、短语随账号同步、任务栏幽灵图标修复）都在源码里，需要 `npm run build` 重新出包并安装后才会生效。安装包还需带上 `windows/hooks.nsh`（安装时自动结束占用进程）。
- **任务栏图标若仍复现**：在出现图标的现场运行 `_test_daemon/diagnose-taskbar.js`，把 `taskbar-diagnose-report.txt` 发回。报告「一」里若出现同一 `WorkBuddyAI.exe` PID 的**多个** no-owner 可见窗口，说明还有别的路径在显示隐藏窗口；若只有一个窗口但任务栏仍有两个图标，则是任务栏身份问题（可试 `LDCODEX_REBRAND_TASKBAR=1` 反向确认）。
