import sys

with open('app_paths.rs', 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()

start = 'fn standalone_codex_version(app_dir: &Path) -> Option<String> {'
idx = content.find(start)
if idx < 0:
    print('ERROR: function not found')
    sys.exit(1)

# find end of function
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
    // Windows fallback: read file version from Codex.exe
    #[cfg(windows)]
    {
        let exe_path = app_dir.join("Codex.exe");
        if exe_path.exists() {
            return windows_exe_version(&exe_path);
        }
        let exe_path_lower = app_dir.join("codex.exe");
        if exe_path_lower.exists() {
            return windows_exe_version(&exe_path_lower);
        }
    }
    None
}

#[cfg(windows)]
fn windows_exe_version(exe_path: &Path) -> Option<String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::System::Version::{
        GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
    };
    use windows::core::PCWSTR;

    let wide: Vec<u16> = OsStr::new(exe_path.as_os_str())
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        let size = GetFileVersionInfoSizeW(PCWSTR::from_raw(wide.as_ptr()), None);
        if size == 0 {
            return None;
        }
        let mut buffer = vec![0u8; size as usize];
        if GetFileVersionInfoW(
            PCWSTR::from_raw(wide.as_ptr()),
            0,
            size,
            buffer.as_mut_ptr() as *mut std::ffi::c_void,
        ).is_err() {
            return None;
        }
        let mut len = 0u32;
        let mut ptr: *mut std::ffi::c_void = std::ptr::null_mut();
        let sub_block = "\\\\";
        let sub_block_wide: Vec<u16> = OsStr::new(sub_block)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        if VerQueryValueW(
            buffer.as_ptr() as *const std::ffi::c_void,
            PCWSTR::from_raw(sub_block_wide.as_ptr()),
            &mut ptr,
            &mut len,
        ).is_err() || len == 0 {
            return None;
        }
        let info = &*(ptr as *const u16 as *const windows::Win32::System::Version::VS_FIXEDFILEINFO);
        let ms = info.dwFileVersionMS;
        let ls = info.dwFileVersionLS;
        let major = (ms >> 16) & 0xFFFF;
        let minor = ms & 0xFFFF;
        let patch = (ls >> 16) & 0xFFFF;
        let _build = ls & 0xFFFF;
        Some(format!("{}.{}.{}", major, minor, patch))
    }
}"""

content = content[:idx] + new_fn + content[end:]
with open('app_paths.rs', 'w', encoding='utf-8') as f:
    f.write(content)
print('OK: replaced successfully')
