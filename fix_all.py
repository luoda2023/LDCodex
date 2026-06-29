import os, re, sys
from pathlib import Path

root = Path(os.getcwd())
src_dir = root / "apps/codex-plus-manager/src"

changed_files = []

def replace_in_file(filepath, patterns):
    """Apply list of (pattern, replacement) tuples to file."""
    try:
        content = filepath.read_text('utf-8', errors='replace')
    except:
        return False
    
    original = content
    for pattern, replacement in patterns:
        content = re.sub(pattern, replacement, content)
    
    if content != original:
        filepath.write_text(content, 'utf-8')
        return True
    return False

def remove_matching_braces(content, start_idx):
    """Remove matching braces content starting at start_idx."""
    brace_count = 0
    found_start = False
    end_idx = start_idx
    for i in range(start_idx, len(content)):
        if content[i] == '{':
            brace_count += 1
            found_start = True
        elif content[i] == '}':
            brace_count -= 1
        if found_start and brace_count == 0:
            end_idx = i + 1
            break
    return content[:start_idx] + content[end_idx:]

# ===== Process App.tsx =====
app_tsx = src_dir / "App.tsx"
content = app_tsx.read_text('utf-8', errors='replace')
original = content

# 1. Remove Zed type definitions
content = re.sub(r'type ZedOpenStrategy[\s\S]*?"default";', '', content)
content = re.sub(r'type ZedRemoteProject = \{[^}]+\};', '', content)
content = re.sub(r'type ZedRemoteProjectsResult[\s\S]*?\};', '', content)
content = re.sub(r'type ZedRemoteOpenResult[\s\S]*?\};', '', content)

# 2. Remove Settings interface fields
fields = [
    'codexAppZedRemoteOpen: boolean;',
    'zedRemoteOpenStrategy: ZedOpenStrategy;', 
    'zedRemoteProjectRegistryEnabled: boolean;',
    'zedRemoteSyncToZedSettings: boolean;',
    'contextSelectionInitialized: boolean;',
]
for f in fields:
    content = re.sub(rf'  {re.escape(f)}\n', '', content)

# 3. Remove default values
defaults = [
    'codexAppZedRemoteOpen: true,',
    'zedRemoteOpenStrategy: "addToFocusedWorkspace",',
    'zedRemoteProjectRegistryEnabled: true,',
    'zedRemoteSyncToZedSettings: false,',
    'contextSelectionInitialized: true,',
]
for d in defaults:
    content = re.sub(rf'  {re.escape(d)}\n', '', content)

# 4. Remove zedRemoteProjects state
content = re.sub(r'const \[zedRemoteProjects, setZedRemoteProjects\][^;]+;\n', '', content)

# 5. Replace Route type
content = content.replace(
    'type Route = "overview" | "relay" | "mobileControl" | "sessions" | "context" | "enhance" | "zedRemote" | "userScripts" | "recommendations" | "maintenance" | "about" | "settings"',
    'type Route = "overview" | "relay" | "mobileControl" | "sessions" | "context" | "enhance" | "maintenance" | "about" | "settings"'
)

# 6. Remove sidebar menu entries
content = re.sub(
    r'  \{ id: "zedRemote", label: "[^"]*", icon: ExternalLink \},\n  \{ id: "userScripts", label: "[^"]*", icon: FileCode2 \},\n  \{ id: "recommendations", label: "[^"]*", icon: ExternalLink \},',
    '', content
)

# 7. Find and remove function blocks
for func_name in ['const openZedRemoteProject', 'const forgetZedRemoteProject', 'const refreshZedRemoteProjects']:
    while func_name in content:
        idx = content.index(func_name)
        content = remove_matching_braces(content, idx)
        # Also remove preceding semicolon/newline
        content = re.sub(r'\n\s*;\s*\n', '\n', content)

# 8. Remove references to removed functions
for ref in ['await refreshZedRemoteProjects', 'refreshZedRemoteProjects', 'openZedRemoteProject', 'forgetZedRemoteProject']:
    content = re.sub(rf',?\s*{re.escape(ref)}[^,]*', '', content)

# 9. Remove route handlers
content = re.sub(r'if \(next === "zedRemote"\) \{[\s\S]*?\}\n', '', content)
content = re.sub(r'if \(next === "userScripts"\) \{[\s\S]*?\}\n', '', content)
content = re.sub(r'if \(next === "recommendations"\) [^;]+;\n', '', content)

# 10. Remove route descriptions
content = re.sub(r'zedRemote: "[^"]*",\s*userScripts: "[^"]*",\s*recommendations: "[^"]*",', '', content)

# 11. Branding replacement
content = content.replace('供应商配置', '模型配置')
content = content.replace('启动 LDCodex', '启动代理')
content = content.replace('启动Codex', '启动代理')
content = content.replace('打开管理面板', '打开代理信息页')
content = content.replace('github.com/BigPizzaV3/CodexPlusPlus', 'github.com/luoda2023/LDCodex')

# 12. Debug/Helper labels
content = content.replace(
    '<Metric label="Debug" value={String(status.debug_port ?? "-")} />',
    '<Metric label="调试端口" value={String(status.debug_port ?? "-")} />'
)
content = content.replace(
    '<Metric label="Helper" value={String(status.helper_port ?? "-")} />',
    '<Metric label="辅助端口" value={String(status.helper_port ?? "-")} />'
)

# 13. Remove page rendering blocks
for route in ['zedRemote', 'userScripts', 'recommendations']:
    while f'{{activeRoute === "{route}"' in content:
        idx = content.index(f'{{activeRoute === "{route}"')
        content = remove_matching_braces(content, idx)
        # Clean up empty lines
        content = re.sub(r'\n{3,}', '\n\n', content)

# 14. Version
content = re.sub(r'"version": "\d+\.\d+\.\d+"', '"version": "3.0.2"', content)

# 15. Remove zedRemote/userScripts/recommendations imports if any separate
# Check for ZedRemoteScreen, UserScriptsScreen, RecommendationsScreen imports
content = re.sub(r'import.*ZedRemoteScreen.*from.*;', '', content)
content = re.sub(r'import.*UserScriptsScreen.*from.*;', '', content)
content = re.sub(r'import.*RecommendationsScreen.*from.*;', '', content)

if content != original:
    app_tsx.write_text(content, 'utf-8')
    changed_files.append(str(app_tsx))
    print(f"Modified: {app_tsx.name}")

print(f"Changed {len(changed_files)} files")
