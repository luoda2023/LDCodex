use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 获取 ZCode 数据目录 (~/.zcode/v2)
pub fn zcode_home_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .map(|home| home.join(".zcode").join("v2"))
        .unwrap_or_else(|| PathBuf::from(".zcode/v2"))
}

/// ZCode 对话数据库路径
pub fn zcode_session_db_path() -> PathBuf {
    zcode_home_dir().join("tasks-index.sqlite")
}

/// ZCode SQLite sidecar 文件路径（WAL + SHM）
pub fn zcode_sqlite_sidecar_paths(db_path: &Path) -> [PathBuf; 3] {
    [
        db_path.to_path_buf(),
        PathBuf::from(format!("{}-wal", db_path.to_string_lossy())),
        PathBuf::from(format!("{}-shm", db_path.to_string_lossy())),
    ]
}

/// ZCode 安装目录
pub fn zcode_install_dir() -> PathBuf {
    PathBuf::from(r"C:\Users\Administrator\AppData\Local\Programs\ZCode")
}

/// ZCode 可执行文件路径
pub fn zcode_exe_path() -> PathBuf {
    zcode_install_dir().join("ZCode.exe")
}

/// ZCode app.asar 路径
pub fn zcode_asar_path() -> PathBuf {
    zcode_install_dir().join("resources").join("app.asar")
}

/// ZCode 版本检测（从 app-update.yml 同级读取版本，或通过 exe 文件版本）
pub fn zcode_version() -> Option<String> {
    // 从安装目录读取版本信息
    let metafile = zcode_install_dir().join("app-update.yml");
    if metafile.exists() {
        if let Ok(content) = std::fs::read_to_string(&metafile) {
            for line in content.lines() {
                if let Some(val) = line.strip_prefix("version:") {
                    return Some(val.trim().to_string());
                }
            }
        }
    }
    // 回退：检测 exe 存在即返回 "未知" 让前端显示
    None
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZCodeSession {
    pub id: String,
    pub title: String,
    pub workspace_path: String,
    pub provider: String,
    pub mode: String,
    pub model: String,
    pub task_status: String,
    pub pinned: bool,
    pub archived: bool,
    pub deleted: bool,
    pub created_at_ms: Option<i64>,
    pub updated_at_ms: Option<i64>,
    pub db_path: String,
}

/// 列出一个 ZCode SQLite 数据库中的所有任务（会话）
pub fn list_zcode_sessions(db_path: &Path) -> anyhow::Result<Vec<ZCodeSession>> {
    if !db_path.exists() {
        return Ok(Vec::new());
    }
    let db = Connection::open(db_path)?;
    // tasks 表结构固定，直接查询
    let sql =
        "SELECT task_id, title, workspace_path, provider, mode, model, task_status, pinned, archived, deleted, created_at, updated_at
         FROM tasks
         WHERE deleted = 0
         ORDER BY COALESCE(updated_at, created_at, 0) DESC, task_id DESC";
    let mut stmt = db.prepare(sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(ZCodeSession {
            id: row.get(0)?,
            title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            workspace_path: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            provider: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            mode: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
            model: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
            task_status: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
            pinned: row.get::<_, Option<i64>>(7)?.unwrap_or_default() != 0,
            archived: row.get::<_, Option<i64>>(8)?.unwrap_or_default() != 0,
            deleted: row.get::<_, Option<i64>>(9)?.unwrap_or_default() != 0,
            created_at_ms: row.get(10)?,
            updated_at_ms: row.get(11)?,
            db_path: db_path.to_string_lossy().to_string(),
        })
    })?;
    let sessions: Vec<ZCodeSession> = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(sessions)
}

/// 删除一个 ZCode 会话（软删除：设置 deleted=1）
pub fn delete_zcode_session(db_path: &Path, task_id: &str, workspace_key: &str) -> anyhow::Result<()> {
    if !db_path.exists() {
        anyhow::bail!("数据库不存在: {}", db_path.to_string_lossy());
    }
    let db = Connection::open(db_path)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let affected = db.execute(
        "UPDATE tasks SET deleted = 1, updated_at = ?1 WHERE task_id = ?2 AND workspace_key = ?3",
        rusqlite::params![now, task_id, workspace_key],
    )?;
    if affected == 0 {
        anyhow::bail!("未找到 task_id={} workspace_key={}", task_id, workspace_key);
    }
    Ok(())
}

