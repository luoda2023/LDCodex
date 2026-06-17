# LUODA 中转路由 — 使用说明

## 快速启动

```bash
# 方式一：后台运行（推荐）
双击「启动后台服务.bat」

# 方式二：命令行
node index.mjs
```

## 端口说明

| 服务 | 端口 | 用途 |
|------|------|------|
| 代理服务 | 40000 | AI 模型请求转发，Codex CLI / Hermes 接入点 |
| 配置 API | 40001 | 后端配置管理接口 |
| 管理面板 | 40002 | Web 管理后台 |

## 管理面板

**地址：** `http://127.0.0.1:40002`

**默认密码：** `lkw666999`

### 功能模块

| 页面 | 功能 |
|------|------|
| 控制台（首页） | 运行状态仪表盘、Token 统计图表、模型健康度、模型运行状态表 |
| AI 模型库 | 自定义模型管理（增删改）、内置模型库、异常模型、自动轮循队列 |
| CODEX 配置 | Codex CLI 代理配置编辑 |
| Hermes 配置 | Hermes Agent 代理配置编辑 |
| AI 配额管理 | OpenRelay 转发代理集成面板 |
| 系统设置 | 端口、间隔、沙箱模式等全局设置 |

## 安全机制

- **密码保护**：反转字符串 → SHA-256 双保险，明文不存储不传输
- **会话管理**：HttpOnly Cookie + 8 小时超时自动登出
- **登录限速**：5 次失败锁定 30 秒
- **认证保护**：未登录无法访问任何页面

## 性能优化（低配 VPS）

当前优化参数已配置在 `.env`：

```
# 并发控制
DYN_LIMIT_MIN=10        # 最小并发（防突发）
DYN_LIMIT_MAX=40        # 最大并发（防过载）
DYN_TARGET_LATENCY=8000 # 目标延迟 8 秒（越短响应越快）
DYN_TUNE_INTERVAL=10000 # 调优间隔 10 秒

# 超时控制
UPSTREAM_TIMEOUT_MS=60000  # 上游超时 60 秒
```

如 VPS 性能较低，可将 `DYN_LIMIT_MAX` 降到 20-30。

## 部署到 VPS

```bash
# 1. 上传代码
scp -r J:/codex-bridge-main root@你的VPS:/opt/1panel/LuoDaBridge

# 2. 安装依赖
cd /opt/1panel/LuoDaBridge
npm install --production

# 3. 启动
bash start.sh

# 4. 查看日志
tail -f data/luoda.log
```

## 故障排查

**Q: 管理面板无法打开？**
A: 确认服务已启动（`node index.mjs`），访问 `http://127.0.0.1:40002`

**Q: 页面提示"连接失败"？**
A: 必须通过服务访问，不支持直接打开 HTML 文件

**Q: 新增模型刷新后丢失？**
A: 浏览器需允许 localStorage，数据自动持久化

**Q: 代理转发速度慢？**
A: 调整 `.env` 中的 `DYN_TARGET_LATENCY` 降低目标延迟
