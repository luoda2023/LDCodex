# 工作区记忆 / Work Memory

## LuoDaBridge 部署 Skill (创建于 2026-06-10)
- **位置**: J:\codex-bridge-main\.workbuddy\skills\luodabridge-deploy\SKILL.md
- **覆盖**: 预检查 → 备份 → 上传 → 重启 → 健康检查 → 自动回滚
- **触发词**: 部署、上线、发布到 VPS、deploy

## LuoDaBridge 健康检查自动化 (创建于 2026-06-10)
- **规则**: 每小时执行，检查 40001/40000 端口 + 进程 + 日志
- **异常阈值**: 连续 3 次失败 → CRITICAL

## CODEX 5 步初始化 Skill (创建于 2026-06-10)
- **位置**: J:\CODEX-WORK\.workbuddy\skills\codex-5step-init\SKILL.md
- **覆盖**: AGENTS.md + .codexignore + config.toml (审批模式/预算/MCP)
- **触发词**: 初始化 CODEX、新项目、5步初始化

## 图表智能切换 (#76, 2026-06-13)
- `renderTokenChart()` 内部**不调用** `autoSelectChartView()` — tokenLog 未就绪时误判
- 只在 `/api/tokens/log` 回调中执行视图选择（tokenLog 已就绪后）
- `/api/tokens` 回调中加 `if (tokenLog.length > 0)` 守卫

## manage.mjs 独立服务 (#77, 2026-06-13)
- 管理服务端口: config=37001, admin=37002
- PROXY_PORT 必须指向实际运行的代理端口（40000）
- 与主服务 index.mjs 独立运行，互不阻塞
