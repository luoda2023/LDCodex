# 修复总结 (2026-06-13 第二轮修复)

## 完成的工作

### 1. 修复模型使用排行不显示数据
- **根因**：`renderModelRanking()` 中 `esc(p.name)` 的 **`esc()` 函数从未定义**，导致 `ReferenceError`，整个 for 循环崩溃
- 排行榜一直显示"暂无使用数据"，即使后端 API 正确返回 `byProvider` 数据
- **修复**：添加完整的 `esc()` HTML 实体转义函数

### 2. 修复全部模型数字不随曲线图变化
- **根因**：stat 值使用 `statTotal`（全量累计），不跟随视图切换
- **修复**：改为使用 `grandTotal`（当前视图数据：小时/天/月）
- 影响范围：
  - 全部模型 / neizhiAPI / CodexAPI / HermesAPI 数字
  - API 使用条宽度和百分比
  - 各 API 占比百分比
- 保留全量数据：每周 Token 消耗量

## 当前验证
- `/api/tokens` 返回 `byProvider` ✅ (st45, shangtang6, shangtang2)
- 所有 script blocks 语法检查通过 ✅ (7 blocks)
- 关键函数检查全部通过 ✅ (esc 等 7 个函数)
