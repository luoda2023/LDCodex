# Codex-Bridge 工具调用参考文档

## 一、架构概述

CODEX CLI ──(Responses API /v1/responses)──→ codex-bridge 代理 ──(Chat Completions)──→ 上游模型

```
CODEX 发送 tools → 代理转换格式 → 上游模型返回 function_call → 代理转换回 Responses 格式 → CODEX 执行
```

## 二、关键代码位置

### 1. 协议转换入口

**文件**: `lib/protocol/openai-responses.mjs`

| 功能 | 函数/位置 | 说明 |
|------|-----------|------|
| Responses API → Chat | `responsesToChat()` line 578 | 转换请求体 |
| Chat → Responses API | `chatToResponses()` line 985 | 转换响应体 |
| 流式桥接 | `handleResponses()` line 67+ | SSE 事件流转换 |
| 非流式处理 | `handleResponses()` line 49-64 | 完整响应转换 |

### 2. 工具格式转换

**`responsesToChat()` 内的工具处理** (line 742-854):

```
Responses 格式 → Chat 格式（line 746-764）
  ↓
非 function 工具转换（line 785-795）
  computer_use, bash, shell_command 等 → type: "function"
  ↓
工具数量优化（line 819-823）
  CODEX 工具 > 8 个 → 截取前 8 个（不按名字过滤，因为工具名随版本变化）
  ❌ 不要用白名单过滤工具名（bash → shell_command 案例 2026-06-11）
  ↓
  ↓
空数组清理（line 826-828）
  空数组 → undefined（避免上游困惑）
  ↓
tool_choice 清理（line 844-847）
  无工具时删除 tool_choice
```

### 3. 请求发送

**`handleResponses()` 内** (line 38-55):

```javascript
const upstreamUrl = base + "/chat/completions";
const upstreamRes = await nativeRequest(upstreamUrl, {
  method: "POST",
  headers: { Authorization: "Bearer " + key, ... },
  body: JSON.stringify(chatBody),  // ← 含 tools
  timeout,
});
```

### 4. 响应转换（关键防御点）

**`chatToResponses()` — tool_calls 输出** (line 1033-1045):

```javascript
for (const tc of toolCalls) {
  const fn = tc.function || {};
  const name = (fn.name || "").trim();
  const args = fn.arguments || "";
  // ★ 防御：跳过空名 function_call
  if (!name) {
    log.warn(`[responses] skipping empty tool_call`);
    continue;
  }
  output.push({ type: "function_call", call_id: ..., name, arguments, ... });
}
```

**流式 delta — tool_calls 处理** (line 258-345):

```javascript
if (delta.tool_calls) {
  for (const tc of delta.tool_calls) {
    const tcName = (tc.function?.name || "").trim();
    // ★ 防御：跳过空名 function_call
    if (!tcName) { continue; }
    ...
  }
}
```

## 三、常见故障及排查

### 现象1: "unsupported call" 错误

**根因**: CODEX 收到 `function_call` 但找不到本地工具实现。

**排查步骤**:

```
1. 查 CODEX session log（用户本地）:
   grep "unsupported call" ~/.codex/sessions/$(date +%Y/%m/%d)/*.jsonl | tail -3
   → 看 call_id 和前面的 function_call name 字段

2. 查代理日志（VPS）:
   grep "\[responses\]" data/luoda.log | tail -10
   → 看 tools=N names=[...] 确认工具是否传到上游
   → 看 "upstream body sample" 确认请求体格式

3. curl 直接测试:
   curl -X POST http://VPS_IP:40000/v1/responses \
     -H "Authorization: Bearer test" -H "Content-Type: application/json" \
     -d '{"model":"codexAPI","input":[...],"tools":[...]}'
```

**已知模式A — 上游返回空名**:
- 日志: CODEX session 中 `"name":"","arguments":""` 
- 代理日志: `tools=N names=[bash,write,...]` (工具已发送)
- 原因: sensenova 代理的 deepseek-v4-flash 间歇性返回空 function_call
- 修复: 见第二章第4节的防御代码

**已知模式B — 工具未传到上游**:
- 代理日志: `NO tools sent! choice=...`
- 原因: 工具过滤逻辑拦截了全部工具
- 排查: 检查 `responsesToChat()` 中 map/filter 逻辑

**已知模式C — CODEX 工具注册表异常**:
- 所有工具都报 unsupported call
- 修复: `rm -rf ~/.codex/learning/` 然后重启 CODEX

### 现象2: 图表/曲线不显示

- 见 `admin/index.html` 的语法错误修复记录
- 关键: 整个 `<script>` 块中任何 SyntaxError 会导致所有功能失效

### 现象3: 模型自动切换

- 见 `lib/fallback.mjs` 的 single_model 锁定逻辑
- cond_switch_enabled 控制是否启用定时轮换
- 手动锁定的模型不会被 quota 超限自动清除

## 四、图片/多模态处理

### 图片传入

CODEX 通过 Responses API 发送图片，格式为 `input_image` 类型:

```
openai-responses.mjs line 612-623:
  input_image → 转换为 Chat 格式的 image_url
```

代理**透传**图片数据，不做任何过滤或压缩。

### .codexignore 规则（重要）

```
# ❌ 不要加图片/二进制文件过滤规则：
*.png
*.jpg
*.pdf
*.zip

# ✅ 可以加的是：
.codex/learning/
node_modules/
```

如果加了图片过滤，CODEX 无法将图片发送给模型，模型看不到图。

### 文件创建/编辑

CODEX 本地沙箱执行文件操作（bash、write_to_file 等工具）:
- 代理只负责转发模型返回的 `function_call` 响应
- 实际文件操作由 CODEX 本地执行
- 如果文件创建失败，检查 CODEX 是否有写权限

## 五、部署检查清单

修改 `.mjs` 文件后必须:
1. `scp` 到 VPS
2. `pkill -9 node` 杀掉旧进程
3. `nohup node index.mjs > data/luoda.log 2>&1 &` 启动
4. `curl http://localhost:40002/api/status` 验证

修改 `admin/*.html` / `admin/*.js` 后:
1. `scp` 到 VPS
2. 用户刷新浏览器 (Ctrl+F5)
3. **不需要重启服务**

## 六、持久化数据位置

| 数据 | 文件 | 说明 |
|------|------|------|
| 模型锁定 | `config-proxy.json` | single_model_codex/hermes/neizhi |
| Fallback 状态 | `config-proxy.json` | _fallbackState (idx, lastSwitch) |
| Token 统计 | `data/tokens.json` | 按月统计 |
| Token 日志 | `data/token-log.json` | 详细时间线 |
| 管理员设置 | `data/admin-tokens.json` | 管理面板数据 |
