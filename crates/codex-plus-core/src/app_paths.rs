use std::ffi::OsStr;
use std::path::{Path, PathBuf};
const CODEX_PREFIX: &str = "OpenAI.Codex_";

fn dot_char() -> String {
    char::from(46u8).to_string()
}



fn codex_prefix_str() -> String {
    let _d = dot_char();
    "OpenAI.Codex_".to_string()
}

pub fn find_latest_codex_app_dir(root: &Path) -> Option<PathBuf> {
    let mut matches = std::fs::read_dir(root)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .filter_map(|path| version_tuple(&path).map(|version| (version, path)))
        .collect::<Vec<_>>();
    matches.sort_by(|left, right| left.0.cmp(&right.0));
    let (_, latest) = matches.pop()?;
    let app = latest.join("app");
    Some(if app.is_dir() { app } else { latest })
}

pub fn find_latest_codex_app_dir_from_roots(roots: &[PathBuf]) -> Option<PathBuf> {
    roots
        .iter()
        .filter_map(|root| find_latest_codex_app_dir(root))
        .max_by(|left, right| {
            version_tuple(left.parent().unwrap_or(left))
                .cmp(&version_tuple(right.parent().unwrap_or(right)))
        })
}

pub fn find_latest_codex_app_dir_default() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        find_latest_codex_app_dir_from_roots(&windows_app_package_roots())
    }

    #[cfg(not(windows))]
    {
        None
    }
}

#[cfg(windows)]
fn windows_app_package_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        roots.push(PathBuf::from(program_files).join("WindowsApps"));
    }
    if let Some(program_files) = std::env::var_os("ProgramW6432") {
        roots.push(PathBuf::from(program_files).join("WindowsApps"));
    }
    roots.push(PathBuf::from(r"C:\Program Files\WindowsApps"));
    roots.sort();
    roots.dedup();
    roots
}

pub fn user_data_candidates() -> Vec<PathBuf> {
    user_data_candidates_from(
        std::env::var_os("LOCALAPPDATA").as_deref().map(Path::new),
        std::env::var_os("APPDATA").as_deref().map(Path::new),
    )
}

pub fn user_data_candidates_from(local: Option<&Path>, roaming: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(local) = local {
        append_user_data_variants(&mut candidates, local);
    }
    if let Some(roaming) = roaming {
        append_user_data_variants(&mut candidates, roaming);
    }
    candidates
}


pub fn find_macos_codex_app(search_roots: &[PathBuf]) -> Option<PathBuf> {
    for root in search_roots {
        for candidate in macos_app_candidates(root) {
            if candidate.is_dir() {
                return Some(candidate);
            }
        }
    }
    None
}


pub fn find_macos_codex_app_default() -> Option<PathBuf> {
    let mut roots = vec![PathBuf::from("/Applications")];
    if let Some(home) = directories::BaseDirs::new().map(|dirs| dirs.home_dir().to_path_buf()) {
        roots.push(home.join("Applications"));
    }
    find_macos_codex_app(&roots)
}

pub fn resolve_codex_app_dir(app_dir: Option<&Path>) -> Option<PathBuf> {
    if let Some(app_dir) = app_dir {
        return normalize_codex_app_path(app_dir);
    }
    #[cfg(target_os = "macos")]
    {
        return find_macos_codex_app_default();
    }
    // Windows: try MS Store version first, then standalone install
    find_latest_codex_app_dir_default().or_else(|| find_standalone_codex_app_dir())
}

/// Search for standalone Codex installations (non-MS Store).
///
/// Common paths:
/// - %LOCALAPPDATA%\OpenAI\Codex\bin\  (standalone installer)
/// - %LOCALAPPDATA%\OpenAI\Codex\      (user data root)
/// - %LOCALAPPDATA%\Programs\OpenAI\Codex\ (alternative)
pub fn find_standalone_codex_app_dir() -> Option<PathBuf> {
    let local_appdata = std::env::var_os("LOCALAPPDATA")?;

    let candidates: &[PathBuf] = &[
        PathBuf::from(&local_appdata)
            .join("OpenAI")
            .join("Codex")
            .join("bin"),
        PathBuf::from(&local_appdata).join("OpenAI").join("Codex"),
        PathBuf::from(&local_appdata)
            .join("Programs")
            .join("OpenAI")
            .join("Codex"),
    ];

    for candidate in candidates {
        if let Some(path) = normalize_codex_app_path(candidate) {
            if build_codex_executable(&path).exists() {
                return Some(path);
            }
        }
    }
    // Also search hash-named subdirectories under bin/ (standalone installer layout)
    let bin_dir = PathBuf::from(&local_appdata).join("OpenAI").join("Codex").join("bin");
    if let Ok(entries) = std::fs::read_dir(&bin_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(normalized) = normalize_codex_app_path(&path) {
                    if build_codex_executable(&normalized).exists() {
                        return Some(normalized);
                    }
                }
            }
        }
    }
    None
}

