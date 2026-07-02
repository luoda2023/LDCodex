# LDZcode — ZCode 布局实时调整插件

## 使用方式

**双击 `inject-zcode.bat` 即可**（推荐）

它会自动：关闭 ZCode → 解压 app.asar → 注入插件 → 重新打包 → 清理临时文件。

## 功能

在 ZCode 右上角出现 LDZcode 入口按钮，点击弹出设置面板，可调整：
- 输入框宽度 / 高度
- 对话内容显示宽度
- 文字大小

快捷键：`Alt+L` 开关面板，`Esc` 关闭

## 目录文件

```
J:\WorkBuddy-work\LDZcode\
├── zcode-customize.js      插件主脚本
├── inject-zcode.bat        一键注入（双击运行）
├── inject-zcode.ps1        PowerShell 版备用
└── README-LDZcode.md       本文件
```

## ZCode 升级后

软件升级后插件会被覆盖，只需重新**双击 inject-zcode.bat** 即可恢复，配置不丢失（存在 localStorage）。

## 恢复原始 ZCode

如果有问题，删除 `app.asar`，把 `app.asar.bak` 重命名回 `app.asar` 即可。
