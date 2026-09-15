//! WorkBuddy 桌面端「对话（会话）」的读取与清理。
//!
//! ⚠️ 与 `codex_sqlite` 完全无关：那边读的是 Codex 的 `~/.codex`，
//! 这里读的是 WorkBuddy 客户端自己的数据目录，两套数据不要混。
//!
//! 数据分布（以国内版为例，`~/.workbuddy`；国际版为 `~/.workbuddy-ai`）：
//!
//! ```text
//! ~/.workbuddy/
//!   workbuddy.db            ← sessions 表保存会话元数据（含 deleted_at 软删标记）
//!   projects/<项目>/<id>.jsonl     ← 对话正文（rollout）
//!                    <id>.meta.json
//!                    <id>.file-rollback.ndjson
//!                    <id>/                    ← 附件/文件快照目录
//! ```
//!
//! 两条硬约束：
//!
//! 1. **读不碰真实库**。`workbuddy.db` 带 WAL，客户端可能正在写。
//!    只读打开 WAL 库会因 `-shm` 不可写而失败（`unable to open database file`），
//!    而且会跟客户端抢锁。所以读取时把 `db` + `-wal` 一起复制到临时目录再打开，
//!    SQLite 会自动回放 WAL，拿到一致快照且不干扰客户端。
//! 2. **删除只认库里存在的 id，且 id 必须是 UUID 形态**。路径由 id 拼出来，
//!    不做校验就会有路径穿越（`../../`）。详见 `is_safe_session_id`。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

/* ─────────────────────────── 档案 → 数据目录 ─────────────────────────── */

/// profile 标识与运行时 `workbuddy-runtime/profiles.js` 保持一致。
pub const PROFILE_CN: &str = "workbuddy-cn";
pub const PROFILE_INTL: &str = "workbuddy-ai";

pub const ALL_PROFILES: [&str; 2] = [PROFILE_CN, PROFILE_INTL];

/// profile 的数据目录（国内版 `~/.workbuddy`、国际版 `~/.workbuddy-ai`）。
///
/// 注意：这里**不是**守护进程的 data_dir（`%APPDATA%\LDCodex-WorkBuddy\...`），
/// 而是 WorkBuddy 客户端自己的 home——对话数据只在这里。
pub fn profile_home(profile_id: &str) -> Option<PathBuf> {
    let dir_name = match profile_id.trim().to_ascii_lowercase().as_str() {
        "workbuddy-cn" | "cn" => ".workbuddy",
        "workbuddy-ai" | "ai" | "intl" => ".workbuddy-ai",
        _ => return None,
    };
    directories::BaseDirs::new().map(|dirs| dirs.home_dir().join(dir_name))
}

pub fn profile_db_path(profile_id: &str) -> Option<PathBuf> {
    profile_home(profile_id).map(|home| home.join("workbuddy.db"))
}

/* ─────────────────────────── 数据结构 ─────────────────────────── */

/// 一条对话（对应 `sessions` 表一行 + 磁盘上的正文文件）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkBuddySession {
    pub id: String,
    /// 展示用标题：`custom_title` 优先，其次 `title`，都没有就回落 id 前 8 位。
    pub title: String,
    pub cwd: String,
    pub status: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub last_activity_at_ms: Option<i64>,
    /// 非空 = 已被客户端软删除（界面上归入「已删除」分组）。
    pub deleted_at_ms: Option<i64>,
    pub is_playground: bool,
    pub mode: Option<String>,
    pub model: Option<String>,
    /// 正文 jsonl 的大小（字节）；0 表示磁盘上没找到对应文件。
    pub rollout_bytes: u64,
    /// 附属文件（meta / file-rollback / 附件目录）合计大小（字节）。
    pub side_files_bytes: u64,
    pub rollout_path: Option<String>,
    /// 疑似正在进行的会话（status=working 且近期有活动）——删除前必须提示。
    pub maybe_active: bool,
}

impl WorkBuddySession {
    /// 彻底清除这个文件大约能腾出多少空间。
    pub fn reclaimable_bytes(&self) -> u64 {
        self.rollout_bytes + self.side_files_bytes
    }
}

