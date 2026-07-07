//! WorkBuddy 分身管理
//!
//! WorkBuddy 支持通过环境变量控制数据目录：
//! - `WORKBUDDY_CONFIG_DIR` → 配置目录（默认 `~/.workbuddy`）
//! - `WORKBUDDY_USER_DATA_DIR` → 用户数据目录（默认 `{configDir}/app`）
//! - `WORKBUDDY_INSTANCE_NUMBER` → 实例编号

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// WorkBuddy 分身配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkBuddyProfile {
    pub id: String,
    pub name: String,
    /// 分身的配置目录（WORKBUDDY_CONFIG_DIR）
    pub config_dir: String,
    pub created_at_ms: i64,
    pub last_launched_ms: Option<i64>,
}

/// 默认分身 ID
pub const WORKBUDDY_DEFAULT_PROFILE_ID: &str = "default";

// ========== 路径检测 ==========

/// WorkBuddy 安装目录检测
pub fn workbuddy_install_dir() -> Option<PathBuf> {
    // 1. 环境变量
    if let Some(dir) = std::env::var_os("WORKBUDDY_PATH") {
        let p = PathBuf::from(dir);
        if p.join("WorkBuddy.exe").exists() {
            return Some(p);
        }
    }
    // 2. 标准安装路径
    let candidates = [
        || {
            std::env::var_os("LOCALAPPDATA")
                .map(PathBuf::from)
                .map(|p| p.join("Programs").join("WorkBuddy"))
        },
        || {
            std::env::var_os("USERPROFILE")
                .map(PathBuf::from)
                .map(|p| p.join("AppData").join("Local").join("Programs").join("WorkBuddy"))
        },
        || Some(PathBuf::from(r"C:\Program Files\WorkBuddy")),
        || Some(PathBuf::from(r"C:\Program Files (x86)\WorkBuddy")),
    ];
    for f in &candidates {
        if let Some(p) = f() {
            if p.join("WorkBuddy.exe").exists() {
                return Some(p);
            }
        }
    }
    None
}

/// WorkBuddy 可执行文件路径
pub fn workbuddy_exe_path() -> Option<PathBuf> {
    workbuddy_install_dir().map(|d| d.join("WorkBuddy.exe"))
}

/// WorkBuddy app.asar 路径
pub fn workbuddy_asar_path() -> Option<PathBuf> {
    workbuddy_install_dir().map(|d| d.join("resources").join("app.asar"))
}

/// 获取用户主目录
fn user_home_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// 默认的 WB 配置目录：~/.workbuddy
pub fn workbuddy_default_config_dir() -> PathBuf {
    user_home_dir().join(".workbuddy")
}

/// 获取某个分身的数据目录（绝对路径）
///
/// 默认分身用 `~/.workbuddy`，其他分身用 `~/.workbuddy-profile-{id}`
pub fn workbuddy_profile_config_dir(profile_id: &str) -> PathBuf {
    if profile_id == WORKBUDDY_DEFAULT_PROFILE_ID {
        workbuddy_default_config_dir()
    } else {
        user_home_dir().join(format!(".workbuddy-profile-{}", profile_id))
    }
}

/// 获取 WorkBuddy 版本（从安装目录读取）
pub fn workbuddy_version() -> Option<String> {
    let exe = workbuddy_exe_path()?;
    if !exe.exists() {
        return None;
    }
    // 通过 PowerShell 获取文件版本
    let path_str = exe.to_string_lossy().replace('\'', "''");
    let script = format!("(Get-Item '{}').VersionInfo.FileVersion", path_str);
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .ok()?;
    if output.status.success() {
        let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !s.is_empty() {
            return Some(s);
        }
    }
    // 回退：ProductVersion
    let script2 = format!("(Get-Item '{}').VersionInfo.ProductVersion", path_str);
    let output2 = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script2])
        .output()
        .ok()?;
    if output2.status.success() {
        let s = String::from_utf8_lossy(&output2.stdout).trim().to_string();
        if !s.is_empty() {
            return Some(s);
        }
    }
    None
}

