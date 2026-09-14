# LDCodex 88.8.5：账号「下次重置」倒计时 + 切换流水 + 面板外框跟随内容 + 修掉「根本装不上」的自杀 bug

> ## 🔴 最重要的一条：88.8.3 / 88.8.4 的**第一版**安装包**根本装不上**，已修
>
> `windows/hooks.nsh` 里那条 PowerShell 兜底用 `-like '*LDCodex*'` 匹配要结束的进程，
> 而**安装程序自己就叫 `LDCodex_88.8.4_x64-setup.exe`、路径里必然带 `LDCodex`**
> → 它把**自己** `Stop-Process` 掉了。
>
> 表现（极具迷惑性）：静默 `/S`、被动 `/P` 都是 **3~5 秒后退出、退出码 -1、不弹任何错误**，
> 一个文件都没写、注册表也没动；而**双击非静默时窗口能正常打开**，因为停在欢迎页、
> 根本没执行到那一步 —— 所以「能打开窗口」完全不代表安装器是好的。
>
> 这个钩子是 **88.8.3 才引入**的，所以 88.8.1 能装、之后全装不上。
> 用户反复报的「卸载不了 / 装不了」根源就在这里（旧卸载器那条只是障眼法）。
> **修法**：过滤条件排除「安装器 / 卸载器自己」—— 按进程名加
> `-notlike '*setup*.exe'` 与 `-notlike '*uninstall*.exe'`（`$EXEPATH` 只保护自己，不够）。
> 详见 [第七节 ⑧](#八-88_8_3--88_8_4-装不上的真凶安装器把自己杀了)。
>
> 修完上面这条又暴露了**第二个自杀路径**：卸载器会把「正在 `ExecWait` 等它的安装器」一起杀掉
> （`$EXEPATH` 只等于自己，保护不到父进程）。已改为**按进程名排除** `*setup*.exe` / `*uninstall*.exe`。
> 详见 [第七节 ⑨](#九-修完自杀后-p-仍然失败卸载器把正在等它的安装器杀了)。
>
> 当前 `target/release/bundle/nsis/LDCodex_88.8.4_x64-setup.exe`（23:07 重编）两处都已修复，实测
> `/S /UPDATE` **16.3 秒装完、ExitCode 0**、`/P` 覆盖安装 **22.5 秒、ExitCode 0**、
> `DisplayVersion = 88.8.4`、核验 **7/7 ✅**、测试 **127/127 ✅**。

> 本轮改动：`workbuddy-runtime/account-usage.js`（升 v2：切换流水 + 下次重置；修 `localDay` 格式 bug）｜ `workbuddy-runtime/daemon.js`（新增 `/api/account/usage/summary`）｜ `src/App.tsx`（「下次重置」倒计时卡 + 「最近切换」流水卡）｜ `src/styles.css`（`.fill` 加 `align-self: start`）｜ `src-tauri/src/lib.rs`（托盘悬停提示）｜ `workbuddy-runtime/inject.js`（插件面板布局）｜ `src-tauri/windows/hooks.nsh`（安装器钩子重写）｜ 版本号 6 处来源统一升到 `88.8.5` ｜ `_test_daemon/*`（新增 T22/T23 + 三个布局实测脚本 + `account-usage.test.js`）
> 测试：**146/146 + account-usage 16/16 + 16/16 + 布局实测 14/14 + 插件面板实测 60/60（含关于页）+ .fill 实测 30/30 + 前端 159/159 + Rust 70/70 + 2/2 + tsc 全绿**

## 一句话结论

三件事：一件是**新功能**（托盘悬停提示），一件是「修得对但你没装上」，一件是「真的没修」。

1. **托盘图标现在有悬停提示了** —— 鼠标移到 Windows 右下角托盘图标上，会显示「LDCodex 管理工具 v88.8.4 · 左键显示窗口，右键打开菜单」。此前 `install_tray` 只设了图标和右键菜单、**没设 tooltip**，悬停时基本是空白。
2. **你没装到 88.8.2** —— 安装目录里躺的还是 **88.8.1**（`C:\Program Files\LDCodex\workbuddy-runtime\daemon.js` 写着 `DAEMON_VERSION = '88.8.1'`，目录时间 17:15，而 88.8.2 的包是 17:48 出的）。原因是「已安装」页选「安装前卸载」时，安装器去调**旧版**卸载器，而旧卸载器删不掉**正在运行**的 `LDCodexManager.exe`（当时 PID 5008），删完文件还在原地 → 命中 `FileExists "$INSTDIR\LDCodexManager.exe"` → 弹「无法卸载！」并 `Abort`，升级中断。**所以你看到的「帐号 / 会话 / 增强超出底边框」全是 88.8.1 的表现。**
3. **插件面板确实有独立的溢出问题，上一轮没修** —— 用户点名的「帐号 / 会话 / 增强」正是插件面板（注入到 WorkBuddy 客户端里的那套 UI）的页签。它被 `inject.js` 里**两处硬编码 / 估值**撑爆，且其中一处是 **JS 内联样式**，改 CSS 根本没用。

三件事本轮都做了。

---

## 零、账号切换流水 + 「下次生效」倒计时（88.8.5 新增）

### 需求（用户原话）

> 「另外，我要你记录 每次切换的时间，到时候就可以知道 下一次生效是什么时候。」
> 「我的目的很简单：就是想知道下次生效是什么时候？因为现在一天后会重置。」
> ⚠️ 「**不是每天0点，是每次我用完后切换的时间**」

### 做了什么

WorkBuddy 账号页（管理器的「账号」页签）现在多两张卡片：

| 卡片 | 内容 |
|---|---|
| **下次生效** | 「上次切换：`<时间>`」→ 生效时刻 + **按秒倒计时**「距生效还有 19 小时 12 分 03 秒」；到点后变「已生效，现在切回去即可」 |
| **最近切换** | 最多 5 条 `A → B` + 时间；完整流水保留 50 条（环形，最新在前） |

### ⚠️ 关键语义：**起点是「上次切换的时刻」，不是日历日 00:00**

这一点被用户当面纠正过一次，别再改回去：

| 版本 | 算法 | 结果 |
|---|---|---|
| ❌ 第一版 | 本地自然日，重置点 = 明天 `00:00` | 用户：「不是每天0点，是每次我用完后切换的时间」 |
| ✅ 现在 | **最后一次切换的时刻 + 24 小时**（滚动窗口） | 每次切号计时重新开始 |

实现要点：

- `account-usage.js` 的 `RESET_WINDOW_MS = 24 * 60 * 60 * 1000`，`nextEffectiveAt(lastSwitchAt, now)`；
- 起点取 `history` 里**最后一条**的 `at`（中间切过几次都不算）；
- 由守护进程 `/api/account/usage/summary` 下发 `lastSwitchAt` / `nextEffectiveAt` / `ready`，
  前端只按秒倒数；到点后自动重拉一次；
- 从没切过号 → `lastSwitchAt` 为 null → 不显示这张卡（没有「上次切换」就无从算起）。

### ⚠️ 顺带修掉的隐蔽 bug：「今日切换 N 次」一直是 0

`account-usage.js` 的 `localDay()` 曾经拼成 **`"2026-0913"`**（月份和日之间漏了 `-`）。
因为它自己写自己读、格式自洽，**单看这个函数完全正常**；但 daemon 是这么调的：

```js
const today = todayStr();                    // "2026-09-13"（正确的 YYYY-MM-DD）
const usageByUid = accountUsageStore.all(today);   // 内部比 e.day === day
```

`"2026-0913" !== "2026-09-13"` → `today` 恒为 0 → 界面上「今日切换 N 次」永远显示 **0 次**。

修法：改成与 daemon `todayStr()` **逐字符一致**，并新增一条测试——直接把 `daemon.js` 里的
`todayStr` 抠出来，对三个时刻逐一比对两边输出，防止再各自漂移。

### 测试

| 项目 | 结果 |
|---|---|
| `_test_daemon/account-usage.test.js` | **16/16**（含「差 1 毫秒到 24 小时」、跨过 24 小时、非法起点、无记录、取最后一次切换） |
| `run-tests.js` T23 系列（7 项源码守卫） | PASS —— 其中 T23b 明确禁止 `setHours(24)` / `getDate() + 1` 这类日历日写法 |

---

## 零之三、插件「关于」页重整 + 版本号只显示自己（88.8.5）

用户要求：

> 「国内版和国际版插件的『关于』页排版重新整理」
> 「『推荐开启』和左侧的『发送错误诊断』等，删除」
> 「插件对话框左上角版本号只写自己 88 开头的版本号」

| 项 | 改动 |
|---|---|
| 删除 | 「发送错误诊断」卡（连带左侧那句「推荐开启」）、「会话监听日志」调试卡 |
| 新增 | 元数据行排版 `wbs-about-meta` —— 插件版本 / 注入方式，左右对齐 |
| 版本行 | 面板左上角**只显示 `v88.8.5`**；以前是「WorkBuddy 客户端版本 (88.8.x)」，前者用户根本不关心，两个版本号挨一起还容易看错 |
| 连带 | 删掉 `wbsClientVersion()`（从 UA 抠 WorkBuddy 客户端版本的 helper，已无调用方） |

⚠️ 删卡后要确认三处都判空：`wireTelemetrySettings()`、`acRenderMonitorLogModal()`、
隐藏工具入口的 `#wbs-monitor-log-card` —— 它们都是 `querySelector` + 判空，取不到直接 `return`，安全。

守卫：`run-tests.js` T24 系列 8 项。其中 T24b/c 的断言范围**限定在 `buildAboutPane()` 区块内** ——
`inject.js` 的 i18n 词典里仍保留「发送错误诊断 / 推荐开启」词条（那是英文映射表，不是页面结构），
全文件搜会一直命中、断言形同虚设。

另外补了两条「防止以后退化」的守卫：
- **T24g**：删卡后代码里还有 4 处 `querySelector` 去取这些元素，逐条扫描要求都有判空 ——
  否则谁加一句没判空的 `el.textContent = …`，打开「关于」页就抛 TypeError、整个面板白屏。
- **T24h**：布局夹具 `plugin-panel-harness.html` 必须复刻「关于」页，且是**删卡后**的结构
  （有 `wbs-about-meta`、无诊断卡）—— 不复刻那 12 项实测就是量空气。

**实测**：「关于」页已加进插件面板布局实测（无头 Chrome 量真实样式表），
900 / 760 / 620 / 520 四种窗口高度下**面板顶边不被裁、内容不溢出**（520px 时内容底边 401 vs 面板底边 403），
**60/60 全部通过**（原 47 项 + 关于页 12 项 + 1 项反向自检）。

---

---

## 零之二、托盘图标悬停提示（88.8.4 遗留说明）

### 需求（用户原话）

> 「在右下角托盘里面的文字说明。鼠标移到图标上面，就有出来的提示文字」

### 根因

`src-tauri/src/lib.rs` 的 `install_tray` 建托盘时只设了三样东西 ——
图标（`.icon(...)`）、右键菜单（`.menu(...)`）、左键单击/双击的行为（`.on_tray_icon_event`），
**没有 `.tooltip(...)`**。Windows 托盘在没有 tooltip 时悬停基本是空白（或只显示进程名），
用户看不到任何说明。`update_tray_labels`（语言切换时由前端调用）也只改了菜单项文字和窗口标题，同样没碰 tooltip。

### 改法

| 位置 | 改动 |
|---|---|
| `src-tauri/src/lib.rs` | 新增 `tray_tooltip_default()` / `resolve_tray_tooltip()`；`install_tray` 加 `.tooltip(tray_tooltip_default())`；`update_tray_labels` 新增 `tooltip: Option<String>` 参数并调用 `tray.set_tooltip(...)` |
| `src/App.tsx` | 英文分支（`getLanguage() === "en"`）多传一个 `tooltip`，文案含 `{version}` 占位符 |
| `src-tauri/src/commands.rs` | 新增测试 `tray_icon_exposes_hover_tooltip_with_workspace_version`（6 条断言）守这个机制 |

**关键设计：版本号只有一处来源。** tooltip 里的版本号取自
`env!("CARGO_PKG_VERSION")` —— 它继承 `Cargo.toml` 的 `[workspace.package] version`（唯一权威来源），
所以以后升级版本号时**不用**回来改 tooltip。前端只负责本地化措辞，并把版本号写成 `{version}` 占位符，
由 Rust 侧替换。这样既不会多出第 7 处要手工同步的版本号来源，也不会出现「中文有版本号、英文没有」这类不一致。

默认文案（中文，Rust 内置）：

```
LDCodex 管理工具 v88.8.4 · 左键显示窗口，右键打开菜单
```

英文环境（前端传入）：

```
LDCodex Manager v{version} · Click to show the window, right-click for the menu
```

> ⚠️ Windows 托盘 tooltip 上限 **127 字符**（`NOTIFYICONDATA::szTip` 是 128 wchar），别写太长。
>
> ⚠️ 语言是**加载时确定、切换即重载 webview**（见 `src/i18n.ts` 顶部注释），所以
> `App.tsx` 里那个 `[]` 依赖的 effect 每次加载都会跑，tooltip 能正确跟随语言 —— 不需要额外监听语言变化。

### 怎么验证

- **静态**：`cargo test -p codex-plus-manager --lib tray_icon_exposes_hover_tooltip_with_workspace_version`
  —— 断言必须设 `.tooltip(...)`、必须能 `set_tooltip`、必须有 `{version}` 占位符机制、
  tooltip 相关代码段里**不得出现硬编码版本号**（`88.`）、默认文案必须带产品名、`App.tsx` 英文分支必须传 `tooltip`。
- **手动**：跑起管理器，鼠标停在右下角托盘图标上 → 应显示上面那句中文说明。

---

## 一、先定位：为什么「装不上」

| 证据 | 结果 |
|---|---|
| `C:\Program Files\LDCodex\workbuddy-runtime\daemon.js` | `DAEMON_VERSION = '88.8.1'`，`release-88.8.1-20260913-unified-version-taskbar-and-account-usage` |
| `C:\Program Files\LDCodex\` 目录时间 | `2026-09-13 17:15`（88.8.1 的包 17:07 出的） |
| 88.8.2 出包时间 | `17:48:52` —— 安装目录**从未**被更新 |
| 正在运行的进程 | `LDCodexManager.exe` PID 5008 → `C:\Program Files\LDCodex\LDCodexManager.exe` |
| 截图文案出处 | `target/release/nsis/x64/SimpChinese.nsh:15` 的 `olderOrUnknownVersionInstalled`（`$R4` 被填成「旧的」） |

### 失败链路

```
用户点「安装前卸载」
  → installer.nsi 的 PageLeaveReinstall 执行
      ExecWait '"C:\Program Files\LDCodex\uninstall.exe" _?=C:\Program Files\LDCodex'
  → 旧卸载器删 $INSTDIR\LDCodexManager.exe —— 文件被运行中的进程占用，删不掉（NSIS 的 Delete 静默失败）
  → 卸载器正常退出（$0 = 0），但文件还在
  → installer.nsi:360  ${If} $0 <> 0 ${OrIf} ${FileExists} "$INSTDIR\LDCodexManager.exe"
  → MessageBox "$(unableToUninstall)"  ← 你看到的「无法卸载！」
  → Abort
```

关键点：**旧卸载器已经装在用户机器上了，我们改不了它**。所以只能让**新安装器**抢在「已安装」页面出现之前把程序关掉。

---

## 二、安装器怎么修

`apps/codex-plus-manager/src-tauri/windows/hooks.nsh` 重写。核心是注册一个 **`.onGUIInit` 回调**：

```nsis
!define MUI_CUSTOMFUNCTION_GUIINIT LDCodexOnGuiInit
```

**为什么这个 define 有效**：MUI2 是在「**第一个 `MUI_LANGUAGE` 被 include 时**」才展开 `MUI_FUNCTION_GUIINIT`（也就是 `.onGUIInit`），而 `hooks.nsh` 是在 `installer.nsi` 顶部（第 28 行）被 include 的，**早于**语言文件（第 464 行）。`.onGUIInit` 在 `.onInit` 之后、**任何页面显示之前**执行 —— 正好赶在「已安装」页面之前。

| 改动 | 说明 |
|---|---|
| 新增 `.onGUIInit` 回调 | 检测到 `LDCodexManager.exe` 在跑就弹窗告知（点「确定」自动关闭并继续；点「取消」退出安装程序让你自己从托盘退），静默安装（`/S`）**不弹窗**直接关 |
| 停进程改成「轮询直到真的退出」 | 最多 12 轮 × 500ms，最后再等 800ms 释放文件句柄。只发一次 `taskkill` 就往下走是**不够**的 —— 句柄还没释放，紧接着写文件照样失败 |
| 三种手段叠加 | `taskkill /IM … /F /T`（连带子进程）＋ PowerShell 兜底按「命令行含 `workbuddy-runtime`」精确杀掉独立跑的 daemon（`resources\node\node.exe daemon.js`），绝不误杀用户其它的 `node.exe` |
| 保留 `NSIS_HOOK_PREINSTALL` / `PREUNINSTALL` | 覆盖安装（选「请勿卸载」）与以后版本的卸载也一并受益 |

### 踩坑记录（下次改这个文件前必看）

| 坑 | 现象 | 解法 |
|---|---|---|
| `nsis_tauri_utils::` 用不了 | 编译直接失败：`Plugin not found, cannot call nsis_tauri_utils::FindProcess` | 该插件的 `!addplugindir` 在 `installer.nsi` 第 89 行，而 `hooks.nsh` 第 28 行就被 include 了。只能用**默认插件目录**里的 `nsExec` |
| `${StrLoc}` / `${StrCase}` / `${StrRep}` 用不了 | 编译失败：`Call must be used with function names starting with "un." in the uninstall section` | 这些宏展开成 `Call StrLoc`，而卸载区要求 `Call un.StrLoc`。本文件的宏同时被插进安装/卸载两处，所以必须绕开 —— 进程探测改用 `cmd /c tasklist /FI … \| find <镜像名>` 的**退出码**（0=找到，1=没找到），零字符串函数、不受系统语言影响 |
| 手写 label 会撞名 | 宏插入多次 → 标签重复定义 | 用 LogicLib 的 `${If}` / `${Do}` / `${Loop}` / `${Break}`（内部生成唯一标签） |

### 正向验证

单独跑一次 makensis 就能确认回调真的接上了：

```bash
cd target/release/nsis/x64
env -u NSISDIR -u NSISCONFDIR /e/devtools/tauri-cache/NSIS/makensis \
  -INPUTCHARSET UTF8 -OUTPUTCHARSET UTF8 -V2 installer.nsi
# → MAKENSIS_EXIT=0，且**只**报 1 个 warning 6010（模板自带的 "Skip" not referenced）
```

判据：makensis 对「定义了但没人调用的函数」会报 `warning 6010: install function "X" not referenced`。这次它**只**报了 `Skip`，**没有**报 `LDCodexOnGuiInit` —— 说明 `.onGUIInit` 里确实生成了 `Call "LDCodexOnGuiInit"`。

另外加了 **T19f** 守卫：直接盯生成出来的 `installer.nsi` 里 `!include hooks.nsh` 是否仍在第一个 `!insertmacro MUI_LANGUAGE` 之前。Tauri 哪天调整模板顺序，这条会直接失败，而不是静默退化成「只靠 PREINSTALL 兜底」。

---

## 三、插件面板怎么修（真的溢出）

用户原话：「**帐号，会话，增强菜单 这些都超出了软件底边框，这个软件和 插件内的 窗口都要重新修复。**」
「帐号 / 会话 / 增强」正是插件面板 `.wbs-tabs` 里的页签（账号 / 主题 / 会话 / 模型 / 增强 / 自动化 / 电脑 / 关于）。

### 根因（两处硬编码 + 一处看不见）

| # | 位置 | 问题 |
|---|---|---|
| 1 | `inject.js` 的 `lockPanelHeight()`：`panel.style.height = '650px'; panel.style.maxHeight = '650px';` | **JS 内联样式，优先级高于样式表** —— 所以「只改 CSS」是没用的。`.wbs-panel` 的 `max-height:650px` 直接绕过了视口约束 |
| 2 | `.wbs-body { height: calc(650px - 170px); max-height: calc(min(78vh,660px) - 118px) }` | 两条互相打架的估值。`78vh` 是**视口高度的比例**，跟「面板真正剩下多少空间」毫无关系 |
| 3 | `.wbs-sess-list` / `.wbs-model-list` 的 `scrollbar-color: transparent transparent` | 滑块**完全透明**（计算值 `rgba(0,0,0,0)`），看不出能滚 → 主观感受就是「看不到了」 |

### 实测复现（修复前，用真实 CSS 量的）

| 窗口高 | 面板位置 | 结果 |
|---|---|---|
| 900 | `131 → 783`（高 652） | 正常 |
| 760 | `-9 → 643` | **顶边 -9，被窗口上沿切掉一截** |
| 620 | `-149 → 503` | **顶边 -149，标题栏 + ✕ 关闭按钮全看不见** |
| 520 | `-249 → 403` | **顶边 -249** |

会话列表 `scrollbar-color = rgba(0, 0, 0, 0)` → 滑块完全透明。

### 改法

| 位置 | 改动 |
|---|---|
| `.wbs-panel` | `max-height: 650px` → **`max-height: calc(100vh - 44px)`**（44 = 上下各留 22px；`.wbs-root` 是 `position:fixed;bottom:22px`，面板底边固定在其上，所以面板最多只能这么高） |
| `.wbs-body` | 删掉 `height: calc(650px - 170px)` 与 `max-height: calc(min(78vh,660px) - 118px)`，改为 **`flex: 1 1 auto; min-height: 0`** —— 高度只由 flex 分配，零估值 |
| `lockPanelHeight()` | `panel.style.maxHeight` 从 `'650px'` 改为 **`'calc(100vh - 44px)'`**，与 CSS 保持一致 |
| 三处列表滚动条 | `transparent` → **`rgba(128,128,128,.42)`**，悬停 `.62` |

### 修复后实测

| 窗口高 | 面板位置 | 结果 |
|---|---|---|
| 900 | `131 → 783`（高 652） | 与修复前一致（窗口够高时不改变观感） |
| 760 | `20 → 643`（高 623） | ✅ 完整落在窗口内 |
| 620 | `20 → 503`（高 483） | ✅ |
| 520 | `20 → 403`（高 383） | ✅ |

---

## 四、验证：这类 bug 必须「量」，不能只「看源码」

### 插件面板布局实测（新增，47 项）

- `_test_daemon/plugin-panel-harness.html` —— 复刻插件真实 DOM（`.wbs-root > .wbs-fab + .wbs-panel > .wbs-head + .wbs-tabs + .wbs-body > .wbs-pane`），**样式表直接从 `inject.js` 的样式数组里抽出来**（`css.textContent = [ … ].join('')`），所以量到的是真实规则而不是手抄的近似值；
- `_test_daemon/verify-plugin-layout.mjs` —— 无头 Chrome 覆盖**用户点名的三个页签** `?pane=account|sessions|enhance` × 四种窗口高度（900 / 760 / 620 / 520），每档断言：
  1. 面板顶边不得被窗口上沿裁掉；
  2. 面板底边不得超出窗口下边框；
  3. 把内层列表滚到底后，最后一项必须落在面板可视区内；
  4. 列表真的能滚时，滚动条滑块不得是透明的（`transparent` 和 `rgba(0,0,0,0)` 都算不可见）；
  5. **自检**：注入修复前的旧规则（`?old=1`），夹具必须判定为「装不进窗口」—— 否则说明夹具失效，「通过」不可信。
- 已接入 `test-run.sh`。

> 踩坑记录：夹具第一版里 `__PLUGIN_CSS__` 这个占位符**在注释里也出现了一次**，`String.replace` 只替换第一处 → CSS 根本没注入，量出来「面板高 1816px」。现在脚本会先数占位符出现次数，不等于 1 就 SKIP 并提示。

### 源码级静态守卫（新增 T18 系列 5 项 + T19 系列 6 项 + T20 系列 5 项）

- **T18**：`.wbs-panel` 的 `max-height` 必须受视口约束；`.wbs-body` 不得再出现 `calc(650px…)` / `calc(min(78vh…))`；JS 内联 `maxHeight` 不得钉成 `'650px'`；三处列表滚动条不得是 `transparent`。
- **T19**：必须注册 `MUI_CUSTOMFUNCTION_GUIINIT`；**不得**用 `nsis_tauri_utils::`；**不得**用 `${StrLoc}` 系列；停进程必须轮询 + 兜底杀 daemon；静默安装不得弹窗；`hooks.nsh` 必须仍早于第一个 `MUI_LANGUAGE` 被 include。
- **T20**：`verify-installed-version.mjs` 必须存在；`test-run.sh` 必须调用它且用 `|| true` 保持信息性；脚本必须**保持只读**（不得出现任何写文件 API）；读注册表必须带 PowerShell 降级；不得用 `toISOString()` 打时间。

> 踩坑记录（同一个坑踩了两次）：断言前**必须先剥注释**。T17 是 CSS 注释里提到了旧写法被误判；T19 是我自己写的注释里**特意**提到了 `nsis_tauri_utils::` 和 `${StrLoc}` 来说明「为什么不能用」，结果被判成违规用法。T19 现在按「整行以 `;` 开头」剥掉再断言。

---

## 五、改动清单

| 文件 | 改动 |
|---|---|
| **`src-tauri/src/lib.rs`** | 新增 `tray_tooltip_default()` / `resolve_tray_tooltip()`；`install_tray` 加 `.tooltip(...)`；`update_tray_labels` 新增 `tooltip: Option<String>` 并 `set_tooltip` |
| `src/App.tsx` | 英文分支多传 `tooltip`（含 `{version}` 占位符） |
| `src-tauri/src/commands.rs` | 新增测试 `tray_icon_exposes_hover_tooltip_with_workspace_version`（6 条断言） |
| `src-tauri/workbuddy-runtime/inject.js` | `.wbs-panel` 高度上限受视口约束；`.wbs-body` 去掉两处估值；`lockPanelHeight()` 内联 `maxHeight` 同步；三处列表滚动条可见 |
| **`src-tauri/windows/hooks.nsh`（重写）** | 新增 `.onGUIInit` 回调抢在「已安装」页面之前关程序；停进程改为轮询等待；避开 `nsis_tauri_utils` / StrFunc 两个编译陷阱 |
| `src-tauri/workbuddy-runtime/daemon.js` | `DAEMON_VERSION` → `88.8.4`；`DAEMON_BUILD_ID` → `release-88.8.4-20260913-tray-tooltip`；新增版本注释说明本次修复 |
| `Cargo.toml` / `package.json` / `package-lock.json`(2处) / `tauri.conf.json` / `workbuddy-runtime/package.json` | 版本号 → `88.8.4` |
| `apps/codex-plus-launcher/build.rs` | 注释里的版本示例同步 |
| **`_test_daemon/plugin-panel-harness.html`（新增）** | 插件面板 DOM 复刻夹具，样式表从 `inject.js` 现抽 |
| **`_test_daemon/verify-plugin-layout.mjs`（新增）** | 三个页签 × 四种窗口高度的布局实测 + 反向自检 |
| **`_test_daemon/verify-installed-version.mjs`（新增）** | 把安装目录 `workbuddy-runtime\` 与源码**逐文件比 sha256**，加读 `daemon.js` 版本与注册表 `DisplayVersion` —— 一条命令回答「用户机器上跑的到底是哪一版」 |
| `_test_daemon/run-tests.js` | 新增 T18（5 项）/ T19（6 项）/ T20（5 项）；T2c / T13i / T14 断言同步到 `88.8.4` |
| `_test_daemon/test-run.sh` | 接入插件面板实测脚本；开头跑一次安装版本核验（信息性，不参与成败判定） |
| `_test_daemon/TEST-REPORT.md` / `overview.md` | 同步版本号、总数、新增章节 |

---

## 六、以后怎么升级版本号（照这个做就行）

**约定**：当前基线 `88.8.4`，以后**每升级一次加 1**（`88.8.5`、`88.8.6` ……）。

必须同步改的 **6 处**（漏一处 `T14` 系列会直接失败并告诉你是哪一处）：

| # | 文件 | 字段 |
|---|---|---|
| 1 | `Cargo.toml` | `[workspace.package] version`（**唯一权威来源**，5 个 Rust crate 经 `version.workspace = true` 继承） |
| 2 | `apps/codex-plus-manager/package.json` | `version` |
| 3 | `apps/codex-plus-manager/package-lock.json` | 顶层 `version` + `packages[""].version`（共 2 处） |
| 4 | `apps/codex-plus-manager/src-tauri/tauri.conf.json` | `version`（决定安装包文件名） |
| 5 | `apps/codex-plus-manager/src-tauri/workbuddy-runtime/package.json` | `version` |
| 6 | `.../workbuddy-runtime/daemon.js` | `DAEMON_VERSION` 与 `DAEMON_BUILD_ID` |

**为什么必须逐处写死**：daemon 的自更新逻辑用正则从**新版 daemon 源码**里抠版本号（`source.match(/const DAEMON_VERSION = '([^']+)'/)`），所以它必须是源码字面量；Tauri 打包读 `tauri.conf.json`、npm 读 `package.json`，读取时机与生态都不同。靠**源码级断言**（`run-tests.js` 的 T14 系列 6 项）保证一致，而不是靠人肉记得。

另外记得同步：`run-tests.js` 的 `UNIFIED_VERSION` / T2c / T13i、`TEST-REPORT.md` 标题与版本行、`overview.md`。

> ✅ **托盘 tooltip 不是第 7 处。** 它的版本号取自 `env!("CARGO_PKG_VERSION")`（继承第 1 处），
> 所以升级时不用管它 —— 这正是当初刻意这么写的原因（避免又多一处「漏改就静默不一致」的来源）。
> `commands.rs` 里那条测试专门断言 tooltip 相关代码段**不得出现硬编码版本号**。

---

## 七、安装

**产物**：`target/release/bundle/nsis/LDCodex_88.8.5_x64-setup.exe`

| 项 | 值 |
|---|---|
| 大小 | 53,260,017 字节 |
| 出包时间 | 2026-09-14 10:31:04（`npm run build` 完整构建，10m15s，`BUILD_EXIT=0`；重编原因见下） |
| SHA-256 | `039B141E52A2D16EE4C95069E064943D8BF5756E3A2C56CE9551D5F1CF69E723` |

> 这一版是**从源码一路 `npm run build` 出来的**，不是手工 `makensis` 重编的 ——
> 两个自杀修复（⑧ 安装器杀自己、⑨ 卸载器杀安装器）都已编进包里。
> 装完实测：`/S /UPDATE` **139 秒、ExitCode 0**、`DisplayVersion = 88.8.5`、
> 安装目录与源码**逐文件一致 38/38**、核验 **7/7 ✅**。

> ⚠️ 88.8.5 一共出过三版包，只有**最后这版**有效：
> - 01:09（53,264,846 字节）—— **改语义之前**构建的，生效点还是「明天 00:00」，已作废；
> - 02:18（53,256,179 字节，`7EA83B35…`）—— 「上次切换 +24h」版，但**漏编了一处清理**；
> - **10:31（53,260,017 字节，`039B141E…`）—— 现行版**。
>
> 重编原因：02:18 出包**之后**，源码里又落盘了一处「关于」页重整的收尾清理 ——
> 删掉 `#wbs-monitor-log-card` 的查询（那张卡已按用户要求删除）与只写不读的
> `hiddenToolsUnlocked`。这处清理**行为中性**（纯死代码），但会让「安装目录与源码
> 逐字节一致」这条核验变成假绿，所以重编重装让两者重新一致。
>
> 已用拆包核对（`7z.exe x`）确认现行包的内容与源码完全一致：
> 包内 `workbuddy-runtime\` **56 个文件与源码 `diff -r` 无差异**；
> 包内 `inject.js` 与源码 sha256 相同（`51089f8f…`）；
> 包内 `LDCodexManager.exe` 与**已安装的**逐字节相同（`977fc585…`，46,025,728 字节）。

> ⚠️ 上面这个哈希**只用来对账**（确认你手上和我这里是同一个文件），**不能**用来判断「包是不是新构建的」——
> 重新编一次大小/哈希就会变（原因见第七节 ⑦）。判断新旧请看那一节的三层判据。

本次出包已核验（三层判据全过）：

| 判据 | 实测 |
|---|---|
| PE 版本资源 | 安装包 `FileVersion = 88.8.4` / `ProductVersion = 88.8.4` |
| 生成的 `installer.nsi` | `L34: !define VERSION "88.8.4"`、`L35: VERSIONWITHBUILD "88.8.4.0"` |
| 源码 mtime < 产物 mtime | `lib.rs` 21:03:19、`App.tsx` 21:03:25、`daemon.js` 21:04:06、`Cargo.toml` 21:04:13，均 < `installer.nsi` 21:32:44 < 产物 21:34:09 |
| tooltip 文案真在 exe 里 | `LDCodexManager.exe` 内可搜到 `LDCodex 管理工具 v`、`左键显示窗口，右键打开菜单`、`{version}` |

装好后：
- **鼠标移到右下角托盘图标上，会显示「LDCodex 管理工具 v88.8.4 · 左键显示窗口，右键打开菜单」**；
- 插件面板在**任意窗口高度**下都完整落在 WorkBuddy 客户端窗口内，标题栏和 ✕ 一直看得见；账号 / 会话 / 模型三个列表的滚动条清晰可见；
- 管理器「关于」页与客户端面板显示 **88.8.4**。

### ⚠️ 从 88.8.1 升级时，那一页**务必改选第二个选项**（最常见的卡死点）

运行 `LDCodex_88.8.4_x64-setup.exe` 后会出现「已安装」页，文案是
「系统中已存在版本为 **旧的** 的 LDCodex。推荐先卸载当前版本后再进行安装……」，下面**两个单选**：

| 位置 | 文案 | 默认 | 后果 |
|---|---|---|---|
| 第 1 个 | **「安装前卸载」** | ✅ **默认勾选** | 会去调 **88.8.1 那个旧卸载器** → 失败 → 弹「**无法卸载！**」→ 退回这一页，死循环 |
| 第 2 个 | **「请勿卸载」** | ⬜ | → `Goto reinst_done`，**根本不调卸载器**，直接把新文件覆盖进 `C:\Program Files\LDCodex` |

**做法：点第二个「请勿卸载」，再点「下一步」。**

> 为什么第 1 个必然失败：那一支会 `ExecWait '"C:\Program Files\LDCodex\uninstall.exe" _?=…'`，
> 而 `C:\Program Files\LDCodex\uninstall.exe` 是 **88.8.1 留下的旧卸载器**（85,258 字节，
> `FileVersion = 88.8.1`），它里面 `Section Uninstall` 开头就是
> `CheckIfAppIsRunning "LDCodexManager.exe"` —— 只要进程还在就中止。
> 我们 88.8.3 才在卸载器里加了 `NSIS_HOOK_PREUNINSTALL`（先杀进程），
> **旧卸载器没有这段**，所以救不了它。第 2 个选项走的是新安装器自带的
> `NSIS_HOOK_PREINSTALL`（`hooks.nsh` 里 `LDCodexStopRunningProcesses`，最多 12 轮 × 500ms 反复清进程再等 800ms），
> 所以能成功。
>
> **这也是「明明能单独卸载、但从安装程序里卸载就失败」的原因**：单独卸载时进程已经被你手动关了，
> 而从安装程序里走时没人关。
>
> 装上 88.8.4 之后，以后再升级就不会再遇到这个问题了（新版卸载器自带同样的关闭逻辑）。

**如果那一页怎么都过不去**，还有一条更彻底的路：把残留的注册表卸载项删掉，
安装程序就认为「没装过」，直接走全新安装，连这一页都不会出现 —— 用**管理员** PowerShell 一行：

```powershell
Remove-Item "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\LDCodex" -Recurse -Force
```

（只删注册表项，**不动** `C:\Program Files\LDCodex` 里的文件；安装程序会覆盖它们。
这是本机实测过的：有无这一项决定了安装程序是否弹「已安装」页。）

### 遇到「已安装 / 推荐先卸载 / 无法卸载！」时的完整排查手册

这套排查是**在真实机器上跑通并验证过**的（2026-09-13 实测），照做即可。

#### ① 先确认「到底装没装、装的哪一版」—— 别猜

```bash
# 安装目录：文件在不在、mtime 是不是旧版
ls -la "C:/Program Files/LDCodex/"
```
```powershell
# 注册表：安装器就是靠这个判断「已安装」的
Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\LDCodex" |
  Select DisplayName, DisplayVersion, UninstallString, InstallLocation
```

判据：安装器读的是 **`DisplayVersion`**。它还是旧版本号 → 安装器当然显示「已安装」。

#### ② 确认有没有进程占着文件 —— 注意两个坑

```bash
tasklist | grep -i -E "LDCodex|ldcodex"
```

⚠️ **坑 1：`LDCodexManager.exe` 是托盘程序** —— 点窗口的 ✕ 只是收起，**进程还在跑**。
排查时必须在**托盘图标右键 → 退出**，或确认 `tasklist` 里真的没有它。

⚠️ **坑 2：别把别人的 `node.exe` 当成 LDCodex daemon。** 机器上常有 WorkBuddy 自己的
MCP 进程（sheetagent / weixinpay 等）。要读 `CommandLine` 才能确认归属：

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Select ProcessId, CommandLine | Format-List
```

#### ③ 「推荐先卸载」只是**推荐**，不是**必须**

那句文案出自 `target/release/nsis/x64/SimpChinese.nsh:15` 的 `olderOrUnknownVersionInstalled`：

> 「系统中已存在版本为 **$R4** 的 LDCodex。**推荐**先卸载当前版本后再进行安装。选择你想要执行的操作后点击下一步以继续。」

对应 `installer.nsi:234-238` 的 **Upgrading** 分支，两个单选是
`uninstallBeforeInstalling`（「安装前卸载」）/ `dontUninstall`（「**请勿卸载**」）。
**直接选「请勿卸载」即可** —— 它走 `reinst_done`，根本不调用旧卸载器。

#### ④ 「安装前卸载」为什么经常失败（根因）

`installer.nsi:339-353` 的 `reinst_uninstall` 执行的是**旧版**
`$INSTDIR\uninstall.exe`（并追加 `_?=$INSTDIR`）。旧卸载器的 `Section Uninstall` 开头有：

```nsis
!insertmacro NSIS_HOOK_PREUNINSTALL                      ; 旧版钩子：taskkill 杀进程
!insertmacro CheckIfAppIsRunning "LDCodexManager.exe"    ; 模板 utils.nsh
```

`CheckIfAppIsRunning` 命中运行中进程就弹 `MB_OKCANCEL`：

- 点**取消** → `Abort $R1`
- 杀进程失败 → `Abort $R3`

⚠️ **`Abort` = 整个卸载段立即退出：文件不删、注册表键也不删**
（`DeleteRegKey HKLM "${UNINSTKEY}"` 在 `installer.nsi:936`，根本执行不到）。
于是你看到的状态就是「**文件和注册表键都还在、版本仍是旧的**」，
而 `Abort` 让卸载器返回非 0 退出码 → 安装器 `installer.nsi:373` 弹 **「无法卸载！」**。

**为什么「单独运行 uninstall.exe」反而能成**：单独跑时那个「程序正在运行」的弹窗是**可见**的，
你能点「确定」；从安装器里调用时，安装器先执行了 `HideWindow`（`installer.nsi:340`）把自己藏起来，
弹窗容易被盖住或没注意到 → 超时或误点取消 → 整段 `Abort`。

#### ⑤ 选「请勿卸载」之后会发生什么

| 步骤 | 代码位置 | 效果 |
|---|---|---|
| 跳过旧卸载器 | `installer.nsi:328-330` → `reinst_done` | 不调用 `uninstall.exe`，不触发上面的 `Abort` |
| 先关程序 | 88.8.3 的 `NSIS_HOOK_PREINSTALL` + `.onGUIInit` | 杀掉 `LDCodexManager.exe` / `ldcodex.exe` / 按命令行匹配的 daemon |
| 覆盖旧文件 | NSIS 默认 `SetOverwrite on` | 旧文件被新版覆盖 |
| **重写卸载器** | `installer.nsi:714 WriteUninstaller` | `uninstall.exe` 换成**带新钩子的 88.8.3 版** |
| **更新版本号** | `installer.nsi:738` | 注册表 `DisplayVersion` → `88.8.3` |

→ 因此**装完 88.8.3 之后，以后再升级就不会再看到这个页面了**。

#### ⑥ 想先干净卸载（可选）

1. **托盘图标右键 → 退出 LDCodex**（必须真退出，不能只关窗口）；
2. 运行 `C:\Program Files\LDCodex\uninstall.exe`；
3. 若中途弹「程序正在运行」，点**确定**。

> 提示：如果安装目录里有 88.8.1 遗留的、88.8.3 已不再包含的文件，
> 选「请勿卸载」时会留在原地（覆盖安装不会清理孤儿文件）。
> 想要完全干净的目录，就走上面的「先卸载再装」。

#### ⑦ 怎么确认「你手上的安装包」确实是新构建的（**别用哈希**）

**先说结论：文件哈希比对不能用来判断安装包新旧。** 这一条是被误导过之后实测出来的。

- **makensis 是确定性的** —— 同一份 `installer.nsi` 连续编译两次，产物 sha256 **完全相同**；
  换 Tauri 用的 `-V3` 再编一次，也和 `-V2` 的产物**一模一样**
  （`tauri-bundler-2.9.4/src/bundle/windows/nsis/mod.rs:695-700` 按日志级别选 `-V1`..`-V4`，
  只影响控制台输出，**不影响产物字节**）。
- **但重新编译的产物仍会和出包产物不同**（88.8.3 实测差 669 字节），原因**不是**「时间戳」，
  也**不是**「cargo 又重链接了一次」—— 那两个说法我都写过，**都是错的**。真正原因是
  **Tauri 打包完会把 exe 还原成「未打标」状态**（见下）。

##### 为什么 `target/release/LDCodexManager.exe` 总是比安装包「新」

`tauri-bundler-2.9.4/src/bundle.rs` 的打包主循环（`:128`、`:148`、`:197-203`）是这样的：

```rust
// :128  “We make a copy of the unsigned main_binary so that we can restore it after each package_type step.”
let mut main_binary_copy = tempfile::tempfile()?;
let mut main_binary_orignal = std::fs::File::open(&main_binary_path)?;
std::io::copy(&mut main_binary_orignal, &mut main_binary_copy)?;      // ① 备份原文件

for package_type in &package_types {
    patch_binary(&main_binary_path, package_type)?;                  // ② 打标：UNK → NSS(NSIS)
    … 构建安装包（makensis 此时读的是【已打标】的 exe）…
    // :197  “Restore unsigned and unpatched binary”
    let mut modified_main_binary = std::fs::OpenOptions::new()
        .write(true).truncate(true).open(&main_binary_path)?;
    main_binary_copy.seek(SeekFrom::Start(0))?;
    std::io::copy(&mut main_binary_copy, &mut modified_main_binary)?; // ③ 把原文件覆盖回去
}
```

即：**cargo 编出的是 `UNK`（未打标）版 → Tauri 打标成 `NSS`（NSIS）→ makensis 打进去的是 `NSS` 版
→ 打完 Tauri 又把 `UNK` 版覆盖回磁盘**。所以磁盘上那份 exe 的 mtime 必然**晚于**安装包
（88.8.4 实测 exe `21:34:11` vs 包 `21:34:09`），而**包里的才是正确打标的那份**。

**这两份 exe 差多少？实测只差 3 个字节**，就是那个标记本身：

| | 偏移 `0x17b69a2` 处的字节 | 含义 |
|---|---|---|
| 安装包内嵌的 | `__TAURI_BUNDLE_TYPE_VAR_`**`NSS`** | NSIS（正确） |
| 磁盘 `target/release/` 里的 | `__TAURI_BUNDLE_TYPE_VAR_`**`UNK`** | 未知（被还原） |

> 两个文件的 `TimeDateStamp`、`CheckSum`、大小（46,021,632 字节）**完全一致** ——
> 所以「PE 时间戳变了导致产物不同」这个说法可以彻底排除。
> 那 3 个字节经 LZMA 整体重压后，就让整个安装包差了 669 字节。

**结论：exe 比安装包新 ≠ 包是旧的。** 这是 Tauri 的正常行为，不是构建问题。

##### 判据 4（最硬）：直接把安装包拆开看

前面的判据只能证明「打进去的是当前源码」。要**直接证明包里的 exe 是什么样**，就把包拆开：

```bash
# 7-Zip 完整版的 7z.exe 支持 Nsis 格式（7za 独立版【不支持】）
7z.exe l target/release/bundle/nsis/LDCodex_88.8.4_x64-setup.exe   # 列内容
7z.exe x  <安装包> -o<目录> -y "LDCodexManager.exe"                 # 抽出管理器
```

88.8.4 实测结果：包内 exe 里能搜到 `LDCodex 管理工具 v`、`左键显示窗口，右键打开菜单`、
`{version}`、`88.8.4`，且**搜不到** `88.8.1` —— 即托盘 tooltip 确实在包里。

**可靠的三层判据**：

| # | 判据 | 命令 / 位置 |
|---|---|---|
| 1 | **PE 版本资源**（明文，LZMA 压不到） | `(Get-Item $exe).VersionInfo` → `FileVersion` / `ProductVersion` |
| 2 | **安装器脚本引用源码绝对路径**，makensis 编译期同步读盘、无缓存 | `target/release/nsis/x64/installer.nsi` 里 `File /a "/oname=…" "D:\LUODA\LDcodex\…"`；再加 `:34 !define VERSION "88.8.4"` |
| 3 | **直接量构建产物内容** | 管理器：`apps/codex-plus-manager/dist/assets/index-*.css`；插件：`_test_daemon/verify-plugin-layout.mjs`（从 `inject.js` 现抽） |
| 4 | **拆包看内嵌文件**（最硬） | `7z.exe x <安装包> -y "LDCodexManager.exe"` 后搜字面量 / 读 PE 版本资源 |

用判据 2 时，只要「源码 mtime < 产物 mtime」就说明打进去的是当前源码。

> ⚠️ 别用 `grep -c "height:100vh"` 这种粗判据 —— 根容器 `body` / `.shell` 本来就该有，
> 必须定位到**具体选择器**（`.workspace` 不该有）。
>
> ⚠️ 界面那页的版本号是「**旧的**」，不是数字：`installer.nsi:217 StrCpy $R4 "$(older)"`，
> `SimpChinese.nsh:14 LangString older "旧的"`，所以原文是「系统中已存在版本为 **旧的** 的 LDCodex」。
> **界面上不会出现「88.8.1」这种数字**，别把注册表里读到的版本号当成界面文案。

**装完怎么核验？一条命令**（只读，不改任何文件）：

```bash
node _test_daemon/verify-installed-version.mjs            # 诊断模式，永远 exit 0
node _test_daemon/verify-installed-version.mjs --strict   # 不匹配则 exit 1
```

它把**安装目录 `workbuddy-runtime\` 下的文件与源码里的同名文件逐个比 sha256**，
再读安装目录 `daemon.js` 的 `DAEMON_VERSION` / `DAEMON_BUILD_ID` 与注册表 `DisplayVersion`，
最后检查安装的 `inject.js` 是否含 88.8.3 的面板高度修复标记。**源码是唯一权威** ——
哈希全等就说明运行时确实吃到了当前源码。

`_test_daemon/test-run.sh` 也会在开头跑一次它（信息性，**不参与**成败判定），
这样每次跑测试都会顺手报一次本机装的是哪版 —— 历史上两次「改了没用」的真实原因都是「根本没装上」。

> ⚠️ 本机 `reg.exe` 在沙箱程序黑名单里（Node 侧报 `spawnSync reg EPERM`），
> 脚本会自动降级到 PowerShell `Get-ItemProperty`（实测可行）；两条路都被拦时记 **SKIP 而不是 FAIL**，
> 避免把「读不到」误报成「版本不对」。运行时终端多出一行沙箱拦截提示属正常。

#### ⑧ 88.8.3 / 88.8.4 装不上的真凶：**安装器把自己杀了**

用户：「我都退出了，还是安装不了。不是我的问题，你代码安装的问题」—— **他是对的。**

**症状**（这条最难的地方是**没有任何报错**）：

```
LDCodex_88.8.4_x64-setup.exe /S /UPDATE   → 4.3 秒后退出，ExitCode = -1
LDCodex_88.8.4_x64-setup.exe /P /UPDATE   → 5.2 秒后退出，ExitCode = -1
  · 不弹任何错误窗口
  · 一个文件都没写（C:\Program Files\LDCodex 全部保持旧时间戳）
  · 注册表不动；TEMP 里的 $PLUGINSDIR（ns*.tmp）没被清理
  · 事件日志无崩溃记录
非静默（双击）→ 窗口正常弹出、停在欢迎页 → 看起来「完全正常」
```

**根因**：`src-tauri/windows/hooks.nsh` 的 `LDCodexKillOnce` 里那条 PowerShell 兜底 ——

```powershell
Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*workbuddy-runtime*')
  -or ($_.ExecutablePath -like '*LDCodex*')      # ← 匹配到安装程序自己！
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

安装程序本身叫 `LDCodex_88.8.4_x64-setup.exe`、放在 `D:\LUODA\LDcodex\…` 下，
路径**必然**含 `LDCodex`（`-like` 不区分大小写）→ **把自己 `Stop-Process -Force` 了**。
它挂在 `NSIS_HOOK_PREINSTALL`，在 `Section Install` 的 `SetOutPath` 之后、
`CheckIfAppIsRunning` 之前执行 —— 自杀发生在写任何文件之前，所以什么都不留。

**为什么双击时看不出来**：非静默会停在欢迎页等用户点「下一步」，根本没执行到 `Section Install`。
**「双击能打开窗口」完全不能说明安装器是好的。**

**影响范围**：`hooks.nsh` 是 **88.8.3 才引入** → 88.8.1 能装，88.8.3 / 88.8.4 第一版全装不上。

**修法** —— 过滤条件排除自己（`$EXEPATH` 是 NSIS 变量，= 安装程序完整路径）：

```
-or ($$_.ExecutablePath -like $\'*LDCodex*$\' -and $$_.ExecutablePath -ne $\'$EXEPATH$\')
```

守护进程那条 `-like '*workbuddy-runtime*'` 不受影响（安装程序命令行不带它）。

**修复后实测**：隔离测试退出码 **0**（修复前 -1）；重编安装包后 `/P /UPDATE`
**19.4 秒装完、ExitCode 0**，`DisplayVersion = 88.8.4`，核验脚本 **7/7 ✅**。

##### 定位手法（可复用）

| 步骤 | 做什么 |
|---|---|
| 1 | 排掉常见嫌疑：进程占用 / `$INSTDIR` / WebView2 / 插件 / 提权 / `cmd·tasklist·find·taskkill·powershell` 可用性 —— **全部否掉** |
| 2 | 复制 `installer.nsi` → `installer-log.nsi`，在各段插 `FileOpen/FileWrite` 打点、改 `OutFile`，`makensis` 重编（约 2 分钟） |
| 3 | 打点显示最后到达 `[Install-SetOutPath-done]`，`[CheckIfAppIsRunning-done]` 从不出现 → 死在两者之间的 `NSIS_HOOK_PREINSTALL` |
| 4 | 写 30 行 `hook-test.nsi` 只 `!include` 真实 hooks.nsh 跑那两个宏 → **ExitCode -1，走不到最后一步**，实锤 |
| 5 | 另编 `fp-test.nsi` 调 `nsis_tauri_utils::FindProcess`，实测 **`1`=没找到、`0`=找到**（和直觉相反） |

> ⚠️ 三个坑：`LogSet` 用不了（需 NSIS 编译时开 `NSIS_CONFIG_LOG`）；
> `FileOpen … "a"` 在这台 NSIS 上**不截断**，后写的会覆盖前面留下残尾，
> 要按「最后出现在文件**开头**的是哪个打点」判断进度；
> 调非默认目录的插件要先 `!addplugindir`，否则编译期就报 “Plugin not found”。

**回归守卫**：`_test_daemon/run-tests.js` 新增 **T21a/b/c** 三条，盯住那条 PowerShell
必须含 `*LDCodex*` + `$EXEPATH` + `-ne`，且排除条件必须**紧贴** `*LDCodex*`
（用 `includes` 校验确切形态 —— 这行 `$ \ ' *` 全是要转义的元字符，**别用正则**）。

> **教训**：**「杀进程」脚本必须显式排除自己** —— 只要用路径子串匹配，
> 安装程序几乎必然落在自己的匹配里。以后做安装包体检，第一件事就是跑
> `installer.exe /S /UPDATE`：**几秒出结果、还不用点按钮**；
> 而非静默会停在欢迎页，掩盖后续一切故障。

#### ⑨ 修完自杀后 `/P` 仍然失败：**卸载器把「正在等它的安装器」杀了**

修好 ⑧ 之后 `/S /UPDATE` 正常了（15~18 秒、ExitCode 0），但换 `/P`（＝模拟用户一路下一步）
**又是 6.8 秒 ExitCode -1**，而且**旧版本已经被删掉了**（主程序没了、注册表键也没了）——
比 ⑧ 更糟，现场被破坏过。

根因是**两层**叠加：

**第一层（Tauri 官方模板的缺陷）**：`PageReinstall` 在 `$PassiveMode = 1` 时**不创建单选按钮**，
直接 `Call PageLeaveReinstall`；而 `PageLeaveReinstall` 第一句是 `${NSD_GetState} $R2 $R1` ——
`$R2` 此时还是上一句赋的**文案字符串**（`添加/重新安装组件`），不是窗口句柄 → 返回 `0`
→ 同版本分支 `$R0 = 0 / $R1 = 0` → 走 `${Else}` = **`Goto reinst_uninstall`**（卸载）。
也就是说：**被动模式下默认就是「先卸载」，跟交互模式下默认选中第一项的行为相反。**

**第二层（我们的 bug）**：`reinst_uninstall` 是 `ExecWait '$R1' $0` —— 安装器**同步等**卸载器跑完。
卸载器一启动就执行 `NSIS_HOOK_PREUNINSTALL` → `LDCodexKillOnce`。而 ⑧ 那版修法用的是
`$_.ExecutablePath -ne '$EXEPATH'` —— **`$EXEPATH` 只等于「当前这个 exe 自己」**：
在卸载器里它 = `C:\Program Files\LDCodex\uninstall.exe`，**保护不到父进程安装器**。
于是卸载器把还活着的 `LDCodex_*_x64-setup.exe` 一起 `Stop-Process -Force` 了。

打点日志（最后一条是 `before-ExecWait`，`after-ExecWait` 再也没写出来）实锤了这一点：

```
[PageLeaveReinstall-begin] R0=0 R1=0 R2=添加/重新安装组件 被动=1 更新= Wix=
[reinst_uninstall] 决定走「先卸载」
[before-ExecWait] 即将执行卸载命令: "C:\Program Files\LDCodex\uninstall.exe" /P _?=C:\Program Files\LDCodex
   ← 到此为止，进程没了
```

**修法 —— 改成按「进程名」排除**（PowerShell 的 `-notlike` 不区分大小写）：

```
-or ($$_.ExecutablePath -like $\'*LDCodex*$\'
     -and $$_.Name -notlike $\'*setup*.exe$\'      ; 安装器（自己是它，父进程也是它）
     -and $$_.Name -notlike $\'*uninstall*.exe$\'  ; 卸载器自己（它的路径同样含 LDCodex）
     -and $$_.ExecutablePath -ne $\'$EXEPATH$\')   ; 双保险：万一安装包被改名
```

设计取向：**漏杀只是「文件被占用」这种看得见的报错；误杀是「静默退出 -1」** —— 所以宁可漏杀，
用 `-notlike` 排除，而不是把 `*LDCodex*` 收得更紧。

> ⚠️ **改完必须先用新版装一次，把安装目录里的 `uninstall.exe` 也换成新版**，否则
> 安装器调用的仍是**上一次装进去的旧卸载器**（旧版只排除自己、不排除父安装器），照样被杀。
> 这正是「23:07 重编了包、`/P` 却还是 -1」的原因 —— 包是新的，`C:\Program Files\LDCodex\uninstall.exe` 还是旧的。

**修复后实测**（打点版，OutFile 刻意用正式命名 `LDCodex_88.8.4_x64-setup-log.exe`）：

```
/P  → 22.5 秒装完，ExitCode = 0
      日志走完 PageLeaveReinstall → reinst_uninstall → ExecWait 卸载 → PREINSTALL 钩子
      → [post-PREINSTALL] 没被自己杀掉 → [MainBinary-written]
      最后核验 7/7 ✅，DisplayVersion = 88.8.4
```

**回归守卫**：T21 扩成 **T21a/b/c/d** 四条 —— 必须同时含 `*setup*.exe` 与 `*uninstall*.exe`
两个 `-notlike`（只排一个不够：卸载器里的 `$EXEPATH` 保护不到父安装器）。

> ⚠️ **给用户的一条实用建议**：**安装包的存放路径最好不要含 `LDCodex`。**
> 旧版卸载器（用户机器上可能还有 88.8.1 的）是按 `ExecutablePath -like '*LDCodex*'` 杀进程的，
> 只要安装包放在 `D:\LUODA\LDcodex\…` 这类路径下，它就一定在命中列表里。
> 新版卸载器已经按进程名排除了安装器，但**旧版我们改不到** ——
> 所以从很旧的版本升级时，把安装包拷到桌面或 `D:\发布\` 再双击，是最省事的解法。

---

## 附录、88.8.4 这个包里还包含什么（此前已开发但你没装到的）

因为上一个**装到机器上**的版本是 `88.8.1`（88.8.2 / 88.8.3 都没装上），所以这个包
**一次性包含 88.8.2 + 88.8.3 + 88.8.4 的全部内容**：

- **托盘图标悬停提示（88.8.4）**：鼠标移到右下角托盘图标上显示「LDCodex 管理工具 v88.8.4 · 左键显示窗口，右键打开菜单」。见上文第零节。
- **列表不再掉出窗口下边框（88.8.2）**：修掉 `.workspace { height: 100vh }`（它位于 `.shell` 网格第 2 行，该行已是「100vh − 38px」，多出的 38px 被 `overflow:hidden` 裁掉）与 `.workbuddy-pane` 上拍脑袋的 `max-height: calc(100vh - 330px)`；滚动条滑块从 `--hairline + 0.16`（≈背景色、看不见）换成 `--muted-foreground + 0.42`。
- **插件面板不再顶出窗口（88.8.3）**：见上文第三节。
- **安装器不再卡在「无法卸载」（88.8.3）**：见上文第二节。
- **账号使用次数统计**（管理器 + 插件两侧）：账号列表每个账号显示「用过 N 次」徽标 + 「今日切换 N 次 · 最后使用 MM-DD HH:mm」；客户端插件面板账号卡片显示「用过 N 次 · 今日 M 次」徽标。只统计「切换」（按 `lastActiveUid` 去重，同一账号连续活跃不重复计数、重启不虚增、A→B→A 每次回切都算），只保留当天计数，不随账号导出迁移。
- **版本号统一**：此前同一个安装包里躺着三个互不相干的版本号（安装包 `1.2.56`、运行时 `1.2.11`、daemon `1.2.12`），现已全部统一。
- **CDP 双开隔离**：国内版与国际版同时打开互不串台（回退端口按 profile 分段）。
- **弹窗自动点允许**：修掉扣费防护取样范围过宽导致的长期不生效（首页「邀请好友得 100 积分」横幅会让所有确认弹窗被误判为扣费弹窗）。
- **上弹面板行内新增常用语**：底部第 1 行「添加」→ 列表顶部插入空白行 → `Ctrl+Enter` 保存；自定义常用语随账号备份一起导出，导入时按文案查重只追加缺的。面板右侧原「编辑 →」已按你的要求改为「进入插件设置」。
- **任务栏幽灵图标**：用增强功能后任务栏不再多出一个国内版/国际版图标；任务栏身份改写默认关闭（避免与已固定的快捷方式产生两个按钮）。