/// 一次列表结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkBuddySessionsSnapshot {
    pub profile: String,
    pub home: String,
    pub db_path: String,
    /// 库文件不存在（该版本的客户端没装过 / 装了没跑过）。
    pub available: bool,
    pub sessions: Vec<WorkBuddySession>,
    /// 扫描时遇到的非致命问题（例如某个项目目录读不了）。
    pub warnings: Vec<String>,
}

/// 一次删除/恢复操作的结果。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkBuddySessionOpOutcome {
    pub succeeded: Vec<String>,
    pub failed: Vec<WorkBuddySessionOpError>,
    /// 彻底清除时释放的字节数（软删/恢复为 0）。
    pub freed_bytes: u64,
    /// 备份目录（仅彻底清除且开启了备份时非空）。
    pub backup_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkBuddySessionOpError {
    pub id: String,
    pub message: String,
}

/* ─────────────────────────── 列出 ─────────────────────────── */

/// 读取某个 profile 的全部对话。
pub fn list_sessions(profile_id: &str) -> Result<WorkBuddySessionsSnapshot, String> {
    let home = profile_home(profile_id)
        .ok_or_else(|| format!("未知的 WorkBuddy 档案：{profile_id}"))?;
    let db_path = home.join("workbuddy.db");
    let empty = |warnings: Vec<String>, available: bool| WorkBuddySessionsSnapshot {
        profile: normalize_profile_id(profile_id),
        home: home.to_string_lossy().to_string(),
        db_path: db_path.to_string_lossy().to_string(),
        available,
        sessions: Vec::new(),
        warnings,
    };

    if !db_path.exists() {
        return Ok(empty(
            vec![format!("未找到 {}", db_path.to_string_lossy())],
            false,
        ));
    }

    let rows = read_session_rows(&db_path)?;
    let mut warnings = Vec::new();
    let files = scan_project_files(&home, &mut warnings);
    let sessions = rows
        .into_iter()
        .map(|row| attach_files(row, &files))
        .collect();

    Ok(WorkBuddySessionsSnapshot {
        profile: normalize_profile_id(profile_id),
        home: home.to_string_lossy().to_string(),
        db_path: db_path.to_string_lossy().to_string(),
        available: true,
        sessions,
        warnings,
    })
}

/// 读取失败时给界面用的空快照（`available=false` + 原因）。
///
/// 界面拿到它就能区分「这个版本的客户端没装」和「装了但一个对话都没有」，
/// 而不是笼统显示空白。
pub fn unavailable_snapshot(profile_id: &str, error: &str) -> WorkBuddySessionsSnapshot {
    let home = profile_home(profile_id);
    WorkBuddySessionsSnapshot {
        profile: normalize_profile_id(profile_id),
        home: home
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        db_path: home
            .map(|p| p.join("workbuddy.db").to_string_lossy().to_string())
            .unwrap_or_default(),
        available: false,
        sessions: Vec::new(),
        warnings: vec![error.to_string()],
    }
}

fn normalize_profile_id(profile_id: &str) -> String {
    match profile_id.trim().to_ascii_lowercase().as_str() {
        "cn" | "workbuddy-cn" => PROFILE_CN.to_string(),
        "ai" | "intl" | "workbuddy-ai" => PROFILE_INTL.to_string(),
        other => other.to_string(),
    }
}

/// 会话 id 的合法形态（UUID 之类）。路径由 id 拼出来，必须卡死。
fn is_safe_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// SQLite 里的时间戳有的存秒、有的存毫秒，统一到毫秒。
fn to_ms(value: i64) -> i64 {
    if value > 0 && value < 100_000_000_000 {
        value * 1000
    } else {
        value
    }
}