// ========== 分身配置文件管理 ==========

/// 分身配置文件路径 (%APPDATA%/LD AI工具/workbuddy-profiles.json)
fn workbuddy_profiles_path() -> PathBuf {
    let roaming = std::env::var_os("APPDATA")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    roaming.join("LD AI工具").join("workbuddy-profiles.json")
}

fn create_default_workbuddy_profile() -> WorkBuddyProfile {
    WorkBuddyProfile {
        id: WORKBUDDY_DEFAULT_PROFILE_ID.to_string(),
        name: "默认".to_string(),
        config_dir: ".workbuddy".to_string(),
        created_at_ms: 0,
        last_launched_ms: None,
    }
}

/// 列出所有 WB 分身
pub fn list_workbuddy_profiles() -> Vec<WorkBuddyProfile> {
    let path = workbuddy_profiles_path();
    if !path.exists() {
        let default = create_default_workbuddy_profile();
        let _ = save_workbuddy_profiles(&[default.clone()]);
        return vec![default];
    }
    match std::fs::read_to_string(&path) {
        Ok(content) => {
            serde_json::from_str(&content).unwrap_or_else(|_| vec![create_default_workbuddy_profile()])
        }
        Err(_) => vec![create_default_workbuddy_profile()],
    }
}

/// 保存 WB 分身列表
pub fn save_workbuddy_profiles(profiles: &[WorkBuddyProfile]) -> std::io::Result<()> {
    let path = workbuddy_profiles_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(profiles)?;
    std::fs::write(&path, content)
}

/// 生成唯一 ID
fn generate_workbuddy_profile_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("wb-profile-{}", ts)
}

/// 创建新 WB 分身
pub fn create_workbuddy_profile(name: &str) -> anyhow::Result<WorkBuddyProfile> {
    if name.trim().is_empty() {
        anyhow::bail!("分身名称不能为空");
    }
    let mut profiles = list_workbuddy_profiles();
    if profiles.iter().any(|p| p.name == name.trim()) {
        anyhow::bail!("分身名称已存在: {}", name);
    }
    let id = generate_workbuddy_profile_id();
    let config_dir = format!(".workbuddy-profile-{}", &id);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let profile = WorkBuddyProfile {
        id,
        name: name.trim().to_string(),
        config_dir,
        created_at_ms: now,
        last_launched_ms: None,
    };
    profiles.push(profile.clone());
    save_workbuddy_profiles(&profiles)?;
    Ok(profile)
}

/// 删除 WB 分身（只删除配置记录，不删除数据目录）
pub fn delete_workbuddy_profile(id: &str) -> anyhow::Result<()> {
    if id == WORKBUDDY_DEFAULT_PROFILE_ID {
        anyhow::bail!("不能删除默认分身");
    }
    let before = list_workbuddy_profiles();
    let len_before = before.len();
    let profiles: Vec<WorkBuddyProfile> = before.into_iter().filter(|p| p.id != id).collect();
    if profiles.len() == len_before {
        anyhow::bail!("未找到分身: {}", id);
    }
    save_workbuddy_profiles(&profiles)?;
    Ok(())
}

/// 更新 WB 分身最后启动时间
pub fn touch_workbuddy_profile(id: &str) -> anyhow::Result<()> {
    let mut profiles = list_workbuddy_profiles();
    if let Some(profile) = profiles.iter_mut().find(|p| p.id == id) {
        profile.last_launched_ms = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
        );
        save_workbuddy_profiles(&profiles)?;
    }
    Ok(())
}

/// 检查插件注入状态（检查 .bak 文件是否存在）
pub fn workbuddy_plugin_injected() -> bool {
    let asar_path = match workbuddy_asar_path() {
        Some(p) => p,
        None => return false,
    };
    if !asar_path.exists() {
        return false;
    }
    let bak_path = PathBuf::from(format!("{}.bak", asar_path.to_string_lossy()));
    bak_path.exists()
}
