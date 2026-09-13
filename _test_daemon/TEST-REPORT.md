# LDCodex daemon 1.2.9 功能测试报告

- **测试时间**：2026-09-13 12:30 – 13:05
- **被测代码**：
  - `apps/codex-plus-manager/src-tauri/workbuddy-runtime/daemon.js`（DAEMON_VERSION **1.2.9**）
  - `apps/codex-plus-manager/src-tauri/workbuddy-runtime/automation.js`（抗崩溃加固）
  - `apps/codex-plus-manager/src-tauri/src/workbuddy.rs`（「重启并启用」真正结束旧客户端）
- **测试方式**：隔离实例（独立数据目录 `data4` + 独立端口 47999 + CDP 指向空端口 47998），**不影响正在运行的真实客户端**

## 一、总体结果

| 测试集 | 结果 |
|---|---|
| 功能接口测试（`run-tests.js`） | **35 / 35 全部通过** ✅ |
| CDP 端口隔离逻辑（`verify-cdp-isolation.js`） | **18 / 18 全部通过** ✅ |
| 前端类型检查（`tsc --noEmit`） | 通过 ✅ |

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
# 前端类型检查
cd D:/LUODA/LDcodex/apps/codex-plus-manager && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```

## 七、遗留事项

- 用户级环境变量 `WORKBUDDY_REMOTE_DEBUGGING_PORT` 仍是全局单值。它是「手动双击启动也能用 CDP」的兜底，但双开时必然冲突。当前策略：保留它，靠管理器的「以正确端口重启客户端」纠正。
- 安装包需重新构建才能带上 `windows/hooks.nsh`（安装时自动结束占用进程）与以上全部修复。