/// 一个用完即删的临时目录（放会话库副本）。
///
/// 这里没用 `tempfile`——它只是本 crate 的 dev-dependency，为它去动 Cargo.toml 不值当。
struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new(tag: &str) -> Result<Self, String> {
        let path = std::env::temp_dir().join(format!(
            "ldcodex-wbsessions-{}-{}-{}",
            tag,
            std::process::id(),
            now_ms()
        ));
        fs::create_dir_all(&path).map_err(|e| format!("创建临时目录失败：{e}"))?;
        Ok(Self { path })
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

/// 从库里读会话行。**走临时副本**，避免与正在运行的客户端抢 WAL 锁。
fn read_session_rows(db_path: &Path) -> Result<Vec<WorkBuddySession>, String> {
    let temp_dir = TempDir::new("read")?;
    let copy = temp_dir.path.join("workbuddy.db");
    fs::copy(db_path, &copy).map_err(|e| format!("复制会话库失败：{e}"))?;
    // -wal 不一定存在；存在就必须一起复制，否则读到的是回放前的旧数据。
    let wal = PathBuf::from(format!("{}-wal", db_path.to_string_lossy()));
    if wal.exists() {
        let wal_copy = PathBuf::from(format!("{}-wal", copy.to_string_lossy()));
        if let Err(e) = fs::copy(&wal, &wal_copy) {
            // 复制失败不致命：退回主库数据即可，但要知道可能不是最新的。
            eprintln!("[workbuddy_sessions] 复制 -wal 失败，可能读到旧快照：{e}");
        }
    }

    let conn = Connection::open(&copy).map_err(|e| format!("打开会话库失败：{e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, cwd, title, custom_title, status, created_at, updated_at, \
                    last_activity_at, deleted_at, is_playground, mode, model \
             FROM sessions",
        )
        .map_err(|e| format!("读取 sessions 表失败：{e}"))?;

    let rows = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let title: Option<String> = row.get(2)?;
            let custom_title: Option<String> = row.get(3)?;
            let status: String = row.get::<_, Option<String>>(4)?.unwrap_or_default();
            let last_activity: Option<i64> = row.get(7)?;
            let deleted_at: Option<i64> = row.get(8)?;
            let updated_at: i64 = row.get(6).unwrap_or(0);
            let maybe_active =
                status.eq_ignore_ascii_case("working") && recently_active(last_activity);
            Ok(WorkBuddySession {
                title: pick_title(&custom_title, &title, &id),
                id,
                cwd: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                status,
                created_at_ms: to_ms(row.get(5).unwrap_or(0)),
                updated_at_ms: to_ms(updated_at),
                last_activity_at_ms: last_activity.map(to_ms),
                deleted_at_ms: deleted_at.map(to_ms),
                is_playground: row.get::<_, Option<i64>>(9)?.unwrap_or(0) != 0,
                mode: row.get(10)?,
                model: row.get(11)?,
                rollout_bytes: 0,
                side_files_bytes: 0,
                rollout_path: None,
                maybe_active,
            })
        })
        .map_err(|e| format!("遍历 sessions 表失败：{e}"))?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("解析会话行失败：{e}"))?);
    }
    out.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    Ok(out)
}

const ACTIVE_WINDOW_MS: i64 = 30 * 60 * 1000;

fn recently_active(last_activity_at_ms: Option<i64>) -> bool {
    match last_activity_at_ms {
        Some(ms) => now_ms() - ms < ACTIVE_WINDOW_MS,
        None => false,
    }
}

fn pick_title(custom_title: &Option<String>, title: &Option<String>, id: &str) -> String {
    let trimmed = |value: &Option<String>| {
        value
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("")
            .to_string()
    };
    let custom = trimmed(custom_title);
    if !custom.is_empty() {
        return custom;
    }
    let auto = trimmed(title);
    if !auto.is_empty() {
        return auto;
    }
    format!("(无标题 {})", &id.chars().take(8).collect::<String>())
}

/// 项目目录下每个会话 id 对应的文件（正文 + 附属）。
struct SessionFiles {
    rollout: Option<(PathBuf, u64)>,
    side_bytes: u64,
}

