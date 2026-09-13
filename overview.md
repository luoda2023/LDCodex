# LDCodex 88.8.3：插件面板不再顶出窗口 + 安装器不再卡在「无法卸载」

> 本轮改动：`workbuddy-runtime/inject.js`（插件面板布局 6 处）｜ `src-tauri/windows/hooks.nsh`（安装器钩子重写）｜ 版本号 6 处来源统一升到 `88.8.3` ｜ `_test_daemon/*`（新增 T18/T19 + 插件面板布局实测脚本与夹具）
> 测试：**118/118 + 16/16 + 布局实测 14/14 + 插件面板实测 47/47 + 前端 159/159 + Rust 2/2 + tsc 全绿**

## 一句话结论

两件事，一件是「修得对但你没装上」，一件是「真的没修」。

1. **你没装到 88.8.2** —— 安装目录里躺的还是 **88.8.1**（`C:\Program Files\LDCodex\workbuddy-runtime\daemon.js` 写着 `DAEMON_VERSION = '88.8.1'`，目录时间 17:15，而 88.8.2 的包是 17:48 出的）。原因是「已安装」页选「安装前卸载」时，安装器去调**旧版**卸载器，而旧卸载器删不掉**正在运行**的 `LDCodexManager.exe`（当时 PID 5008），删完文件还在原地 → 命中 `FileExists "$INSTDIR\LDCodexManager.exe"` → 弹「无法卸载！」并 `Abort`，升级中断。**所以你看到的「帐号 / 会话 / 增强超出底边框」全是 88.8.1 的表现。**
2. **插件面板确实有独立的溢出问题，上一轮没修** —— 用户点名的「帐号 / 会话 / 增强」正是插件面板（注入到 WorkBuddy 客户端里的那套 UI）的页签。它被 `inject.js` 里**两处硬编码 / 估值**撑爆，且其中一处是 **JS 内联样式**，改 CSS 根本没用。

两件事本轮都修了。

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

### 源码级静态守卫（新增 T18 系列 5 项 + T19 系列 6 项）

- **T18**：`.wbs-panel` 的 `max-height` 必须受视口约束；`.wbs-body` 不得再出现 `calc(650px…)` / `calc(min(78vh…))`；JS 内联 `maxHeight` 不得钉成 `'650px'`；三处列表滚动条不得是 `transparent`。
- **T19**：必须注册 `MUI_CUSTOMFUNCTION_GUIINIT`；**不得**用 `nsis_tauri_utils::`；**不得**用 `${StrLoc}` 系列；停进程必须轮询 + 兜底杀 daemon；静默安装不得弹窗；`hooks.nsh` 必须仍早于第一个 `MUI_LANGUAGE` 被 include。

> 踩坑记录（同一个坑踩了两次）：断言前**必须先剥注释**。T17 是 CSS 注释里提到了旧写法被误判；T19 是我自己写的注释里**特意**提到了 `nsis_tauri_utils::` 和 `${StrLoc}` 来说明「为什么不能用」，结果被判成违规用法。T19 现在按「整行以 `;` 开头」剥掉再断言。

---

## 五、改动清单

| 文件 | 改动 |
|---|---|
| `src-tauri/workbuddy-runtime/inject.js` | `.wbs-panel` 高度上限受视口约束；`.wbs-body` 去掉两处估值；`lockPanelHeight()` 内联 `maxHeight` 同步；三处列表滚动条可见 |
| **`src-tauri/windows/hooks.nsh`（重写）** | 新增 `.onGUIInit` 回调抢在「已安装」页面之前关程序；停进程改为轮询等待；避开 `nsis_tauri_utils` / StrFunc 两个编译陷阱 |
| `src-tauri/workbuddy-runtime/daemon.js` | `DAEMON_VERSION` → `88.8.3`；`DAEMON_BUILD_ID` → `release-88.8.3-20260913-plugin-panel-and-installer`；新增版本注释说明本次修复 |
| `Cargo.toml` / `package.json` / `package-lock.json`(2处) / `tauri.conf.json` / `workbuddy-runtime/package.json` | 版本号 → `88.8.3` |
| `apps/codex-plus-launcher/build.rs` | 注释里的版本示例同步 |
| **`_test_daemon/plugin-panel-harness.html`（新增）** | 插件面板 DOM 复刻夹具，样式表从 `inject.js` 现抽 |
| **`_test_daemon/verify-plugin-layout.mjs`（新增）** | 三个页签 × 四种窗口高度的布局实测 + 反向自检 |
| `_test_daemon/run-tests.js` | 新增 T18（5 项）/ T19（6 项）；T2c / T13i / T14 断言同步到 `88.8.3` |
| `_test_daemon/test-run.sh` | 接入插件面板实测脚本 |
| `_test_daemon/TEST-REPORT.md` / `overview.md` | 同步版本号、总数、新增章节 |

