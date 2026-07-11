# LDCodex 项目文档

> 项目根目录：`J:/codex-work/LDCodex`

---

## 目录

- [1. 项目概览](#1-项目概览)
- [2. 环境要求](#2-环境要求)
- [3. 构建指南](#3-构建指南)
- [4. 运行指南](#4-运行指南)
- [5. WorkBuddy 集成](#5-workbuddy-集成)
- [6. ZCode 插件注入](#6-zcode-插件注入)
- [7. 常见问题](#7-常见问题)

---

## 1. 项目概览

LDCodex 是 Codex 的第三方增强管理工具，提供：

- **管理工具**（ldcodex-manager）：管理 Codex 运行配置、ZCode 插件、分身等
- **静默启动器**（ldcodex-silent）：后台启动 Codex，不显示控制台窗口
- **ZCode 插件**（LDZcode）：注入 ZCode 的布局调整脚本

### 核心目录结构

```
J:/codex-work/LDCodex/
├── apps/
│   └── codex-plus-manager/     # 管理工具主应用
│       └── src-tauri/
│           ├── src/
│           │   └── commands.rs  # 后端命令（注入、启动等）
│           └── assets/
│               ├── zcode-customize.js   # ZCode 插件脚本
│               ├── do-inject.js         # 注入脚本（Node.js）
│               ├── inject-zcode.bat     # 注入批处理
│               └── toggle-parallel.js   # 并行对话开关
├── crates/
│   ├── codex-plus-core/        # 核心库（安装、路径管理、SQLite）
│   └── codex-plus-data/        # 数据层
└── docs/                       # 文档
```

---

## 2. 环境要求

| 工具 | 版本 | 用途 |
|------|------|------|
| Rust | 1.85+ | 编译后端 |
| Node.js | 22+ | 前端构建 + ZCode 注入 |
| npm | 10+ | 前端依赖 |
| @electron/asar | ^4.2.0 | asar 解包/打包（ZCode 注入用） |

### 检测命令

```bash
rustc --version
node --version
npm --version
```

---

## 3. 构建指南

### 3.1 开发构建

```bash
# 安装前端依赖
cd apps/codex-plus-manager
npm install

# 开发模式（带热重载）
npm run tauri:dev

# 生产构建
npm run tauri:build
```

### 3.2 CI/CD 自动构建

GitHub Actions 两个 workflow：

| Workflow | 触发方式 | 产物 |
|----------|----------|------|
| `pr-build.yml` | Push main | 验证构建（Artifacts）|
| `release-assets.yml` | 创建 Release | Windows/Mac 安装包（Release Assets）|

**发布步骤**：
```bash
# 1. 推送代码
git push origin main

# 2. 等待 pr-build.yml 通过

# 3. 创建 Release 标签触发 release-assets.yml
gh release create v10.0.x --title "v10.0.x" --notes "变更说明"
```

---

## 4. 运行指南

### 4.1 管理工具

启动后界面：
- 概览页：显示 Codex/ZCode 状态、Quick Actions
- ZCode 页：注入插件、管理分身、启动/关闭

### 4.2 启动 Codex

1. 确保 Codex 已安装（到 settings 页选择 Codex.exe 路径）
2. 点击"启动 Codex"按钮
3. 启动流程：管理工具 → silent launcher（ldcodex-silent）→ Codex.exe

> 如果按钮没反应，检查 settings 里 `codexAppPath` 是否指向正确的 Codex.exe

### 4.3 启动 ZCode

管理工具 ZCode 页面 → "启动 ZCode"按钮。
ZCode 安装目录自动检测：

```
%LOCALAPPDATA%\Programs\ZCode\ZCode.exe
%USERPROFILE%\AppData\Local\Programs\ZCode\ZCode.exe
%ProgramFiles%\ZCode\ZCode.exe
```

---

## 5. WorkBuddy 集成

WorkBuddy 工作目录：`J:/WorkBuddy-work/LDZcode/`

### 5.1 关系

```
管理工具注入 → ~/.zcode/LDZcode/  ← 运行时插件目录
                    ↓（手动同步）
              WorkBuddy-work/LDZcode/  ← 开发调试目录
```

### 5.2 同步命令

```bash
# 从仓库同步到 WorkBuddy 目录
cp apps/codex-plus-manager/src-tauri/assets/zcode-customize.js J:/WorkBuddy-work/LDZcode/
cp apps/codex-plus-manager/src-tauri/assets/do-inject.js J:/WorkBuddy-work/LDZcode/
cp apps/codex-plus-manager/src-tauri/assets/inject-zcode.bat J:/WorkBuddy-work/LDZcode/
```

---

## 6. ZCode 插件注入

### 6.1 注入原理

通过修改 ZCode 的 `app.asar` 文件，注入 `zcode-customize.js` 到 renderer 层，并在 `index.html` 添加 `<script>` 引用。

### 6.2 注入方案对比

| 方案 | 方式 | 可靠性 | 依赖 |
|------|------|--------|------|
| **方案1（推荐）** | `do-inject.js` + asar CLI | ✅ 稳定 | Node.js + `@electron/asar` 包 |
| **方案2（兜底）** | `inject-zcode.bat`（npx asar CLI） | ⚠️ 需网络 | Node.js + npx |
| **方案3（管理工具）** | `inject_zcode_plugin` 命令 | ✅ | 管理工具自带 |

### 6.3 手动注入

```bash
cd J:/WorkBuddy-work/LDZcode
node do-inject.js
```

输出示例：
```
[1/4] 解压 app.asar...       完成
[2/4] script 引用已写入 ✅
[3/4] 插件脚本已复制 ✅
[4/4] 打包 app.asar...        完成 ✅
✅ LDZcode 插件注入成功！
```

### 6.4 管理工具注入

在管理工具 ZCode 页面点击"注入"按钮，会自动：
1. 释放内置脚本到 `~/.zcode/LDZcode/`
2. 调用 `do-inject.js` 执行注入
3. 返回注入结果

### 6.5 ZCode 升级后重注入

ZCode 升级会覆盖 `app.asar`，需要重新注入：
- **方式一**：管理工具 ZCode 页面 → 点"注入"
- **方式二**：双击 `~/.zcode/LDZcode/inject-zcode.bat`
- **方式三**：`node ~/.zcode/LDZcode/do-inject.js`

### 6.6 插件功能

注入后，ZCode 右上角会出现 `[LDZcode]` 按钮（快捷键 `Alt + L`）：

| 滑块 | 功能 | 范围 | 默认 |
|------|------|------|------|
| 全局宽度 | 消息区 + 输入框最大宽度 | 24-120 rem | 64 |
| 输入框高度 | 输入框最小高度 | 4-40 rem | 10 |
| 文字大小 | 消息内容区字体大小 | 10-24 px | 14 |

> **注意**："文字大小"只影响消息内容区（`.prose`、`.markdown` 内的段落/列表），不影响侧边栏、输入框、按钮等控件。

---

## 7. 常见问题

### Q: 管理工具点了"启动 Codex"没反应

- **原因**：settings 里 `codexAppPath` 未设置或指向错误路径
- **解决**：settings 页 → 选择 Codex.exe 的正确路径 → 保存后再启动
- **自动检测路径**：
  ```
  %LOCALAPPDATA%\Programs\Codex\Codex.exe
  %USERPROFILE%\AppData\Local\Programs\Codex\Codex.exe
  %ProgramFiles%\Codex\Codex.exe
  ```

### Q: inject-zcode.bat 提示"找不到 ZCode.exe"

- **原因**：系统环境变量 `%LOCALAPPDATA%` 可能携带尾部空格导致路径错
- **解决**：设置环境变量 `ZCODE_DIR=ZCode安装目录` 后重试
- **注册表检测**：新版本 BAT 已添加注册表查询

### Q: do-inject.js 注入失败

- **错误 "Cannot find module @electron/asar"**：`@electron/asar` 包未安装
  ```bash
  cd ~/.zcode/LDZcode
  npm install @electron/asar
  ```
- **错误 "asar extract/pack failed"**：检查 app.asar 是否被占用（关闭 ZCode 后重试）

### Q: 插件滑块调整后没效果

- **CSS 未刷新**：ZCode 的 React 重建时，注入的 `<style>` 标签不会被移除，但 `textContent` 更新可能被覆盖
- **解决方案**：关闭 ZCode 重新打开（每次重启 ZCode 后插件重新初始化）

### Q: 调字号时输入框宽度也变了

- **原因**：旧版插件用 `*{font-size}` 全局选择器改变了所有元素的字号
- **修复**：v3.6 已改为只作用于消息内容区 `.prose`、`[class*=markdown]` 等元素
- **仍然有问题**：输入框的 `max-width` 用 rem 单位，rem 基于根字号（`<html>`），插件不改根字号则不影响

### Q: 输入框高度滑块不生效

- **原因**：`*{font-size:!important}` 全局选择器强制了行高，`min-height` 被撑爆
- **修复**：v3.6 已去掉全局选择器，输入框独立控制
- **检查**：当前插件版本可在面板标题栏看到（`LDZcode v3.6`）

---

*文档版本：v1.0 | 最后更新：2026-07-11*