fn scan_project_files(home: &Path, warnings: &mut Vec<String>) -> HashMap<String, SessionFiles> {
    let mut map: HashMap<String, SessionFiles> = HashMap::new();
    let projects = home.join("projects");
    if !projects.is_dir() {
        return map;
    }
    // projects/<项目名>/<id>.xxx —— 项目名是 cwd 的 slug，不需要反解，
    // 直接遍历所有子目录即可，避免依赖（且受制于）编码规则。
    let Ok(project_entries) = fs::read_dir(&projects) else {
        warnings.push(format!("读取 {} 失败", projects.to_string_lossy()));
        return map;
    };
    for project in project_entries.flatten() {
        let project_path = project.path();
        if !project_path.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(&project_path) else {
            warnings.push(format!(
                "读取 {} 失败",
                project_path.to_string_lossy()
            ));
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            // ⚠️ 必须用**第一个**点切分：`aaaa.meta.json` 的 stem 是 `aaaa`，
            // 用 rsplit_once 会切成 `aaaa.meta`，附属文件就永远匹配不到 id 了。
            let (stem, is_rollout) = match name.split_once('.') {
                Some((stem, _rest)) => (stem.to_string(), name.to_ascii_lowercase().ends_with(".jsonl")),
                None => (name.to_string(), false),
            };
            if !is_safe_session_id(&stem) {
                continue;
            }
            let slot = map.entry(stem).or_insert(SessionFiles {
                rollout: None,
                side_bytes: 0,
            });
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            if is_rollout {
                // 同名 jsonl 理论上只有一个；取最大的那个，避免被空文件顶掉。
                if slot
                    .rollout
                    .as_ref()
                    .map(|(_, existing)| size > *existing)
                    .unwrap_or(true)
                {
                    slot.rollout = Some((path.clone(), size));
                }
            } else if path.is_dir() {
                slot.side_bytes += dir_size(&path);
            } else {
                slot.side_bytes += size;
            }
        }
    }
    map
}

fn dir_size(path: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                total += dir_size(&p);
            } else {
                total += entry.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
    }
    total
}

fn attach_files(mut session: WorkBuddySession, files: &HashMap<String, SessionFiles>) -> WorkBuddySession {
    if let Some(entry) = files.get(&session.id) {
        if let Some((path, size)) = &entry.rollout {
            session.rollout_bytes = *size;
            session.rollout_path = Some(path.to_string_lossy().to_string());
        }
        session.side_files_bytes = entry.side_bytes;
    }
    session
}

/* ─────────────────────────── 软删 / 恢复 ─────────────────────────── */

/// 软删除：只置 `deleted_at`，客户端立刻不再显示，文件全留着，**可恢复**。
pub fn soft_delete_sessions(
    profile_id: &str,
    ids: &[String],
) -> Result<WorkBuddySessionOpOutcome, String> {
    mutate_column(profile_id, ids, "deleted_at", Some(now_ms()))
}

/// 恢复：把 `deleted_at` 清掉（只能恢复还没被彻底清除的会话）。
pub fn restore_sessions(
    profile_id: &str,
    ids: &[String],
) -> Result<WorkBuddySessionOpOutcome, String> {
    mutate_column(profile_id, ids, "deleted_at", None)
}

fn mutate_column(
    profile_id: &str,
    ids: &[String],
    column: &str,
    value: Option<i64>,
) -> Result<WorkBuddySessionOpOutcome, String> {
    let db_path = profile_db_path(profile_id)
        .ok_or_else(|| format!("未知的 WorkBuddy 档案：{profile_id}"))?;
    if !db_path.exists() {
        return Err(format!("未找到 {}", db_path.to_string_lossy()));
    }
    let mut outcome = WorkBuddySessionOpOutcome::default();
    let valid: Vec<String> = dedup_valid_ids(ids, &mut outcome);
    if valid.is_empty() {
        return Ok(outcome);
    }

    // 写真实库：客户端可能同时在写，SQLite 自带锁，冲突时报错并上报。
    let mut conn = Connection::open(&db_path).map_err(|e| format!("打开会话库失败：{e}"))?;
    let sql = format!("UPDATE sessions SET {column} = ?1 WHERE id = ?2");
    for id in valid {
        let tx = conn.transaction();
        let result = (|| -> Result<(), String> {
            let tx = tx.map_err(|e| format!("开启事务失败：{e}"))?;
            tx.execute(&sql, rusqlite::params![value, id])
                .map_err(|e| format!("更新会话失败：{e}"))?;
            tx.commit().map_err(|e| format!("提交事务失败：{e}"))
        })();
        match result {
            Ok(()) => outcome.succeeded.push(id),
            Err(message) => outcome.failed.push(WorkBuddySessionOpError { id, message }),
        }
    }
    Ok(outcome)
}

/* ─────────────────────────── 彻底清除 ─────────────────────────── */