---

## 六、以后怎么升级版本号（照这个做就行）

**约定**：当前基线 `88.8.3`，以后**每升级一次加 1**（`88.8.4`、`88.8.5` ……）。

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

---

## 七、安装

**产物**：`target/release/bundle/nsis/LDCodex_88.8.3_x64-setup.exe`

装好后：
- 插件面板在**任意窗口高度**下都完整落在 WorkBuddy 客户端窗口内，标题栏和 ✕ 一直看得见；账号 / 会话 / 模型三个列表的滚动条清晰可见；
- 管理器「关于」页与客户端面板显示 **88.8.3**。

> **本次升级的注意点**：你现在装的是 88.8.1，**它的卸载器还是旧的**，所以这次仍可能撞上「无法卸载！」。新安装器已经能处理，但请按下面的顺序走最稳：
> 1. **推荐**：先让安装程序自己处理 —— 运行安装包后，如果弹出「检测到 LDCodex 正在运行」，点**「确定」**，它会自动关掉程序再继续；或者
> 2. 在「已安装」页面选**「请勿卸载」**（第二个选项），直接覆盖安装 —— 这条路会走新安装器的 `NSIS_HOOK_PREINSTALL`，它会自己关程序再覆盖；或者
> 3. 最保险：先从**右下角托盘图标右键 → 退出**，再运行安装包。
>
> 装上 88.8.3 之后，以后再升级就不会再遇到这个问题了（新版卸载器自带同样的关闭逻辑）。

---

## 附录、88.8.3 这个包里还包含什么（此前已开发但你没装到的）

因为上一个安装包是 `88.8.1`，88.8.2 没装上，所以这个包**一次性包含 88.8.2 + 88.8.3 的全部内容**：

- **列表不再掉出窗口下边框（88.8.2）**：修掉 `.workspace { height: 100vh }`（它位于 `.shell` 网格第 2 行，该行已是「100vh − 38px」，多出的 38px 被 `overflow:hidden` 裁掉）与 `.workbuddy-pane` 上拍脑袋的 `max-height: calc(100vh - 330px)`；滚动条滑块从 `--hairline + 0.16`（≈背景色、看不见）换成 `--muted-foreground + 0.42`。
- **插件面板不再顶出窗口（88.8.3）**：见上文第三节。
- **安装器不再卡在「无法卸载」（88.8.3）**：见上文第二节。
- **账号使用次数统计**（管理器 + 插件两侧）：账号列表每个账号显示「用过 N 次」徽标 + 「今日切换 N 次 · 最后使用 MM-DD HH:mm」；客户端插件面板账号卡片显示「用过 N 次 · 今日 M 次」徽标。只统计「切换」（按 `lastActiveUid` 去重，同一账号连续活跃不重复计数、重启不虚增、A→B→A 每次回切都算），只保留当天计数，不随账号导出迁移。
- **版本号统一**：此前同一个安装包里躺着三个互不相干的版本号（安装包 `1.2.56`、运行时 `1.2.11`、daemon `1.2.12`），现已全部统一。
- **CDP 双开隔离**：国内版与国际版同时打开互不串台（回退端口按 profile 分段）。
- **弹窗自动点允许**：修掉扣费防护取样范围过宽导致的长期不生效（首页「邀请好友得 100 积分」横幅会让所有确认弹窗被误判为扣费弹窗）。
- **上弹面板行内新增常用语**：底部第 1 行「添加」→ 列表顶部插入空白行 → `Ctrl+Enter` 保存；自定义常用语随账号备份一起导出，导入时按文案查重只追加缺的。面板右侧原「编辑 →」已按你的要求改为「进入插件设置」。
- **任务栏幽灵图标**：用增强功能后任务栏不再多出一个国内版/国际版图标；任务栏身份改写默认关闭（避免与已固定的快捷方式产生两个按钮）。