/// 获取 ZCode 插件注入状态
pub fn zcode_plugin_injected() -> bool {
    let asar_path = zcode_asar_path();
    if !asar_path.exists() {
        return false;
    }
    // 快速检查：先看是否有 .bak 备份（说明曾经注入过）
    let bak_path = PathBuf::from(format!("{}.bak", asar_path.to_string_lossy()));
    if bak_path.exists() {
        return true;
    }
    // 更精确的检测：检查是否可解压并查看 index.html
    false
}

// ====== ZCode 分身管理 ======

/// ZCode 分身配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZCodeProfile {
    pub id: String,
    pub name: String,
    pub data_dir: String,
    pub created_at_ms: i64,
    pub last_launched_ms: Option<i64>,
}

/// 默认分身 ID
pub const ZCODE_DEFAULT_PROFILE_ID: &str = "default";

/// 分身配置文件路径 (%APPDATA%/LD AI工具/zcode-profiles.json)
pub fn zcode_profiles_path() -> PathBuf {
    let roaming = std::env::var_os("APPDATA")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    roaming.join("LD AI工具").join("zcode-profiles.json")
}

/// 获取用户主目录
fn user_home_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// 获取某个分身的数据目录（绝对路径）
pub fn zcode_profile_data_dir(profile_id: &str) -> PathBuf {
    if profile_id == ZCODE_DEFAULT_PROFILE_ID {
        zcode_home_dir()
    } else {
        user_home_dir().join(format!(".zcode-profile-{}", profile_id))
    }
}

fn create_default_profile() -> ZCodeProfile {
    ZCodeProfile {
        id: ZCODE_DEFAULT_PROFILE_ID.to_string(),
        name: "默认".to_string(),
        data_dir: ".zcode".to_string(),
        created_at_ms: 0,
        last_launched_ms: None,
    }
}

/// 列出所有分身
pub fn list_zcode_profiles() -> Vec<ZCodeProfile> {
    let path = zcode_profiles_path();
    if !path.exists() {
        let default = create_default_profile();
        let _ = save_zcode_profiles(&[default.clone()]);
        return vec![default];
    }
    match std::fs::read_to_string(&path) {
        Ok(content) => {
            serde_json::from_str(&content).unwrap_or_else(|_| vec![create_default_profile()])
        }
        Err(_) => vec![create_default_profile()],
    }
}

/// 保存分身列表
pub fn save_zcode_profiles(profiles: &[ZCodeProfile]) -> std::io::Result<()> {
    let path = zcode_profiles_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(profiles)?;
    std::fs::write(&path, content)
}

/// 生成唯一 ID
fn generate_profile_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("profile-{}", ts)
}

/// 创建新分身
pub fn create_zcode_profile(name: &str) -> anyhow::Result<ZCodeProfile> {
    if name.trim().is_empty() {
        anyhow::bail!("分身名称不能为空");
    }
    let mut profiles = list_zcode_profiles();
    if profiles.iter().any(|p| p.name == name.trim()) {
        anyhow::bail!("分身名称已存在: {}", name);
    }
    let id = generate_profile_id();
    let data_dir = format!(".zcode-profile-{}", &id);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let profile = ZCodeProfile {
        id,
        name: name.trim().to_string(),
        data_dir,
        created_at_ms: now,
        last_launched_ms: None,
    };
    profiles.push(profile.clone());
    save_zcode_profiles(&profiles)?;
    Ok(profile)
}

/// 删除分身（只删除配置记录，不删除数据目录）
pub fn delete_zcode_profile(id: &str) -> anyhow::Result<()> {
    if id == ZCODE_DEFAULT_PROFILE_ID {
        anyhow::bail!("不能删除默认分身");
    }
    let before = list_zcode_profiles();
    let len_before = before.len();
    let profiles: Vec<ZCodeProfile> = before.into_iter().filter(|p| p.id != id).collect();
    if profiles.len() == len_before {
        anyhow::bail!("未找到分身: {}", id);
    }
    save_zcode_profiles(&profiles)?;
    Ok(())
}

/// 更新分身最后启动时间
pub fn touch_zcode_profile(id: &str) -> anyhow::Result<()> {
    let mut profiles = list_zcode_profiles();
    if let Some(profile) = profiles.iter_mut().find(|p| p.id == id) {
        profile.last_launched_ms = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
        );
        save_zcode_profiles(&profiles)?;
        Ok(())
    } else {
        anyhow::bail!("未找到分身: {}", id);
    }
}