pub fn resolve_codex_app_dir_with_saved(
    app_dir: Option<&Path>,
    saved_app_path: Option<&str>,
) -> Option<PathBuf> {
    if let Some(app_dir) = app_dir {
        return normalize_codex_app_path(app_dir);
    }
    if let Some(saved) = saved_app_path
        .map(str::trim)
        .filter(|saved| !saved.is_empty())
    {
        if let Some(path) = normalize_codex_app_path(Path::new(saved)) {
            return Some(path);
        }
    }
    resolve_codex_app_dir(None)
}

pub fn normalize_codex_app_path(path: &Path) -> Option<PathBuf> {
    if path.as_os_str().is_empty() {
        return None;
    }

    let file_name = path.file_name().and_then(OsStr::to_str).unwrap_or_default();
    if file_name.eq_ignore_ascii_case("Codex.exe") || file_name.eq_ignore_ascii_case("Codex.exe") {
        return path.parent().map(Path::to_path_buf);
    }

    if path.extension() == Some(OsStr::new("app")) {
        return Some(path.to_path_buf());
    }

    if path.is_file() {
        return path.parent().map(Path::to_path_buf);
    }

    let upper = path.join("Codex.exe");
    let lower = path.join("Codex.exe");
    if upper.exists() || lower.exists() {
        return Some(path.to_path_buf());
    }

    let nested_app = path.join("app");
    if nested_app.is_dir() {
        let upper = nested_app.join("Codex.exe");
        let lower = nested_app.join("Codex.exe");
        if upper.exists() || lower.exists() {
            return Some(nested_app);
        }
    }

    if path.is_dir() {
        return Some(path.to_path_buf());
    }

    None
}

pub fn build_codex_executable(app_dir: &Path) -> PathBuf {
    if app_dir.extension() == Some(OsStr::new("app")) {
        return app_dir.join("Contents").join("MacOS").join("Codex");
    }
    let upper = app_dir.join("Codex.exe");
    if upper.exists() {
        upper
    } else {
        app_dir.join("Codex.exe")
    }
}

pub fn codex_app_version(app_dir: &Path) -> Option<String> {
    if app_dir.extension() == Some(OsStr::new("app")) {
        return macos_app_version(app_dir);
    }
    let package_dir = if app_dir
        .file_name()
        .and_then(OsStr::to_str)
        .is_some_and(|name| name.eq_ignore_ascii_case("app"))
    {
        app_dir.parent()?
    } else {
        app_dir
    };
    //  MS Store ?
    if let Some(ver) = codex_package_version(package_dir) {
        return Some(ver);
    }
    //  MS Store :  package.json 
    standalone_codex_version(package_dir)
}

pub fn packaged_app_user_model_id(app_dir: &Path) -> Option<String> {
    let package_name = package_name_from_app_dir(app_dir)?;
    if !package_name.starts_with(&codex_prefix_str()) || !package_name.contains("__") {
        return None;
    }
    let identity_name = package_name.split_once('_')?.0;
    let publisher_id = package_name.rsplit_once("__")?.1;
    if publisher_id.is_empty() {
        return None;
    }
    Some(format!("{identity_name}_{publisher_id}!App"))
}

fn package_name_from_app_dir(app_dir: &Path) -> Option<String> {
    let path = app_dir.to_string_lossy().replace("\\", "/");
    let mut parts = path.split('/').filter(|part| !part.is_empty());
    let mut package_name = parts.next_back()?;
    if package_name.eq_ignore_ascii_case("app") {
        package_name = parts.next_back()?;
    }
    Some(package_name.to_string())
}

fn codex_package_version(package_dir: &Path) -> Option<String> {
    // MS Store :  OpenAI.Codex_version_xxx 
    let path = package_dir.to_string_lossy().replace('\\', "/");
    let name = path
        .split('/')
        .rev()
        .find(|part| part.starts_with(&codex_prefix_str()))?;
    let rest = name.strip_prefix(&codex_prefix_str())?;
    let version = rest.split_once('_')?.0;
    if version.is_empty() {
        None
    } else {
        Some(version.to_string())
    }
}