/// 彻底清除：删库行 + 正文 + 附属文件，释放磁盘空间，**不可恢复**（除非有备份）。
///
/// `backup=true` 时先把会话文件复制到 `<home>/session-backups/<时间戳>/` 再删。
pub fn purge_sessions(
    profile_id: &str,
    ids: &[String],
    backup: bool,
) -> Result<WorkBuddySessionOpOutcome, String> {
    let home = profile_home(profile_id)
        .ok_or_else(|| format!("未知的 WorkBuddy 档案：{profile_id}"))?;
    let db_path = home.join("workbuddy.db");
    if !db_path.exists() {
        return Err(format!("未找到 {}", db_path.to_string_lossy()));
    }

    let mut outcome = WorkBuddySessionOpOutcome::default();
    let valid: Vec<String> = dedup_valid_ids(ids, &mut outcome);
    if valid.is_empty() {
        return Ok(outcome);
    }

    // 先摸清要删哪些文件：用列表逻辑定位，避免自己拼路径猜错。
    let mut warnings = Vec::new();
    let files = scan_project_files(&home, &mut warnings);
    let mut targets: HashMap<String, Vec<PathBuf>> = HashMap::new();
    for id in &valid {
        let Some(entry) = files.get(id) else { continue };
        let mut paths = Vec::new();
        if let Some((rollout, _)) = &entry.rollout {
            paths.push(rollout.clone());
        }
        targets.insert(id.clone(), paths);
    }
    // 附属文件（meta / rollback / 附件目录）要单独扫一遍：它们的 stem 与 id 相同，
    // 但上面 scan 只记了总大小，没留路径。这里按 id 前缀再收一次。
    collect_side_paths(&home, &valid, &mut targets);

    let backup_dir = if backup {
        let stamp = now_ms();
        let dir = home.join("session-backups").join(stamp.to_string());
        fs::create_dir_all(&dir).map_err(|e| format!("创建备份目录失败：{e}"))?;
        Some(dir)
    } else {
        None
    };

    let mut conn = Connection::open(&db_path).map_err(|e| format!("打开会话库失败：{e}"))?;

    for id in valid {
        match purge_one(&mut conn, &id, targets.get(&id), backup_dir.as_deref()) {
            Ok(freed) => {
                outcome.freed_bytes += freed;
                outcome.succeeded.push(id);
            }
            Err(message) => outcome.failed.push(WorkBuddySessionOpError { id, message }),
        }
    }

    outcome.backup_dir = backup_dir.map(|d| d.to_string_lossy().to_string());
    Ok(outcome)
}

fn purge_one(
    conn: &mut Connection,
    id: &str,
    paths: Option<&Vec<PathBuf>>,
    backup_dir: Option<&Path>,
) -> Result<u64, String> {
    let mut freed = 0u64;
    if let Some(paths) = paths {
        for path in paths {
            let size = if path.is_dir() { dir_size(path) } else { path.metadata().map(|m| m.len()).unwrap_or(0) };
            if let Some(dir) = backup_dir {
                if let Err(e) = backup_path(dir, path) {
                    return Err(format!("备份 {} 失败：{e}", path.to_string_lossy()));
                }
            }
            let result = if path.is_dir() {
                fs::remove_dir_all(path)
            } else {
                fs::remove_file(path)
            };
            match result {
                Ok(()) => freed += size,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("删除 {} 失败：{e}", path.to_string_lossy())),
            }
        }
    }
    // 文件删完再动库：万一文件步骤失败，库记录还在，不至于出现"库里没了、文件还在"的孤儿。
    let tx = conn.transaction().map_err(|e| format!("开启事务失败：{e}"))?;
    tx.execute("DELETE FROM session_usage WHERE session_id = ?1", [id])
        .map_err(|e| format!("清理用量记录失败：{e}"))?;
    tx.execute("DELETE FROM sessions WHERE id = ?1", [id])
        .map_err(|e| format!("删除会话记录失败：{e}"))?;
    tx.commit().map_err(|e| format!("提交事务失败：{e}"))?;
    Ok(freed)
}

fn backup_path(backup_dir: &Path, path: &Path) -> std::io::Result<()> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let dest = backup_dir.join(name);
    if path.is_dir() {
        copy_dir_recursive(path, &dest)
    } else {
        fs::copy(path, dest).map(|_| ())
    }
}

