use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

const APP_STATE_DIR: &str = ".codex-session-delete";
const SETTINGS_FILE: &str = "settings.json";
const LATEST_STATUS_FILE: &str = "latest-status.json";
const DIAGNOSTIC_LOG_FILE: &str = "codex-plus.log";

// ── Node.js portable runtime ──
// Node.exe is NOT bundled in the installer.  On first launch,
// the launcher auto-detects system node or downloads it to app data.

const NODE_DIR_NAME: &str = "node-portable";

pub fn node_portable_dir() -> PathBuf {
    app_data_dir().join(NODE_DIR_NAME)
}

pub fn node_exe_path() -> PathBuf {
    node_portable_dir().join("node.exe")
}

// ── Bridge paths (bundled in installer, read-only) ──
pub fn bridge_dir() -> PathBuf {
    exe_parent_dir().join("bridge")
}

pub fn bridge_index_path() -> PathBuf {
    bridge_dir().join("index.mjs")
}

pub fn bridge_env_path() -> PathBuf {
    bridge_dir().join(".env")
}

fn exe_parent_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// User-writable app data directory (for downloaded node.exe etc.)
/// Windows: %LOCALAPPDATA%/LDAI
/// macOS/Linux: ~/.ldcodex
pub fn app_data_dir() -> PathBuf {
    #[cfg(windows)]
    {
        if let Ok(p) = std::env::var("LOCALAPPDATA") {
            let dir = PathBuf::from(p).join("LDAI");
            let _ = std::fs::create_dir_all(&dir);
            return dir;
        }
    }
    if let Some(home_dir) = directories::BaseDirs::new().map(|dirs| dirs.home_dir().to_path_buf()) {
        let dir = home_dir.join(".ldcodex");
        let _ = std::fs::create_dir_all(&dir);
        return dir;
    }

    let dir = PathBuf::from(".ldcodex");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn default_app_state_dir() -> PathBuf {
    if let Some(home_dir) = directories::BaseDirs::new().map(|dirs| dirs.home_dir().to_path_buf()) {
        return home_dir.join(APP_STATE_DIR);
    }

    PathBuf::from(APP_STATE_DIR)
}

pub fn default_settings_path() -> PathBuf {
    if let Some(path) = settings_path_for_tests() {
        return path;
    }
    default_app_state_dir().join(SETTINGS_FILE)
}

pub fn default_latest_status_path() -> PathBuf {
    default_app_state_dir().join(LATEST_STATUS_FILE)
}

pub fn default_diagnostic_log_path() -> PathBuf {
    default_app_state_dir().join(DIAGNOSTIC_LOG_FILE)
}

fn settings_path_for_tests() -> Option<PathBuf> {
    SETTINGS_PATH_FOR_TESTS
        .get_or_init(|| Mutex::new(None))
        .lock()
        .ok()
        .and_then(|path| path.clone())
}

static SETTINGS_PATH_FOR_TESTS: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

pub fn set_settings_path_for_tests(path: Option<PathBuf>) -> Option<PathBuf> {
    SETTINGS_PATH_FOR_TESTS
        .get_or_init(|| Mutex::new(None))
        .lock()
        .ok()
        .and_then(|mut current| std::mem::replace(&mut *current, path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_path_uses_app_state_directory() {
        let path = default_settings_path();

        assert!(path.ends_with(".codex-session-delete/settings.json"));
    }

    #[test]
    fn default_latest_status_path_uses_app_state_directory() {
        let path = default_latest_status_path();

        assert!(path.ends_with(".codex-session-delete/latest-status.json"));
    }

    #[test]
    fn default_diagnostic_log_path_uses_app_state_directory() {
        let path = default_diagnostic_log_path();

        assert!(path.ends_with(".codex-session-delete/codex-plus.log"));
    }
}