fn standalone_codex_version(app_dir: &Path) -> Option<String> {
    // MS Store:  package.json 
    let try_paths = [
        Some(app_dir.join("resources").join("package.json".to_string())),
        app_dir.parent().map(|p| p.join("app").join("resources").join("package.json".to_string())),
        Some(app_dir.join("package.json".to_string())),
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
    // Windows:  Codex.exe  ( PowerShell)
    #[cfg(windows)]
    {
        let exe_candidates = [
            app_dir.join("Codex.exe"),
            app_dir.join("Codex.exe"),
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
    //  Windows API  EXE 
    get_exe_version(exe_path)
}

#[cfg(windows)]
fn get_exe_version(exe_path: &Path) -> Option<String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;

    let path_wide: Vec<u16> = OsStr::new(exe_path.as_os_str())
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let mut dummy: u32 = 0;
        let size = GetFileVersionInfoSizeW(path_wide.as_ptr(), &mut dummy);
        if size == 0 {
            return None;
        }

        let mut buffer = vec![0u8; size as usize];
        let ret = GetFileVersionInfoW(
            path_wide.as_ptr(),
            0,
            size,
            buffer.as_mut_ptr() as *mut std::ffi::c_void,
        );
        if ret == 0 {
            return None;
        }

        let mut len: u32 = 0;
        let mut subblock_ptr: *mut std::ffi::c_void = ptr::null_mut();
        let subblock: Vec<u16> = OsStr::new("\\")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let ret2 = VerQueryValueW(
            buffer.as_ptr() as *const std::ffi::c_void,
            subblock.as_ptr(),
            &mut subblock_ptr,
            &mut len,
        );
        if ret2 == 0 || len == 0 || len < 52 || subblock_ptr.is_null() {
            return None;
        }

        let info = &*(subblock_ptr as *const VS_FIXEDFILEINFO);
        // VS_FIXEDFILEINFO.dwSignature must be 0xFEEF04BD
        if info.dwSignature != 0xFEEF04BD {
            return None;
        }
        let major = (info.dwFileVersionMS >> 16) & 0xFFFF;
        let minor = info.dwFileVersionMS & 0xFFFF;
        let patch = (info.dwFileVersionLS >> 16) & 0xFFFF;
        Some(format!("{}.{}.{}", major, minor, patch))
    }
}

#[cfg(windows)]
#[repr(C)]
struct VS_FIXEDFILEINFO {
    dwSignature: u32,
    dwStrucVersion: u32,
    dwFileVersionMS: u32,
    dwFileVersionLS: u32,
    dwProductVersionMS: u32,
    dwProductVersionLS: u32,
    dwFileFlagsMask: u32,
    dwFileFlags: u32,
    dwFileOS: u32,
    dwFileType: u32,
    dwFileSubtype: u32,
    dwFileDateMS: u32,
    dwFileDateLS: u32,
}

#[cfg(windows)]
#[link(name = "version")]
unsafe extern "system" {
    fn GetFileVersionInfoSizeW(
        lptstrFilename: *const u16,
        lpdwHandle: *mut u32,
    ) -> u32;
    fn GetFileVersionInfoW(
        lptstrFilename: *const u16,
        dwHandle: u32,
        dwLen: u32,
        lpData: *mut std::ffi::c_void,
    ) -> i32;
    fn VerQueryValueW(
        pBlock: *const std::ffi::c_void,
        lpSubBlock: *const u16,
        lplpBuffer: *mut *mut std::ffi::c_void,
        puLen: *mut u32,
    ) -> i32;
}

fn macos_app_version(app_dir: &Path) -> Option<String> {
    let plist = std::fs::read_to_string(app_dir.join("Contents").join("Info.plist")).ok()?;
    plist_string_value(&plist, "CFBundleShortVersionString")
        .or_else(|| plist_string_value(&plist, "CFBundleVersion"))
}


fn plist_string_value(plist: &str, key: &str) -> Option<String> {
    let (_, after_key) = plist.split_once(&format!("<key>{key}</key>"))?;
    let (_, after_string_open) = after_key.split_once("<string>")?;
    let (value, _) = after_string_open.split_once("</string>")?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn append_user_data_variants(candidates: &mut Vec<PathBuf>, base: &Path) {
    candidates.push(base.join("OpenAI").join("Codex"));
    candidates.push(base.join("OpenAI.Codex"));
    candidates.push(base.join("Codex"));
}


fn macos_app_candidates(root: &Path) -> Vec<PathBuf> {
    if root.extension() == Some(OsStr::new("app")) {
        return vec![root.to_path_buf()];
    }
    vec![
        root.join("Codex.app"),
        root.join("OpenAI Codex.app"),
        root.join("OpenAI.Codex.app"),
    ]
}

fn version_tuple(path: &Path) -> Option<Vec<u32>> {
    let name = path.file_name()?.to_str()?;
    let rest = name.strip_prefix(&codex_prefix_str())?;
    let version = rest.split_once('_')?.0;
    let parts = version
        .split('.')
        .map(str::parse::<u32>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    if parts.is_empty() { None } else { Some(parts) }
}















