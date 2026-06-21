import sys

with open('src/app_paths.rs', 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()

start = 'fn standalone_codex_version(app_dir: &Path) -> Option<String> {'
idx = content.find(start)
if idx < 0:
    print('ERROR: function not found')
    sys.exit(1)

# find end of the `windows_exe_version` function (which comes after standalone_codex_version)
# Actually, let's find the standalone_codex_version function end
brace = 0
end = idx
for i in range(idx, len(content)):
    if content[i] == '{':
        brace += 1
    elif content[i] == '}':
        brace -= 1
        if brace == 0:
            end = i + 1
            break

# Now find the windows_exe_version function that comes after and also remove it
# Look for #[cfg(windows)]\nfn windows_exe_version
win_fn_start = content.find('#[cfg(windows)]\nfn windows_exe_version', end)
if win_fn_start >= 0:
    brace = 0
    win_fn_end = win_fn_start
    for i in range(win_fn_start, len(content)):
        if content[i] == '{':
            brace += 1
        elif content[i] == '}':
            brace -= 1
            if brace == 0:
                win_fn_end = i + 1
                break
    # Remove both functions
    content = content[:idx] + content[win_fn_end:]
else:
    # Remove just standalone_codex_version
    content = content[:idx] + content[end:]

new_fn = """fn standalone_codex_version(app_dir: &Path) -> Option<String> {
    // 非MS Store安装: 先尝试从 package.json 获取版本号
    let try_paths = [
        Some(app_dir.join("resources").join("package.json")),
        app_dir.parent().map(|p| p.join("app").join("resources").join("package.json")),
        Some(app_dir.join("package.json")),
    ];
    for p in try_paths.into_iter().flatten() {
        if p.exists() {
            if let Ok(text) = std::fs::read_to_string(&p) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(ver) = json.get("version").and_then(|v| v.as_str()) {
                        return Some(ver.to_string());
                    }
                }
            }
        }
    }
    // Windows回退: 从 Codex.exe 读取文件版本信息 (通过 PowerShell)
    #[cfg(windows)]
    {
        let exe_candidates = [
            app_dir.join("Codex.exe"),
            app_dir.join("codex.exe"),
        ];
        for exe in &exe_candidates {
            if exe.exists() {
                if let Some(ver) = file_version_via_powershell(exe) {
                    return Some(ver);
                }
            }
        }
    }
    None
}

#[cfg(windows)]
fn file_version_via_powershell(exe_path: &Path) -> Option<String> {
    let path_str = exe_path.to_string_lossy().replace('\'', "''");
    let script = format!("(Get-Item '{}').VersionInfo.FileVersion", path_str);
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if ver.is_empty() { None } else { Some(ver) }
}"""

content = content[:idx] + new_fn + content[idx:]
with open('src/app_paths.rs', 'w', encoding='utf-8') as f:
    f.write(content)
print('OK: replaced successfully')