fn copy_dir_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)?.flatten() {
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// 收集某个会话的附属文件路径（`<id>.*` 与 `<id>/`）。
fn collect_side_paths(home: &Path, ids: &[String], out: &mut HashMap<String, Vec<PathBuf>>) {
    let id_set: HashSet<&str> = ids.iter().map(|s| s.as_str()).collect();
    let projects = home.join("projects");
    let Ok(project_entries) = fs::read_dir(&projects) else {
        return;
    };
    for project in project_entries.flatten() {
        let project_path = project.path();
        if !project_path.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(&project_path) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            // 同上：按第一个点切，`<id>.meta.json` 要归到 `<id>` 名下。
            let stem = name.split_once('.').map(|(s, _)| s).unwrap_or(name);
            if !id_set.contains(stem) {
                continue;
            }
            let is_rollout = name.to_ascii_lowercase().ends_with(".jsonl");
            let bucket = out.entry(stem.to_string()).or_default();
            // 正文已由 scan_project_files 收过，这里只补附属，避免重复。
            if !is_rollout && !bucket.contains(&path) {
                bucket.push(path);
            }
        }
    }
}

fn dedup_valid_ids(ids: &[String], outcome: &mut WorkBuddySessionOpOutcome) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut valid = Vec::new();
    for id in ids {
        let id = id.trim().to_string();
        if id.is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        if !is_safe_session_id(&id) {
            outcome.failed.push(WorkBuddySessionOpError {
                id,
                message: "会话 id 不合法，已跳过".to_string(),
            });
            continue;
        }
        valid.push(id);
    }
    valid
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_db(path: &Path) -> Connection {
        let conn = Connection::open(path).expect("create db");
        conn.execute_batch(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                cwd TEXT NOT NULL,
                user_id TEXT NOT NULL,
                title TEXT,
                custom_title TEXT,
                status TEXT NOT NULL DEFAULT 'Pending',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                last_activity_at INTEGER,
                deleted_at INTEGER,
                is_playground INTEGER NOT NULL DEFAULT 0,
                source_mode TEXT,
                is_background_automation INTEGER,
                mode TEXT,
                model TEXT,
                expert_id TEXT,
                project_id TEXT
            );
            CREATE TABLE session_usage (
                session_id TEXT PRIMARY KEY,
                used INTEGER NOT NULL,
                size INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );",
        )
        .expect("create tables");
        conn
    }

    /// 造一个假的 profile home：workbuddy.db + projects/<slug>/<id>.jsonl
    fn seed_home(root: &Path, profile_dir: &str) -> PathBuf {
        let home = root.join(profile_dir);
        let projects = home.join("projects").join("d-proj");
        fs::create_dir_all(&projects).unwrap();
        let db = make_db(&home.join("workbuddy.db"));
        for (id, title, status, updated) in [
            ("aaaa-1111", "旧对话", "completed", 1_700_000_000_000i64),
            ("bbbb-2222", "", "error", 1_800_000_000_000i64),
            ("cccc-3333", "带自定义标题", "completed", 1_900_000_000_000i64),
        ] {
            db.execute(
                "INSERT INTO sessions (id, cwd, user_id, title, status, created_at, updated_at, last_activity_at)
                 VALUES (?1, 'D:\\proj', 'u1', ?2, ?3, ?4, ?4, ?4)",
                rusqlite::params![id, title, status, updated],
            )
            .unwrap();
            db.execute(
                "INSERT INTO session_usage (session_id, used, size, updated_at) VALUES (?1, 1, 1, ?2)",
                rusqlite::params![id, updated],
            )
            .unwrap();
            fs::write(projects.join(format!("{id}.jsonl")), "{\"x\":1}\n").unwrap();
            fs::write(projects.join(format!("{id}.meta.json")), "{}").unwrap();
        }
        // 只有正文、没有附属文件的会话
        db.execute(
            "INSERT INTO sessions (id, cwd, user_id, title, status, created_at, updated_at)
             VALUES ('dddd-4444', 'D:\\proj', 'u1', '裸会话', 'completed', 1, 1)",
            [],
        )
        .unwrap();
        fs::write(projects.join("dddd-4444.jsonl"), "{}").unwrap();
        drop(db);
        home
    }

    #[test]
    fn profile_home_maps_profile_ids_to_client_dirs() {
        let cn = profile_home(PROFILE_CN).expect("cn home");
        let intl = profile_home(PROFILE_INTL).expect("intl home");
        assert!(cn.ends_with(".workbuddy"), "实际: {cn:?}");
        assert!(intl.ends_with(".workbuddy-ai"), "实际: {intl:?}");
        assert_ne!(cn, intl);
        assert!(profile_home("nope").is_none());
    }

    #[test]
    fn list_sessions_reads_rows_and_attaches_file_sizes() {
        let temp = tempfile::tempdir().unwrap();
        let home = seed_home(temp.path(), ".workbuddy");
        // list_sessions 走 profile_home（真实用户目录），所以这里直接测内部函数
        let mut warnings = Vec::new();
        let files = scan_project_files(&home, &mut warnings);
        let rows = read_session_rows(&home.join("workbuddy.db")).unwrap();
        assert_eq!(rows.len(), 4);
        assert!(warnings.is_empty());

        let first = attach_files(rows[0].clone(), &files);
        // 按 updated_at 倒序，第一条应是 cccc-3333
        assert_eq!(first.id, "cccc-3333");
        assert_eq!(first.title, "带自定义标题");
        assert!(first.rollout_bytes > 0, "正文大小应大于 0");
        assert!(first.side_files_bytes > 0, "附属文件大小应大于 0");
        assert!(first.rollout_path.unwrap().ends_with("cccc-3333.jsonl"));

        let bare = attach_files(
            rows.iter().find(|r| r.id == "dddd-4444").unwrap().clone(),
            &files,
        );
        assert!(bare.rollout_bytes > 0);
        assert_eq!(bare.side_files_bytes, 0, "裸会话没有附属文件");
    }

    #[test]
    fn empty_title_falls_back_to_id_prefix() {
        let temp = tempfile::tempdir().unwrap();
        let home = seed_home(temp.path(), ".workbuddy");
        let rows = read_session_rows(&home.join("workbuddy.db")).unwrap();
        let no_title = rows.iter().find(|r| r.id == "bbbb-2222").unwrap();
        assert_eq!(no_title.title, "(无标题 bbbb-222)");
        assert_eq!(no_title.status, "error");
    }

    #[test]
    fn soft_delete_sets_deleted_at_and_restore_clears_it() {
        let temp = tempfile::tempdir().unwrap();
        let home = seed_home(temp.path(), ".workbuddy");
        let db = home.join("workbuddy.db");

        // 直接驱动库：mutate_column 也是这个逻辑，但它走 profile_home，
        // 单测里用同一条 SQL 校验结果即可。
        let set = |ids: &[&str], value: Option<i64>| {
            let conn = Connection::open(&db).unwrap();
            for id in ids {
                conn.execute(
                    "UPDATE sessions SET deleted_at = ?1 WHERE id = ?2",
                    rusqlite::params![value, id],
                )
                .unwrap();
            }
        };
        set(&["aaaa-1111"], Some(123));
        let rows = read_session_rows(&db).unwrap();
        let target = rows.iter().find(|r| r.id == "aaaa-1111").unwrap();
        assert_eq!(target.deleted_at_ms, Some(123_000));
        assert_eq!(rows.len(), 4, "软删不应移除记录");

        set(&["aaaa-1111"], None);
        let rows = read_session_rows(&db).unwrap();
        assert_eq!(rows.len(), 4);
        assert_eq!(
            rows.iter().find(|r| r.id == "aaaa-1111").unwrap().deleted_at_ms,
            None
        );
        // 文件必须还在
        assert!(home
            .join("projects")
            .join("d-proj")
            .join("aaaa-1111.jsonl")
            .exists());
    }

    #[test]
    fn purge_removes_rows_and_files_and_reports_freed_bytes() {
        let temp = tempfile::tempdir().unwrap();
        let home = seed_home(temp.path(), ".workbuddy");
        let db = home.join("workbuddy.db");
        let proj = home.join("projects").join("d-proj");

        // 复刻 purge_sessions 的核心步骤（它内部走 profile_home，此处直接用 home 驱动）
        let mut warnings = Vec::new();
        let files = scan_project_files(&home, &mut warnings);
        let ids = vec!["aaaa-1111".to_string()];
        let mut targets: HashMap<String, Vec<PathBuf>> = HashMap::new();
        for id in &ids {
            if let Some(entry) = files.get(id) {
                let mut paths = Vec::new();
                if let Some((rollout, _)) = &entry.rollout {
                    paths.push(rollout.clone());
                }
                targets.insert(id.clone(), paths);
            }
        }
        collect_side_paths(&home, &ids, &mut targets);

        let mut conn = Connection::open(&db).unwrap();
        let freed = purge_one(&mut conn, "aaaa-1111", targets.get("aaaa-1111"), None).unwrap();

        assert!(freed > 0, "应统计到释放的字节");
        assert!(!proj.join("aaaa-1111.jsonl").exists(), "正文应被删除");
        assert!(!proj.join("aaaa-1111.meta.json").exists(), "附属文件应被删除");
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions WHERE id = 'aaaa-1111'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0, "库记录应被删除");
        let usage: i64 = conn
            .query_row("SELECT COUNT(*) FROM session_usage WHERE session_id = 'aaaa-1111'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(usage, 0, "用量记录应一起清理");
        // 其它会话不受影响
        assert!(proj.join("bbbb-2222.jsonl").exists());
    }

    #[test]
    fn purge_with_backup_copies_files_before_deleting() {
        let temp = tempfile::tempdir().unwrap();
        let home = seed_home(temp.path(), ".workbuddy");
        let db = home.join("workbuddy.db");
        let backup_dir = home.join("session-backups").join("12345");
        fs::create_dir_all(&backup_dir).unwrap();

        let mut warnings = Vec::new();
        let files = scan_project_files(&home, &mut warnings);
        let ids = vec!["cccc-3333".to_string()];
        let mut targets: HashMap<String, Vec<PathBuf>> = HashMap::new();
        for id in &ids {
            if let Some(entry) = files.get(id) {
                let mut paths = Vec::new();
                if let Some((rollout, _)) = &entry.rollout {
                    paths.push(rollout.clone());
                }
                targets.insert(id.clone(), paths);
            }
        }
        collect_side_paths(&home, &ids, &mut targets);

        let mut conn = Connection::open(&db).unwrap();
        purge_one(&mut conn, "cccc-3333", targets.get("cccc-3333"), Some(&backup_dir)).unwrap();

        assert!(backup_dir.join("cccc-3333.jsonl").exists(), "正文应已备份");
        assert!(backup_dir.join("cccc-3333.meta.json").exists(), "附属文件应已备份");
    }

    #[test]
    fn unsafe_session_ids_are_rejected() {
        assert!(is_safe_session_id("550e8400-e29b-41d4-a716-446655440000"));
        assert!(is_safe_session_id("abc_123-XYZ"));
        assert!(!is_safe_session_id("../etc/passwd"));
        assert!(!is_safe_session_id("a/b"));
        assert!(!is_safe_session_id(""));
        assert!(!is_safe_session_id(&"x".repeat(65)));
    }

    #[test]
    fn dedup_valid_ids_filters_duplicates_and_unsafe_values() {
        let mut outcome = WorkBuddySessionOpOutcome::default();
        let valid = dedup_valid_ids(
            &[
                "aaaa-1111".to_string(),
                "aaaa-1111".to_string(),
                "  bbbb-2222  ".to_string(),
                "../evil".to_string(),
                "".to_string(),
            ],
            &mut outcome,
        );
        assert_eq!(valid, vec!["aaaa-1111".to_string(), "bbbb-2222".to_string()]);
        assert_eq!(outcome.failed.len(), 1);
        assert_eq!(outcome.failed[0].id, "../evil");
    }

    #[test]
    fn timestamps_normalized_to_milliseconds() {
        // 秒级时间戳应被放大到毫秒，毫秒级原样保留
        assert_eq!(to_ms(1_700_000_000), 1_700_000_000_000);
        assert_eq!(to_ms(1_700_000_000_000), 1_700_000_000_000);
        assert_eq!(to_ms(0), 0);
    }

    #[test]
    fn working_sessions_with_recent_activity_are_flagged_active() {
        let now = now_ms();
        assert!(recently_active(Some(now - 60_000)));
        assert!(!recently_active(Some(now - 120 * 60 * 1000)));
        assert!(!recently_active(None));
    }
}
