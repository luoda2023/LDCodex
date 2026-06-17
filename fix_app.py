import os
os.chdir("J:/codex-work/LDCodex2")
c = open("apps/codex-plus-manager/src/App.tsx", "r", encoding="utf-8").read()

# 1. 标题栏加入左上角图标
old_tb = '<header className="titlebar" data-tauri-drag-region>\n        <span className="titlebar-title">LDCodex</span>'
new_tb = '<header className="titlebar" data-tauri-drag-region>\n        <img src="/logo.png" className="titlebar-icon" alt="" />\n        <span className="titlebar-title">LDCodex</span>'
c = c.replace(old_tb, new_tb)
print("1. Added titlebar icon")

# 2. Codex 版本 -> 软件版本 (改标签)
c = c.replace(
    '<Metric label="LDCodex 版本" value={overview?.current_version ?? "-"} />',
    '<Metric label="软件版本" value={overview?.current_version ?? "-"} />'
)
print("2. Changed label to software version")

open("apps/codex-plus-manager/src/App.tsx", "w", encoding="utf-8").write(c)
print("Done App.tsx")
