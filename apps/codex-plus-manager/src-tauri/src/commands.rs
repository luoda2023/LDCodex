use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use codex_plus_core::install::SILENT_BINARY;
use codex_plus_core::models::{DeleteResult, SessionRef};
use codex_plus_core::script_market::{self, MarketScript, ScriptMarketManifest};
use codex_plus_core::settings::{BackendSettings, RelayProfile, SettingsStore};
use codex_plus_core::status::{LaunchStatus, StatusStore};
use codex_plus_core::user_scripts::UserScriptManager;
use codex_plus_core::zed_remote::{ZedOpenStrategy, ZedRemoteProject};
use serde::Serialize;
use serde_json::{Value, json};

use crate::install::{self, InstallActionResult, InstallOptions};

#[derive(Debug, Clone, Serialize)]
pub struct CommandResult<T>
where
    T: Serialize,
{
    pub status: String,
    pub message: String,
    #[serde(flatten)]
    pub payload: T,
}

#[derive(Debug, Clone, Serialize)]
pub struct VersionPayload {
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PathState {
    pub status: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OverviewPayload {

    
    pub silent_shortcut: PathState,
    pub management_shortcut: PathState,
    pub latest_launch: Option<LaunchStatus>,
    pub current_version: String,
    pub update_status: String,
    pub settings_path: String,
    pub logs_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SettingsPayload {
    pub settings: BackendSettings,
    pub settings_path: String,
    pub user_scripts: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSessionsPayload {
    pub db_path: String,
    pub db_paths: Vec<String>,
    pub sessions: Vec<codex_plus_data::LocalSession>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZedRemoteProjectsPayload {
    pub projects: Vec<ZedRemoteProject>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZedRemoteOpenPayload {
    pub url: String,
    pub strategy: ZedOpenStrategy,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteLocalSessionRequest {
    pub session_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub db_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayPayload {
    pub authenticated: bool,
    pub auth_source: String,
    pub account_label: Option<String>,
    pub config_path: String,
    pub configured: bool,
    pub requires_openai_auth: bool,
    pub has_bearer_token: bool,
    pub backup_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayFilesPayload {
    pub config_path: String,
    pub auth_path: String,
    pub config_contents: String,
    pub auth_contents: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelaySwitchPayload {
    pub settings: BackendSettings,
    pub relay: RelayPayload,
    pub settings_path: String,
    pub user_scripts: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsBackfillPayload {
    pub settings: BackendSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextEntriesPayload {
    pub settings: BackendSettings,
    pub entries: codex_plus_core::relay_config::CodexContextEntries,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveContextEntriesPayload {
    pub entries: codex_plus_core::relay_config::CodexContextEntries,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractRelayCommonConfigPayload {
    pub common_config_contents: String,
    pub profile_config_contents: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayProfileTestPayload {
    pub http_status: u16,
    pub endpoint: String,
    pub response_preview: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayProfileModelsPayload {
    pub models: Vec<String>,
    pub endpoint: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRelayFileRequest {
    pub kind: String,
    pub contents: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackfillRelayProfileRequest {
    pub settings: BackendSettings,
    pub profile_id: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSettingsRequest {
    pub settings: BackendSettings,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextEntryRequest {
    pub settings: BackendSettings,
    pub kind: String,
    pub id: String,
    pub toml_body: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextDeleteRequest {
    pub settings: BackendSettings,
    pub kind: String,
    pub id: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractRelayCommonConfigRequest {
    pub config_contents: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    #[serde(default)]
    pub app_path: String,
    #[serde(default = "default_debug_port")]
    pub debug_port: u16,
    #[serde(default = "default_helper_port")]
    pub helper_port: u16,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogRequest {
    #[serde(default = "default_log_lines")]
    pub lines: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogsPayload {
    pub path: String,
    pub text: String,
    pub lines: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticsPayload {
    pub report: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WatcherPayload {
    pub enabled: bool,
    pub disabled_flag: String,
}



#[derive(Debug, Clone, Serialize)]
pub struct ScriptMarketPayload {
    pub market: Value,
    pub user_scripts: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupPayload {
    pub show_update: bool,
}

#[tauri::command]
pub fn backend_version() -> CommandResult<VersionPayload> {
    ok(
        "鍚庣鐗堟湰宸茶鍙栥€?,
        VersionPayload {
            version: codex_plus_core::version::VERSION.to_string(),
        },
    )
}

#[tauri::command]
pub fn startup_options() -> CommandResult<StartupPayload> {
    ok(
        "鍚姩鍙傛暟宸茶鍙栥€?,
        StartupPayload {
            show_update: startup_should_show_update(),
        },
    )
}

pub fn startup_should_show_update() -> bool {
    should_show_update(
        std::env::args(),
        std::env::var("CODEX_PLUS_SHOW_UPDATE").ok().as_deref(),
    )
}

fn should_show_update<I, S>(args: I, env_value: Option<&str>) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().any(|arg| arg.as_ref() == "--show-update") || env_value == Some("1")
}


fn load_overview_sync() -> CommandResult<OverviewPayload> {
    let (codex_app_path, entrypoints, latest_launch) = load_overview_payload();
    ok(
        "姒傝宸插姞杞姐€?,
        OverviewPayload {

            codex_app: path_state(codex_app_path),
            silent_shortcut: shortcut_state(entrypoints.silent_shortcut),
            management_shortcut: shortcut_state(entrypoints.management_shortcut),
            latest_launch,
            current_version: codex_plus_core::version::VERSION.to_string(),
            update_status: "not_checked".to_string(),
            settings_path: codex_plus_core::paths::default_settings_path()
                .to_string_lossy()
                .to_string(),
            logs_path: codex_plus_core::paths::default_diagnostic_log_path()
                .to_string_lossy()
                .to_string(),
        },
    )
}

#[tauri::command]
pub async fn load_overview() -> CommandResult<OverviewPayload> {
    let payload = tauri::async_runtime::spawn_blocking(load_overview_payload).await;
    let Ok((codex_app_path, entrypoints, latest_launch)) = payload else {
        return failed(
            "姒傝鍚庡彴浠诲姟澶辫触銆?,
            OverviewPayload {

                management_shortcut: path_state(None),
                latest_launch: None,
                current_version: codex_plus_core::version::VERSION.to_string(),
                update_status: "not_checked".to_string(),
                settings_path: codex_plus_core::paths::default_settings_path()
                    .to_string_lossy()
                    .to_string(),
                logs_path: codex_plus_core::paths::default_diagnostic_log_path()
                    .to_string_lossy()
                    .to_string(),
            },
        );
    };
    ok(
        "姒傝宸插姞杞姐€?,
        OverviewPayload {

            silent_shortcut: shortcut_state(entrypoints.silent_shortcut),
            management_shortcut: shortcut_state(entrypoints.management_shortcut),
            latest_launch,
            current_version: codex_plus_core::version::VERSION.to_string(),
            update_status: "not_checked".to_string(),
            settings_path: codex_plus_core::paths::default_settings_path()
                .to_string_lossy()
                .to_string(),
            logs_path: codex_plus_core::paths::default_diagnostic_log_path()
                .to_string_lossy()
                .to_string(),
        },
    )
}

#[tauri::command]
pub fn launch_codex_plus(request: LaunchRequest) -> CommandResult<Value> {
    spawn_codex_plus_launch(request, "鍚姩浠诲姟宸插湪鍚庡彴寮€濮嬶紝鍙◢鍚庢煡鐪嬫瑙堢姸鎬併€?)
}

#[tauri::command]
pub fn restart_codex_plus(request: LaunchRequest) -> CommandResult<Value> {
    codex_plus_core::watcher::stop_launcher_processes();
    codex_plus_core::watcher::stop_codex_processes();
    spawn_codex_plus_launch(request, "Codex 宸茶姹傞噸鍚紝鍚姩浠诲姟姝ｅ湪鍚庡彴杩愯銆?)
}

fn spawn_codex_plus_launch(request: LaunchRequest, accepted_message: &str) -> CommandResult<Value> {
    let debug_port = request.debug_port;
    let helper_port = request.helper_port;
    let _ = codex_plus_core::diagnostic_log::append_diagnostic_log(
        "manager.launch_requested",
        json!({
            "debug_port": debug_port,
            "helper_port": helper_port,
            "app_path": request.app_path.trim()
        }),
    );
    match spawn_silent_launcher(&request) {
        Ok(()) => CommandResult {
            status: "accepted".to_string(),
            message: accepted_message.to_string(),
            payload: json!({
                "debugPort": debug_port,
                "helperPort": helper_port
            }),
        },
        Err(error) => failed(
            &format!("鍚姩闈欓粯鍏ュ彛澶辫触锛歿error}"),
            json!({
                "debugPort": debug_port,
                "helperPort": helper_port
            }),
        ),
    }
}

fn spawn_silent_launcher(request: &LaunchRequest) -> anyhow::Result<()> {
    let launcher = codex_plus_core::install::companion_binary_path(SILENT_BINARY);
    let mut command = std::process::Command::new(&launcher);
    if !request.app_path.trim().is_empty() {
        command.arg("--app-path").arg(request.app_path.trim());
    }
    command
        .arg("--debug-port")
        .arg(request.debug_port.to_string())
        .arg("--helper-port")
        .arg(request.helper_port.to_string());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| anyhow::anyhow!("鏃犳硶鍚姩 {}锛歿error}", launcher.to_string_lossy()))
}

#[tauri::command]
pub fn load_settings() -> CommandResult<SettingsPayload> {
    settings_payload("璁剧疆宸插姞杞姐€?, "璁剧疆璇诲彇澶辫触")
}

#[tauri::command]
pub fn save_settings(settings: BackendSettings) -> CommandResult<SettingsPayload> {
    let settings = normalize_settings_before_save(settings);
    match SettingsStore::default().save(&settings) {
        Ok(()) => {
            let wrapper_message = refresh_cli_wrapper_after_settings_save(&settings);
            settings_payload(
                &format!("璁剧疆宸蹭繚瀛樸€倇wrapper_message}"),
                "璁剧疆淇濆瓨鍚庨噸鏂拌鍙栧け璐?,
            )
        }
        Err(error) => failed(
            &format!("淇濆瓨璁剧疆澶辫触锛歿error}"),
            SettingsPayload {
                settings,
                settings_path: codex_plus_core::paths::default_settings_path()
                    .to_string_lossy()
                    .to_string(),
                user_scripts: user_script_inventory(),
            },
        ),
    }
}

#[tauri::command]
pub fn list_local_sessions() -> CommandResult<LocalSessionsPayload> {
    let home = codex_plus_core::codex_sqlite::default_codex_home_dir();
    let db_paths = codex_plus_core::codex_sqlite::codex_session_db_paths_from_home(&home);
    let mut sessions = Vec::new();
    let mut errors = Vec::new();
    for db_path in &db_paths {
        let adapter = local_session_adapter(db_path);
        match adapter.list_local_sessions() {
            Ok(mut items) => sessions.append(&mut items),
            Err(error) if db_path.exists() => {
                errors.push(format!("{}: {error}", db_path.to_string_lossy()));
            }
            Err(_) => {}
        }
    }
    sessions.sort_by(|left, right| {
        right
            .updated_at_ms
            .cmp(&left.updated_at_ms)
            .then_with(|| right.id.cmp(&left.id))
    });
    let mut seen_session_ids = std::collections::HashSet::new();
    sessions.retain(|session| seen_session_ids.insert(session.id.clone()));
    let payload = LocalSessionsPayload {
        db_path: db_paths
            .first()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        db_paths: db_paths
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect(),
        sessions,
    };
    if errors.is_empty() {
        ok(
            &format!("宸茶鍙?{} 涓湰鍦颁細璇濄€?, payload.sessions.len()),
            payload,
        )
    } else {
        failed(
            &format!("璇诲彇閮ㄥ垎鏈湴浼氳瘽澶辫触锛歿}", errors.join("; ")),
            payload,
        )
    }
}

#[tauri::command]
pub fn list_zed_remote_projects() -> CommandResult<ZedRemoteProjectsPayload> {
    let result = codex_plus_core::zed_remote::list_zed_remote_projects_response(&json!({}));
    if result.get("status").and_then(Value::as_str) == Some("ok") {
        let projects = serde_json::from_value::<Vec<ZedRemoteProject>>(
            result
                .get("projects")
                .cloned()
                .unwrap_or_else(|| Value::Array(Vec::new())),
        )
        .unwrap_or_default();
        return ok(
            &format!("宸茶鍙?{} 涓?Zed 杩滅▼椤圭洰銆?, projects.len()),
            ZedRemoteProjectsPayload { projects },
        );
    }
    failed(
        result
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("璇诲彇 Zed 杩滅▼椤圭洰澶辫触銆?),
        ZedRemoteProjectsPayload {
            projects: Vec::new(),
        },
    )
}

#[tauri::command]
pub fn open_zed_remote(payload: Value) -> CommandResult<ZedRemoteOpenPayload> {
    let result = codex_plus_core::zed_remote::open_zed_remote(&payload);
    let strategy = result
        .get("strategy")
        .cloned()
        .and_then(|value| serde_json::from_value::<ZedOpenStrategy>(value).ok())
        .unwrap_or_default();
    let url = result
        .get("url")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if result.get("status").and_then(Value::as_str) == Some("ok") {
        return ok(
            "宸插湪 Zed Remote 鎵撳紑椤圭洰銆?,
            ZedRemoteOpenPayload { url, strategy },
        );
    }
    failed(
        result
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("鏃犳硶鍦?Zed Remote 鎵撳紑椤圭洰銆?),
        ZedRemoteOpenPayload { url, strategy },
    )
}

#[tauri::command]
pub fn forget_zed_remote_project(id: String) -> CommandResult<ZedRemoteProjectsPayload> {
    let result =
        codex_plus_core::zed_remote::forget_zed_remote_project_response(&json!({ "id": id }));
    if result.get("status").and_then(Value::as_str) != Some("ok") {
        return failed(
            result
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("绉婚櫎 Zed 杩滅▼椤圭洰澶辫触銆?),
            ZedRemoteProjectsPayload {
                projects: Vec::new(),
            },
        );
    }
    list_zed_remote_projects()
}

#[tauri::command]
pub fn delete_local_session(request: DeleteLocalSessionRequest) -> CommandResult<DeleteResult> {
    let session_id = request.session_id.trim();
    if session_id.is_empty() {
        return failed(
            "浼氳瘽 ID 涓嶈兘涓虹┖銆?,
            DeleteResult {
                status: codex_plus_core::models::DeleteStatus::Failed,
                session_id: String::new(),
                message: "浼氳瘽 ID 涓嶈兘涓虹┖銆?.to_string(),
                undo_token: None,
                backup_path: None,
            },
        );
    }
    let session = SessionRef {
        session_id: session_id.to_string(),
        title: request.title,
    };
    let mut candidate_paths = Vec::new();
    if let Some(path) = request.db_path.as_deref() {
        let path = PathBuf::from(path);
        if !candidate_paths.iter().any(|candidate| candidate == &path) {
            candidate_paths.push(path);
        }
    }
    for path in codex_plus_core::codex_sqlite::codex_session_db_paths_from_home(
        &codex_plus_core::codex_sqlite::default_codex_home_dir(),
    ) {
        if !candidate_paths.iter().any(|candidate| candidate == &path) {
            candidate_paths.push(path);
        }
    }
    log_manager_event(
        "manager.delete_local_session.start",
        json!({
            "session_id": session_id,
            "title": session.title,
            "requested_db_path": request.db_path,
            "candidate_paths": candidate_paths
                .iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect::<Vec<_>>(),
        }),
    );
    let result = codex_plus_data::delete_local_from_paths(
        candidate_paths.clone(),
        codex_plus_data::BackupStore::new(
            codex_plus_core::paths::default_app_state_dir().join("backups"),
        ),
        &session,
    );
    log_manager_event(
        "manager.delete_local_session.finish",
        json!({
            "session_id": session_id,
            "final_status": format!("{:?}", result.status),
            "final_message": result.message,
            "candidate_paths": candidate_paths
                .iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect::<Vec<_>>(),
        }),
    );
    let status = if matches!(
        result.status,
        codex_plus_core::models::DeleteStatus::LocalDeleted
    ) {
        "ok"
    } else {
        "failed"
    };
    CommandResult {
        status: status.to_string(),
        message: result.message.clone(),
        payload: result,
    }
}

fn local_session_adapter(db_path: &Path) -> codex_plus_data::SQLiteStorageAdapter {
    codex_plus_data::SQLiteStorageAdapter::new(
        db_path,
        codex_plus_data::BackupStore::new(
            codex_plus_core::paths::default_app_state_dir().join("backups"),
        ),
    )
}

fn normalize_settings_before_save(mut settings: BackendSettings) -> BackendSettings {
    if let Some(path) =
        codex_plus_core::app_paths::normalize_codex_app_path(Path::new(&settings.codex_app_path))
    {
        settings.codex_app_path = path.to_string_lossy().to_string();
    }
    settings.relay_common_config_contents =
        codex_plus_core::relay_config::sanitize_common_config_contents(
            &settings.relay_common_config_contents,
        );
    let (common_without_context, extracted_context) =
        split_relay_context_config_sections(&settings.relay_common_config_contents);
    settings.relay_common_config_contents = common_without_context;
    settings.relay_context_config_contents =
        relay_join_config_sections(&[&settings.relay_context_config_contents, &extracted_context]);
    settings.relay_context_config_contents =
        codex_plus_core::relay_config::sanitize_common_config_contents(
            &settings.relay_context_config_contents,
        );
    for profile in &mut settings.relay_profiles {
        if let Err(error) =
            codex_plus_core::relay_config::normalize_relay_profile_for_storage(profile)
        {
            log_manager_event(
                "manager.normalize_relay_profile_for_storage.failed",
                json!({
                    "profileId": profile.id,
                    "profileName": profile.name,
                    "error": error.to_string()
                }),
            );
        }
    }
    let common_config = relay_combined_common_config(&settings);
    if !common_config.trim().is_empty() {
        for profile in &mut settings.relay_profiles {
            if !profile.use_common_config || profile.config_contents.trim().is_empty() {
                continue;
            }
            match codex_plus_core::relay_config::strip_common_config_from_config(
                &profile.config_contents,
                &common_config,
            ) {
                Ok(stripped) => {
                    profile.config_contents =
                        strip_common_config_text_fallback(&stripped, &common_config);
                }
                Err(_) => {
                    profile.config_contents =
                        strip_common_config_text_fallback(&profile.config_contents, &common_config);
                }
            }
        }
    }
    settings.provider_sync_saved_providers =
        normalize_provider_sync_provider_list(settings.provider_sync_saved_providers);
    settings.provider_sync_manual_providers =
        normalize_provider_sync_provider_list(settings.provider_sync_manual_providers);
    settings.provider_sync_last_selected_provider = settings
        .provider_sync_last_selected_provider
        .trim()
        .to_string();
    settings
}

fn normalize_provider_sync_provider_list(values: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            result.push(trimmed.to_string());
        }
    }
    result.sort();
    result
}

fn relay_combined_common_config(settings: &BackendSettings) -> String {
    relay_join_config_sections(&[
        &settings.relay_common_config_contents,
        &settings.relay_context_config_contents,
    ])
}

fn relay_join_config_sections(sections: &[&str]) -> String {
    let sections = sections
        .iter()
        .map(|section| section.trim())
        .filter(|section| !section.is_empty())
        .collect::<Vec<_>>();
    if sections.is_empty() {
        String::new()
    } else {
        codex_plus_core::relay_config::normalize_config_text(&format!(
            "{}\n",
            sections.join("\n\n")
        ))
    }
}

fn split_relay_context_config_sections(config: &str) -> (String, String) {
    let mut common = Vec::new();
    let mut context = Vec::new();
    let mut in_context_table = false;

    for line in config.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_context_table = trimmed.starts_with("[mcp_servers.")
                || trimmed.starts_with("[skills.")
                || trimmed.starts_with("[plugins.");
        }
        if in_context_table {
            context.push(line);
        } else {
            common.push(line);
        }
    }

    (
        relay_join_config_sections(&[&common.join("\n")]),
        relay_join_config_sections(&[&context.join("\n")]),
    )
}

fn strip_common_config_text_fallback(config_contents: &str, common_config: &str) -> String {
    let common = common_config_anchors(common_config);
    if common.root_keys.is_empty() && common.table_headers.is_empty() {
        return ensure_text_newline(config_contents.trim_end());
    }

    let mut kept = Vec::new();
    let mut skipping_table = false;

    for line in config_contents.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            let header = trimmed.to_string();
            skipping_table = common.table_headers.contains(&header);
            if skipping_table {
                continue;
            }
        }

        if skipping_table {
            continue;
        }

        if let Some(key) = toml_key_from_line(trimmed) {
            if common.root_keys.contains(key) {
                continue;
            }
        }

        kept.push(line);
    }

    ensure_text_newline(kept.join("\n").trim_end())
}

struct CommonConfigAnchors {
    root_keys: std::collections::HashSet<String>,
    table_headers: std::collections::HashSet<String>,
}

fn common_config_anchors(common_config: &str) -> CommonConfigAnchors {
    let mut root_keys = std::collections::HashSet::new();
    let mut table_headers = std::collections::HashSet::new();
    let mut in_table = false;

    for line in common_config.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_table = true;
            table_headers.insert(trimmed.to_string());
            continue;
        }
        if !in_table {
            if let Some(key) = toml_key_from_line(trimmed) {
                root_keys.insert(key.to_string());
            }
        }
    }

    CommonConfigAnchors {
        root_keys,
        table_headers,
    }
}

fn toml_key_from_line(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }
    let (key, _) = trimmed.split_once('=')?;
    let key = key.trim();
    if key.is_empty() { None } else { Some(key) }
}

fn ensure_text_newline(value: &str) -> String {
    if value.trim().is_empty() {
        String::new()
    } else {
        format!("{}\n", value.trim_end())
    }
}

#[tauri::command]
pub async fn load_provider_sync_targets() -> CommandResult<Value> {
    let settings = SettingsStore::default().load().unwrap_or_default();
    let result =
        tauri::async_runtime::spawn_blocking(|| codex_plus_data::load_provider_sync_targets(None))
            .await
            .map_err(|error| anyhow::anyhow!("provider target discovery task failed: {error}"));
    match result {
        Ok(mut targets) => {
            let manual = settings
                .provider_sync_manual_providers
                .iter()
                .chain(settings.provider_sync_saved_providers.iter())
                .filter_map(|value| {
                    let trimmed = value.trim();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_string())
                    }
                })
                .collect::<Vec<_>>();
            merge_manual_provider_sync_targets(&mut targets, &manual, &settings);
            ok(
                "Provider 鍚屾鐩爣宸插姞杞姐€?,
                serde_json::to_value(targets).unwrap_or_else(|_| json!({})),
            )
        }
        Err(error) => failed(&format!("Provider 鍚屾鐩爣鍔犺浇澶辫触锛歿error}"), json!({})),
    }
}

fn merge_manual_provider_sync_targets(
    targets: &mut codex_plus_data::ProviderSyncTargetList,
    manual: &[String],
    settings: &BackendSettings,
) {
    for id in manual {
        if let Some(existing) = targets.targets.iter_mut().find(|target| target.id == *id) {
            if !existing
                .sources
                .contains(&codex_plus_data::ProviderSyncTargetSource::Manual)
            {
                existing
                    .sources
                    .push(codex_plus_data::ProviderSyncTargetSource::Manual);
                existing.sources.sort();
            }
            existing.is_manual = settings.provider_sync_manual_providers.contains(id);
            existing.is_saved = settings.provider_sync_saved_providers.contains(id);
        } else {
            targets
                .targets
                .push(codex_plus_data::ProviderSyncTargetOption {
                    id: id.clone(),
                    sources: vec![codex_plus_data::ProviderSyncTargetSource::Manual],
                    is_current_provider: *id == targets.current_provider,
                    is_manual: settings.provider_sync_manual_providers.contains(id),
                    is_saved: settings.provider_sync_saved_providers.contains(id),
                });
        }
    }
    targets.targets.sort_by(|left, right| {
        right
            .is_current_provider
            .cmp(&left.is_current_provider)
            .then_with(|| left.id.cmp(&right.id))
    });
}

#[tauri::command]
pub async fn sync_providers_now(target_provider: Option<String>) -> CommandResult<Value> {
    let target_provider = target_provider
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let target_for_settings = target_provider.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        codex_plus_data::run_provider_sync_with_target(None, target_provider.as_deref())
    })
    .await
    .map_err(|error| anyhow::anyhow!("provider sync task failed: {error}"));
    match result {
        Ok(sync) => {
            if is_success_sync_status(&sync.status) {
                persist_provider_sync_selection(
                    target_for_settings
                        .as_deref()
                        .unwrap_or(&sync.target_provider),
                );
            }
            ok(
                &format!(
                    "渚涘簲鍟嗗凡鍚屾涓€娆★細{} 涓細璇濇枃浠讹紝{} 琛岀储寮曪紝璺宠繃 {} 涓崰鐢ㄦ枃浠躲€?,
                    sync.changed_session_files,
                    sync.sqlite_rows_updated,
                    sync.skipped_locked_rollout_files.len()
                ),
                json!({
                    "syncStatus": sync.status,
                    "targetProvider": sync.target_provider,
                    "changedSessionFiles": sync.changed_session_files,
                    "skippedLockedRolloutFiles": sync.skipped_locked_rollout_files,
                    "sqliteRowsUpdated": sync.sqlite_rows_updated,
                    "sqliteProviderRowsUpdated": sync.sqlite_provider_rows_updated,
                    "sqliteUserEventRowsUpdated": sync.sqlite_user_event_rows_updated,
                    "sqliteCwdRowsUpdated": sync.sqlite_cwd_rows_updated,
                    "updatedWorkspaceRoots": sync.updated_workspace_roots,
                    "encryptedContentWarning": sync.encrypted_content_warning,
                    "backupDir": sync.backup_dir,
                    "syncMessage": sync.message,
                }),
            )
        }
        Err(error) => failed(&format!("渚涘簲鍟嗗悓姝ュけ璐ワ細{error}"), json!({})),
    }
}

fn is_success_sync_status(status: &codex_plus_data::ProviderSyncStatus) -> bool {
    matches!(status, codex_plus_data::ProviderSyncStatus::Synced)
}

fn persist_provider_sync_selection(provider: &str) {
    let trimmed = provider.trim();
    if trimmed.is_empty() {
        return;
    }
    let store = SettingsStore::default();
    let mut settings = store.load().unwrap_or_default();
    settings.provider_sync_last_selected_provider = trimmed.to_string();
    if !settings
        .provider_sync_saved_providers
        .iter()
        .any(|item| item == trimmed)
    {
        settings
            .provider_sync_saved_providers
            .push(trimmed.to_string());
    }
    settings.provider_sync_saved_providers =
        normalize_provider_sync_provider_list(settings.provider_sync_saved_providers);
    let _ = store.save(&settings);
}



#[tauri::command]
pub async fn refresh_script_market() -> CommandResult<ScriptMarketPayload> {
    match script_market::fetch_market_manifest(script_market::DEFAULT_MARKET_INDEX_URL).await {
        Ok(manifest) => ok(
            "鑴氭湰甯傚満宸插埛鏂般€?,
            script_market_payload_from_manifest(&manifest, "ok", "鑴氭湰甯傚満宸插埛鏂般€?),
        ),
        Err(error) => failed(
            &format!("鑴氭湰甯傚満鍔犺浇澶辫触锛歿error}"),
            failed_script_market_payload(&format!("鑴氭湰甯傚満鍔犺浇澶辫触锛歿error}")),
        ),
    }
}

#[tauri::command]
pub async fn install_market_script(id: String) -> CommandResult<ScriptMarketPayload> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return failed(
            "鑴氭湰 id 涓嶈兘涓虹┖銆?,
            failed_script_market_payload("鑴氭湰 id 涓嶈兘涓虹┖銆?),
        );
    }
    let manifest =
        match script_market::fetch_market_manifest(script_market::DEFAULT_MARKET_INDEX_URL).await {
            Ok(manifest) => manifest,
            Err(error) => {
                return failed(
                    &format!("鑴氭湰甯傚満鍔犺浇澶辫触锛歿error}"),
                    failed_script_market_payload(&format!("鑴氭湰甯傚満鍔犺浇澶辫触锛歿error}")),
                );
            }
        };
    let Some(script) = manifest.scripts.iter().find(|script| script.id == trimmed) else {
        return failed(
            "甯傚満娓呭崟涓湭鎵惧埌璇ヨ剼鏈€?,
            script_market_payload_from_manifest(&manifest, "failed", "甯傚満娓呭崟涓湭鎵惧埌璇ヨ剼鏈€?),
        );
    };
    let manager = default_user_script_manager();
    match script_market::install_market_script(&manager, script).await {
        Ok(()) => ok(
            "鑴氭湰宸插畨瑁呫€?,
            script_market_payload_from_manifest(&manifest, "ok", "鑴氭湰宸插畨瑁呫€?),
        ),
        Err(error) => failed(
            &format!("瀹夎鑴氭湰澶辫触锛歿error}"),
            script_market_payload_from_manifest(
                &manifest,
                "failed",
                &format!("瀹夎鑴氭湰澶辫触锛歿error}"),
            ),
        ),
    }
}

#[tauri::command]
pub fn set_user_script_enabled(key: String, enabled: bool) -> CommandResult<SettingsPayload> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return failed("鑴氭湰 key 涓嶈兘涓虹┖銆?, fallback_settings_payload());
    }
    let manager = default_user_script_manager();
    match manager.set_script_enabled(trimmed, enabled) {
        Ok(_) => settings_payload(
            if enabled {
                "鑴氭湰宸插惎鐢ㄣ€?
            } else {
                "鑴氭湰宸茬鐢ㄣ€?
            },
            "鑴氭湰鍚仠澶辫触",
        ),
        Err(error) => failed(
            &format!("鑴氭湰鍚仠澶辫触锛歿error}"),
            fallback_settings_payload(),
        ),
    }
}

#[tauri::command]
pub fn delete_user_script(key: String) -> CommandResult<SettingsPayload> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return failed("鑴氭湰 key 涓嶈兘涓虹┖銆?, fallback_settings_payload());
    }
    let manager = default_user_script_manager();
    match manager.delete_user_script(trimmed) {
        Ok(_) => settings_payload("鑴氭湰宸插垹闄ゃ€?, "鑴氭湰鍒犻櫎澶辫触"),
        Err(error) => failed(
            &format!("鑴氭湰鍒犻櫎澶辫触锛歿error}"),
            fallback_settings_payload(),
        ),
    }
}

#[tauri::command]
pub fn open_external_url(url: String) -> CommandResult<Value> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return failed("鍙厑璁告墦寮€ http 鎴?https 閾炬帴銆?, json!({}));
    }
    match open_url(trimmed) {
        Ok(()) => ok("宸插湪绯荤粺娴忚鍣ㄦ墦寮€閾炬帴銆?, json!({ "url": trimmed })),
        Err(error) => failed(&format!("鎵撳紑閾炬帴澶辫触锛歿error}"), json!({ "url": trimmed })),
    }
}

#[tauri::command]
pub async fn install_entrypoints() -> InstallActionResult {
    tauri::async_runtime::spawn_blocking(install::install_entrypoints)
        .await
        .unwrap_or_else(|error| install_background_failure("瀹夎鍏ュ彛", error))
}

#[tauri::command]
pub async fn uninstall_entrypoints(options: InstallOptions) -> InstallActionResult {
    tauri::async_runtime::spawn_blocking(move || install::uninstall_entrypoints(options))
        .await
        .unwrap_or_else(|error| install_background_failure("鍗歌浇鍏ュ彛", error))
}

#[tauri::command]
pub async fn repair_shortcuts() -> InstallActionResult {
    tauri::async_runtime::spawn_blocking(install::repair_shortcuts)
        .await
        .unwrap_or_else(|error| install_background_failure("淇蹇嵎鏂瑰紡", error))
}

#[tauri::command]
pub fn repair_backend() -> CommandResult<SettingsPayload> {
    let settings = SettingsStore::default().load().unwrap_or_default();
    let message = match codex_plus_core::cli_wrapper::ensure_cli_wrapper(&settings) {
        Ok(Some(install)) => format!(
            "鍚庣宸蹭慨澶嶏紝鍛戒护鍖呰鍣ㄥ凡鎸囧悜 {}銆?,
            install.real_codex.to_string_lossy()
        ),
        Ok(None) => "鍚庣宸蹭慨澶嶏紝鍛戒护鍖呰鍣ㄥ綋鍓嶆湭鍚敤銆?.to_string(),
        Err(error) => format!("鍚庣淇閮ㄥ垎澶辫触锛歿error}"),
    };
    settings_payload(&message, "淇鍚庨噸鏂拌鍙栬缃け璐?)
}

#[tauri::command]
pub async fn check_update() -> CommandResult<Value> {
    ok("鍗囩骇鍔熻兘宸茬鐢?, json!({
        "currentVersion": codex_plus_core::version::VERSION,
        "latestVersion": Value::Null,
        "releaseSummary": "",
        "assetName": Value::Null,
        "assetUrl": Value::Null,
        "updateAvailable": false,
        "progress": 0
    }))
}
#[tauri::command]
pub async fn perform_update(
    _release: Option<codex_plus_core::update::Release>,
) -> CommandResult<Value> {
    failed(
        "鍗囩骇鍔熻兘宸茬鐢?,
        json!({
            "currentVersion": codex_plus_core::version::VERSION,
            "progress": 0
        }),
    )
}
#[tauri::command]
pub fn load_watcher_state() -> CommandResult<WatcherPayload> {
    ok("watcher 鐘舵€佸凡鍔犺浇銆?, watcher_payload())
}

#[tauri::command]
pub fn install_watcher() -> CommandResult<WatcherPayload> {
    let launcher_path =
        codex_plus_core::install::companion_binary_path(codex_plus_core::install::SILENT_BINARY);
    match codex_plus_core::watcher::install_watcher(&launcher_path, default_debug_port()) {
        Ok(()) => ok("watcher 宸插畨瑁呫€?, watcher_payload()),
        Err(error) => failed(&format!("瀹夎 watcher 澶辫触锛歿error}"), watcher_payload()),
    }
}

#[tauri::command]
pub fn uninstall_watcher() -> CommandResult<WatcherPayload> {
    match codex_plus_core::watcher::uninstall_watcher() {
        Ok(()) => ok("watcher 宸茬Щ闄ゃ€?, watcher_payload()),
        Err(error) => failed(&format!("绉婚櫎 watcher 澶辫触锛歿error}"), watcher_payload()),
    }
}

#[tauri::command]
pub fn enable_watcher() -> CommandResult<WatcherPayload> {
    match codex_plus_core::watcher::enable_watcher() {
        Ok(()) => ok("watcher 宸插惎鐢ㄣ€?, watcher_payload()),
        Err(error) => failed(&format!("鍚敤 watcher 澶辫触锛歿error}"), watcher_payload()),
    }
}

#[tauri::command]
pub fn disable_watcher() -> CommandResult<WatcherPayload> {
    match codex_plus_core::watcher::disable_watcher() {
        Ok(()) => ok("watcher 宸茬鐢ㄣ€?, watcher_payload()),
        Err(error) => failed(&format!("绂佺敤 watcher 澶辫触锛歿error}"), watcher_payload()),
    }
}

#[tauri::command]
pub fn read_latest_logs(request: LogRequest) -> CommandResult<LogsPayload> {
    let path = codex_plus_core::paths::default_diagnostic_log_path();
    match read_tail(&path, request.lines) {
        Ok(text) => ok(
            "鏃ュ織宸茶鍙栥€?,
            LogsPayload {
                path: path.to_string_lossy().to_string(),
                text,
                lines: request.lines,
            },
        ),
        Err(error) => failed(
            &format!("璇诲彇鏃ュ織澶辫触锛歿error}"),
            LogsPayload {
                path: path.to_string_lossy().to_string(),
                text: String::new(),
                lines: request.lines,
            },
        ),
    }
}

#[tauri::command]
pub fn copy_diagnostics() -> CommandResult<DiagnosticsPayload> {
    ok(
        "璇婃柇鎶ュ憡宸茬敓鎴愩€?,
        DiagnosticsPayload {
            report: diagnostics_report(),
        },
    )
}

#[tauri::command]
pub fn reset_settings() -> CommandResult<SettingsPayload> {
    let settings = BackendSettings::default();
    match SettingsStore::default().save(&settings) {
        Ok(()) => settings_payload("璁剧疆宸查噸缃负榛樿鍊笺€?, "璁剧疆閲嶇疆鍚庨噸鏂拌鍙栧け璐?),
        Err(error) => failed(
            &format!("閲嶇疆璁剧疆澶辫触锛歿error}"),
            SettingsPayload {
                settings,
                settings_path: codex_plus_core::paths::default_settings_path()
                    .to_string_lossy()
                    .to_string(),
                user_scripts: user_script_inventory(),
            },
        ),
    }
}

#[tauri::command]
pub fn relay_status() -> CommandResult<RelayPayload> {
    let status = codex_plus_core::relay_config::default_relay_status();
    let message = if status.authenticated {
        "宸叉娴嬪埌 ChatGPT 鐧诲綍鐘舵€併€?
    } else {
        "鏈娴嬪埌 ChatGPT 鐧诲綍鐘舵€侊紝璇峰厛鍦?Codex/ChatGPT 涓甯哥櫥褰曘€?
    };
    ok(message, relay_payload(status, None))
}

#[tauri::command]
pub fn read_relay_files() -> CommandResult<RelayFilesPayload> {
    let home = codex_plus_core::relay_config::default_codex_home_dir();
    match relay_files_payload_from_home(&home) {
        Ok(payload) => ok("閰嶇疆鏂囦欢鍐呭宸茶鍙栥€?, payload),
        Err(error) => failed(
            &format!("璇诲彇閰嶇疆鏂囦欢澶辫触锛歿error}"),
            RelayFilesPayload {
                config_path: home.join("config.toml").to_string_lossy().to_string(),
                auth_path: home.join("auth.json").to_string_lossy().to_string(),
                config_contents: String::new(),
                auth_contents: String::new(),
            },
        ),
    }
}

#[tauri::command]
pub fn save_relay_file(request: SaveRelayFileRequest) -> CommandResult<RelayFilesPayload> {
    let home = codex_plus_core::relay_config::default_codex_home_dir();
    match save_relay_file_in_home(&home, &request.kind, &request.contents)
        .and_then(|_| relay_files_payload_from_home(&home))
    {
        Ok(payload) => ok("閰嶇疆鏂囦欢宸蹭繚瀛樸€?, payload),
        Err(error) => failed(
            &format!("淇濆瓨閰嶇疆鏂囦欢澶辫触锛歿error}"),
            relay_files_payload_from_home(&home).unwrap_or_else(|_| RelayFilesPayload {
                config_path: home.join("config.toml").to_string_lossy().to_string(),
                auth_path: home.join("auth.json").to_string_lossy().to_string(),
                config_contents: String::new(),
                auth_contents: String::new(),
            }),
        ),
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayProfileSwitchRequest {
    pub settings: BackendSettings,
    #[serde(default)]
    pub previous_active_relay_id: String,
}

#[tauri::command]
pub fn switch_relay_profile(
    request: RelayProfileSwitchRequest,
) -> CommandResult<RelaySwitchPayload> {
    let Ok(_guard) = relay_switch_mutex().lock() else {
        let status = codex_plus_core::relay_config::default_relay_status();
        return failed(
            "渚涘簲鍟嗗垏鎹㈤攣宸叉崯鍧忥紝璇烽噸鍚鐞嗗櫒鍚庡啀璇曘€?,
            relay_switch_payload(
                SettingsStore::default().load().unwrap_or_default(),
                status,
                None,
            ),
        );
    };
    let home = codex_plus_core::relay_config::default_codex_home_dir();
    let store = SettingsStore::default();
    let previous_active_relay_id = request.previous_active_relay_id;
    let settings = normalize_settings_before_save(request.settings);
    log_manager_event(
        "manager.switch_relay_profile.start",
        json!({
            "previousActiveRelayId": previous_active_relay_id,
            "targetRelayId": settings.active_relay_id
        }),
    );
    match codex_plus_core::relay_switch::switch_relay_profile_in_home(
        &store,
        &home,
        settings,
        &previous_active_relay_id,
    ) {
        Ok(result) => {
            let status = codex_plus_core::relay_config::relay_status_from_home(&home);
            log_manager_event(
                "manager.switch_relay_profile.ok",
                json!({
                    "targetRelayId": result.settings.active_relay_id,
                    "configured": status.configured,
                    "backupPath": result.backup_path.as_ref()
                }),
            );
            ok(
                "渚涘簲鍟嗗凡鍒囨崲銆?,
                relay_switch_payload(result.settings, status, result.backup_path),
            )
        }
        Err(error) => {
            let status = codex_plus_core::relay_config::relay_status_from_home(&home);
            let settings = store.load().unwrap_or_default();
            log_manager_event(
                "manager.switch_relay_profile.failed",
                json!({
                    "previousActiveRelayId": previous_active_relay_id,
                    "activeRelayId": settings.active_relay_id,
                    "error": error.to_string()
                }),
            );
            failed(
                &format!("渚涘簲鍟嗗垏鎹㈠け璐ワ細{error}"),
                relay_switch_payload(settings, status, None),
            )
        }
    }
}

#[tauri::command]
pub fn write_diagnostic_event(event: String, detail: Value) -> CommandResult<Value> {
    let event = sanitize_manager_event(&event);
    match codex_plus_core::diagnostic_log::append_diagnostic_log(&event, detail) {
        Ok(()) => ok("璇婃柇鏃ュ織宸插啓鍏ャ€?, json!({})),
        Err(error) => failed(&format!("鍐欏叆璇婃柇鏃ュ織澶辫触锛歿error}"), json!({})),
    }
}

#[tauri::command]
pub fn backfill_relay_profile_from_live(
    request: BackfillRelayProfileRequest,
) -> CommandResult<SettingsBackfillPayload> {
    let home = codex_plus_core::relay_config::default_codex_home_dir();
    let mut settings = request.settings;
    let requested_profile_id = request.profile_id.clone();
    log_manager_event(
        "manager.backfill_relay_profile_from_live.start",
        json!({
            "profileId": requested_profile_id,
            "activeRelayId": settings.active_relay_id
        }),
    );
    let Some(profile) = settings
        .relay_profiles
        .iter_mut()
        .find(|profile| profile.id == request.profile_id)
    else {
        log_manager_event(
            "manager.backfill_relay_profile_from_live.missing_profile",
            json!({
                "profileId": requested_profile_id
            }),
        );
        return failed(
            "褰撳墠渚涘簲鍟嗗凡涓嶅湪閰嶇疆鍒楄〃涓紝宸插仠姝㈠垏鎹互閬垮厤瑕嗙洊鐢ㄦ埛鏀瑰姩銆?,
            SettingsBackfillPayload { settings },
        );
    };

    match codex_plus_core::relay_config::backfill_relay_profile_from_home_with_common(
        &home,
        profile,
        &mut settings.relay_context_config_contents,
    ) {
        Ok(()) => {
            log_manager_event(
                "manager.backfill_relay_profile_from_live.ok",
                json!({
                    "profileId": requested_profile_id
                }),
            );
            ok(
                "褰撳墠渚涘簲鍟嗛厤缃凡浠?live 鏂囦欢鍥炲～銆?,
                SettingsBackfillPayload { settings },
            )
        }
        Err(error) => {
            log_manager_event(
                "manager.backfill_relay_profile_from_live.failed",
                json!({
                    "profileId": requested_profile_id,
                    "error": error.to_string()
                }),
            );
            failed(
                &format!("鍥炲～褰撳墠渚涘簲鍟嗛厤缃け璐ワ細{error}"),
                SettingsBackfillPayload { settings },
            )
        }
    }
}

#[tauri::command]
pub fn list_context_entries(
    request: ContextSettingsRequest,
) -> CommandResult<ContextEntriesPayload> {
    match codex_plus_core::relay_config::list_context_entries_from_common_config(
        &request.settings.relay_context_config_contents,
    ) {
        Ok(entries) => ok(
            "宸ュ叿涓庢彃浠跺垪琛ㄥ凡璇诲彇銆?,
            ContextEntriesPayload {
                settings: request.settings,
                entries,
            },
        ),
        Err(error) => failed(
            &format!("璇诲彇宸ュ叿涓庢彃浠跺垪琛ㄥけ璐ワ細{error}"),
            ContextEntriesPayload {
                settings: request.settings,
                entries: empty_context_entries(),
            },
        ),
    }
}

#[tauri::command]
pub fn read_live_context_entries() -> CommandResult<LiveContextEntriesPayload> {
    let home = codex_plus_core::relay_config::default_codex_home_dir();
    let config_path = home.join("config.toml");
    let config = read_optional_text_file(&config_path).unwrap_or_default();
    match codex_plus_core::relay_config::list_context_entries_from_common_config(&config) {
        Ok(entries) => ok(
            "live 宸ュ叿涓庢彃浠跺凡璇诲彇銆?,
            LiveContextEntriesPayload { entries },
        ),
        Err(error) => failed(
            &format!("璇诲彇 live 宸ュ叿涓庢彃浠跺け璐ワ細{error}"),
            LiveContextEntriesPayload {
                entries: empty_context_entries(),
            },
        ),
    }
}

#[tauri::command]
pub fn upsert_context_entry(request: ContextEntryRequest) -> CommandResult<ContextEntriesPayload> {
    let mut settings = request.settings;
    match codex_plus_core::relay_config::upsert_context_entry_in_common_config(
        &settings.relay_context_config_contents,
        &request.kind,
        &request.id,
        &request.toml_body,
    ) {
        Ok(common) => {
            settings.relay_context_config_contents = common;
            list_context_entries(ContextSettingsRequest { settings })
        }
        Err(error) => failed(
            &format!("淇濆瓨宸ュ叿涓庢彃浠跺け璐ワ細{error}"),
            ContextEntriesPayload {
                settings,
                entries: empty_context_entries(),
            },
        ),
    }
}

#[tauri::command]
pub fn sync_live_context_entries(
    request: ContextSettingsRequest,
) -> CommandResult<LiveContextEntriesPayload> {
    let home = codex_plus_core::relay_config::default_codex_home_dir();
    let config_path = home.join("config.toml");
    let current_config = match read_optional_text_file(&config_path) {
        Ok(config) => config,
        Err(error) => {
            return failed(
                &format!("璇诲彇 live config.toml 澶辫触锛歿error}"),
                LiveContextEntriesPayload {
                    entries: empty_context_entries(),
                },
            );
        }
    };
    let updated_config = match codex_plus_core::relay_config::sync_live_config_context_entries(
        &current_config,
        &request.settings.relay_context_config_contents,
    ) {
        Ok(config) => config,
        Err(error) => {
            return failed(
                &format!("鍚屾 live 宸ュ叿涓庢彃浠跺け璐ワ細{error}"),
                LiveContextEntriesPayload {
                    entries: empty_context_entries(),
                },
            );
        }
    };
    if let Some(parent) = config_path.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            return failed(
                &format!("鍒涘缓 Codex 閰嶇疆鐩綍澶辫触锛歿error}"),
                LiveContextEntriesPayload {
                    entries: empty_context_entries(),
                },
            );
        }
    }
    if let Err(error) = std::fs::write(&config_path, &updated_config) {
        return failed(
            &format!("鍐欏叆 live config.toml 澶辫触锛歿error}"),
            LiveContextEntriesPayload {
                entries: empty_context_entries(),
            },
        );
    }
    match codex_plus_core::relay_config::list_context_entries_from_common_config(&updated_config) {
        Ok(entries) => ok(
            "live 宸ュ叿涓庢彃浠跺凡鍚屾銆?,
            LiveContextEntriesPayload { entries },
        ),
        Err(error) => failed(
            &format!("璇诲彇鍚屾鍚庣殑 live 宸ュ叿涓庢彃浠跺け璐ワ細{error}"),
            LiveContextEntriesPayload {
                entries: empty_context_entries(),
            },
        ),
    }
}

#[tauri::command]
pub fn delete_context_entry(request: ContextDeleteRequest) -> CommandResult<ContextEntriesPayload> {
    let mut settings = request.settings;
    match codex_plus_core::relay_config::delete_context_entry_from_common_config(
        &settings.relay_context_config_contents,
        &request.kind,
        &request.id,
    ) {
        Ok(common) => {
            settings.relay_context_config_contents = common;
            list_context_entries(ContextSettingsRequest { settings })
        }
        Err(error) => failed(
            &format!("鍒犻櫎宸ュ叿涓庢彃浠跺け璐ワ細{error}"),
            ContextEntriesPayload {
                settings,
                entries: empty_context_entries(),
            },
        ),
    }
}

#[tauri::command]
pub fn extract_relay_common_config(
    request: ExtractRelayCommonConfigRequest,
) -> CommandResult<ExtractRelayCommonConfigPayload> {
    match codex_plus_core::relay_config::extract_common_config_from_config(&request.config_contents)
        .and_then(|common_config_contents| {
            let profile_config_contents =
                codex_plus_core::relay_config::strip_common_config_from_config(
                    &request.config_contents,
                    &common_config_contents,
                )?;
            Ok(ExtractRelayCommonConfigPayload {
                common_config_contents,
                profile_config_contents,
            })
        }) {
        Ok(payload) => ok("閫氱敤閰嶇疆宸叉寜鍏煎鍒囨崲瑙勫垯鎻愬彇銆?, payload),
        Err(error) => failed(
            &format!("鎻愬彇閫氱敤閰嶇疆澶辫触锛歿error}"),
            ExtractRelayCommonConfigPayload {
                common_config_contents: String::new(),
                profile_config_contents: request.config_contents,
            },
        ),
    }
}

#[tauri::command]
pub async fn test_relay_profile(profile: RelayProfile) -> CommandResult<RelayProfileTestPayload> {
    let profile_name = if profile.name.trim().is_empty() {
        "鏈懡鍚嶄緵搴斿晢"
    } else {
        profile.name.trim()
    };
    let settings = SettingsStore::default().load().unwrap_or_default();
    let test_model: String = if !profile.test_model.trim().is_empty() {
        // 1. 浣跨敤鑰呭湪瑭蹭緵鎳夊晢鏄庣⒑濉殑娓│妯″瀷
        profile.test_model.trim().to_string()
    } else {
        // 2. 瑭蹭緵鎳夊晢鑷繁 config.toml 瑁＄殑 model锛堥伩鍏嶄覆鍛筹級
        let from_profile = codex_plus_core::relay_config::relay_profile_model(&profile);
        if from_profile.trim().is_empty() {
            // 3. 鏈€寰屾墠鐢ㄥ叏鍩熼爯瑷?
            settings.relay_test_model.trim().to_string()
        } else {
            from_profile
        }
    };
    match codex_plus_core::relay_config::test_relay_profile(&profile, &test_model).await {
        Ok(result) => {
            let status = if result.http_status < 400 {
                "ok"
            } else {
                "failed"
            };
            let preview = result.response_preview.trim();
            let detail = if preview.is_empty() {
                "鍝嶅簲鍐呭涓虹┖".to_string()
            } else {
                format!("鍝嶅簲锛歿preview}")
            };
            CommandResult {
                status: status.to_string(),
                message: format!(
                    "宸插悜銆寋profile_name}銆嶇敤妯″瀷銆寋test_model}銆嶅彂閫?hi锛孒TTP {}銆倇detail}",
                    result.http_status
                ),
                payload: RelayProfileTestPayload {
                    http_status: result.http_status,
                    endpoint: result.endpoint,
                    response_preview: result.response_preview,
                },
            }
        }
        Err(error) => failed(
            &format!("娴嬭瘯銆寋profile_name}銆嶅け璐ワ細{error}"),
            RelayProfileTestPayload {
                http_status: 0,
                endpoint: String::new(),
                response_preview: String::new(),
            },
        ),
    }
}

#[tauri::command]
pub async fn fetch_relay_profile_models(
    profile: RelayProfile,
) -> CommandResult<RelayProfileModelsPayload> {
    let profile_name = if profile.name.trim().is_empty() {
        "鏈懡鍚嶄緵搴斿晢"
    } else {
        profile.name.trim()
    };
    match codex_plus_core::model_catalog::fetch_relay_profile_model_ids(&profile).await {
        Ok((models, endpoint)) => ok(
            &format!("宸蹭粠銆寋profile_name}銆嶈幏鍙?{} 涓ā鍨嬨€?, models.len()),
            RelayProfileModelsPayload { models, endpoint },
        ),
        Err(error) => failed(
            &format!("浠庛€寋profile_name}銆嶈幏鍙栨ā鍨嬪け璐ワ細{error}"),
            RelayProfileModelsPayload {
                models: Vec::new(),
                endpoint: String::new(),
            },
        ),
    }
}

#[tauri::command]
pub fn apply_relay_injection() -> CommandResult<RelayPayload> {
    let home = codex_plus_core::relay_config::default_codex_home_dir();
    let settings = SettingsStore::default().load().unwrap_or_default();
    if !settings.relay_profiles_enabled {
        let status = codex_plus_core::relay_config::relay_status_from_home(&home);
        return failed(
            "渚涘簲鍟嗛厤缃€诲紑鍏冲凡鍏抽棴锛屾湭鍐欏叆 config.toml / auth.json銆?,
            relay_payload(status, None),
        );
    }
    let relay = settings.active_relay_profile();
    log_relay_apply_request("manager.apply_relay_injection", &settings, &relay);
    if relay_has_complete_files(&relay) {
        return match codex_plus_core::relay_config::apply_relay_profile_to_home_with_switch_rules_and_computer_use_guard(
            &home,
            &relay,
            &relay_combined_common_config(&settings),
            settings.computer_use_guard_enabled,
        ) {
            Ok(result) => {
                let status = codex_plus_core::relay_config::relay_status_from_home(&home);
                log_relay_apply_result(
                    "manager.apply_relay_injection.ok",
                    &relay,
                    &status,
                    result.backup_path.as_ref(),
                    None,
                );
                // Auto-start bridge for ChatCompletions protocol
                if relay.protocol == codex_plus_core::settings::RelayProtocol::ChatCompletions {
                    eprintln!("ChatCompletions profile detected, auto-starting bridge");
                    let _ = start_bridge(Some(37000));
                }
                ok(
                    "宸叉寜鍏煎鍒囨崲瑙勫垯鍒囨崲渚涘簲鍟嗐€?,
                    relay_payload(status, result.backup_path),
                )
            }
            Err(error) => {
                let status = codex_plus_core::relay_config::relay_status_from_home(&home);
                log_relay_apply_result(
                    "manager.apply_relay_injection.failed",
                    &relay,
                    &status,
                    None,
                    Some(error.to_string()),
                );
                failed(
                    &format!("鍒囨崲瀹屾暣涓浆閰嶇疆澶辫触锛歿error}"),
                    relay_payload(status, None),
                )
            }
        };
    }

    let auth = codex_plus_core::relay_config::chatgpt_auth_status_from_home(&home);
    if !auth.authenticated {
        let status = codex_plus_core::relay_config::relay_status_from_home(&home);
        log_relay_apply_result(
            "manager.apply_relay_injection.failed",
            &relay,
            &status,
            None,
            Some("鏈娴嬪埌 ChatGPT 鐧诲綍鐘舵€?.to_string()),
        );
        return failed(
            "鏈娴嬪埌 ChatGPT 鐧诲綍鐘舵€侊紝宸插仠姝㈠啓鍏ヤ腑杞厤缃€?,
            relay_payload(status, None),
        );
    }

    match codex_plus_core::relay_config::apply_relay_config_to_home_with_protocol(
        &home,
        &relay.base_url,
        &relay.api_key,
        relay.protocol,
        codex_plus_core::protocol_proxy::DEFAULT_PROTOCOL_PROXY_PORT,
    ) {
        Ok(result) => {
            let status = codex_plus_core::relay_config::relay_status_from_home(&home);
            log_relay_apply_result(
                "manager.apply_relay_injection.ok",
                &relay,
                &status,
                result.backup_path.as_ref(),
                None,
            );
            ok(
                "涓浆閰嶇疆宸插啓鍏ワ紝瀵嗛挜鏈湪鐣岄潰鏄庢枃鏄剧ず銆?,
                relay_payload(status, result.backup_path),
            )
        }
        Err(error) => {
            let status = codex_plus_core::relay_config::relay_status_from_home(&home);
            log_relay_apply_result(
                "manager.apply_relay_injection.failed",
                &relay,
                &status,
                None,
                Some(error.to_string()),
            );
            failed(
                &format!("鍐欏叆涓浆閰嶇疆澶辫触锛歿error}"),
                relay_payload(status, None),
            )
        }
    }
}

#[tauri::command]
pub fn apply_pure_api_injection() -> CommandResult<RelayPayload> {
    let home = codex_plus_core::relay_config::default_codex_home_dir();
    let settings = SettingsStore::default().load().unwrap_or_default();
    if !settings.relay_profiles_enabled {
        let status = codex_plus_core::relay_config::relay_status_from_home(&home);
        return failed(
            "渚涘簲鍟嗛厤缃€诲紑鍏冲凡鍏抽棴锛屾湭鍐欏叆 config.toml / auth.json銆?,
            relay_payload(status, None),
        );
    }
    let relay = settings.active_relay_profile();
    log_relay_apply_request("manager.apply_pure_api_injection", &settings, &relay);
    if relay_has_complete_files(&relay) {
        return match codex_plus_core::relay_config::apply_relay_profile_to_home_with_switch_rules_and_computer_use_guard(
            &home,
            &relay,
            &relay_combined_common_config(&settings),
            settings.computer_use_guard_enabled,
        ) {
            Ok(result) => {
                let status = codex_plus_core::relay_config::relay_status_from_home(&home);
                log_relay_apply_result(
                    "manager.apply_pure_api_injection.ok",
                    &relay,
                    &status,
                    result.backup_path.as_ref(),
                    None,
                );
                if !status.configured {
                    return failed(
                        "绾?API 閰嶇疆鍐欏叆鍚庢湭妫€娴嬪埌瀹屾暣 custom provider锛岃妫€鏌?config.toml 鍜屼緵搴斿晢 API Key銆?,
                        relay_payload(status, result.backup_path),
                    );
                }
                ok(
                    "宸叉寜鍏煎鍒囨崲瑙勫垯鍒囨崲渚涘簲鍟嗐€?,
                    relay_payload(status, result.backup_path),
                )
            }
            Err(error) => {
                let status = codex_plus_core::relay_config::relay_status_from_home(&home);
                log_relay_apply_result(
                    "manager.apply_pure_api_injection.failed",
                    &relay,
                    &status,
                    None,
                    Some(error.to_string()),
                );
                failed(
                    &format!("鍒囨崲绾?API 閰嶇疆澶辫触锛歿error}"),
                    relay_payload(status, None),
                )
            }
        };
    }

    match codex_plus_core::relay_config::apply_pure_api_config_to_home_with_protocol(
        &home,
        &relay.base_url,
        &relay.api_key,
        relay.protocol,
        codex_plus_core::protocol_proxy::DEFAULT_PROTOCOL_PROXY_PORT,
    ) {
        Ok(result) => {
            let status = codex_plus_core::relay_config::relay_status_from_home(&home);
            log_relay_apply_result(
                "manager.apply_pure_api_injection.ok",
                &relay,
                &status,
                result.backup_path.as_ref(),
                None,
            );
            if !status.configured {
                return failed(
                    "绾?API 閰嶇疆鍐欏叆鍚庢湭妫€娴嬪埌瀹屾暣 custom provider锛岃妫€鏌?config.toml 鍜屼緵搴斿晢 API Key銆?,
                    relay_payload(status, result.backup_path),
                );
            }
            ok(
                "绾?API 妯″紡宸插啓鍏ワ細config.toml 宸插啓鍏?custom provider锛宎uth.json 宸插垏鎹负褰撳墠渚涘簲鍟嗐€?,
                relay_payload(status, result.backup_path),
            )
        }
        Err(error) => {
            let status = codex_plus_core::relay_config::relay_status_from_home(&home);
            log_relay_apply_result(
                "manager.apply_pure_api_injection.failed",
                &relay,
                &status,
                None,
                Some(error.to_string()),
            );
            failed(
                &format!("鍐欏叆绾?API 妯″紡澶辫触锛歿error}"),
                relay_payload(status, None),
            )
        }
    }
}

#[tauri::command]
pub fn clear_relay_injection() -> CommandResult<RelayPayload> {
    let home = codex_plus_core::relay_config::default_codex_home_dir();
    let settings = SettingsStore::default().load().unwrap_or_default();
    let relay = settings.active_relay_profile();
    log_manager_event("manager.clear_relay_injection.start", json!({}));
    let auth_contents = (relay.relay_mode == codex_plus_core::settings::RelayMode::Official
        && !relay.official_mix_api_key
        && !relay.auth_contents.trim().is_empty())
    .then_some(relay.auth_contents.as_str());
    match codex_plus_core::relay_config::clear_relay_config_to_home_with_auth(&home, auth_contents)
    {
        Ok(result) => {
            let status = codex_plus_core::relay_config::relay_status_from_home(&home);
            log_manager_event(
                "manager.clear_relay_injection.ok",
                json!({
                    "configured": status.configured,
                    "backupPath": result.backup_path.as_ref()
                }),
            );
            ok(
                "宸叉竻闄?custom 涓浆 API 妯″紡锛屽苟鍒囨崲鍒板畼鏂?ChatGPT 鐧诲綍妯″紡銆?,
                relay_payload(status, result.backup_path),
            )
        }
        Err(error) => {
            let status = codex_plus_core::relay_config::relay_status_from_home(&home);
            log_manager_event(
                "manager.clear_relay_injection.failed",
                json!({
                    "configured": status.configured,
                    "error": error.to_string()
                }),
            );
            failed(
                &format!("娓呴櫎涓浆閰嶇疆澶辫触锛歿error}"),
                relay_payload(status, None),
            )
        }
    }
}

fn relay_has_complete_files(relay: &codex_plus_core::settings::RelayProfile) -> bool {
    if relay.relay_mode == codex_plus_core::settings::RelayMode::Official
        && relay.official_mix_api_key
    {
        return !relay.config_contents.trim().is_empty();
    }
    !relay.config_contents.trim().is_empty() && !relay.auth_contents.trim().is_empty()
}

fn log_relay_apply_request(
    event: &str,
    settings: &BackendSettings,
    relay: &codex_plus_core::settings::RelayProfile,
) {
    let _ = codex_plus_core::diagnostic_log::append_diagnostic_log(
        event,
        json!({
            "activeRelayId": settings.active_relay_id,
            "relayId": relay.id,
            "relayName": relay.name,
            "relayMode": relay.relay_mode,
            "protocol": relay.protocol,
            "baseUrl": relay.base_url,
            "hasConfigContents": !relay.config_contents.trim().is_empty(),
            "hasAuthContents": !relay.auth_contents.trim().is_empty(),
            "configContainsProxy": relay.config_contents.contains("127.0.0.1:57321")
        }),
    );
}

fn log_relay_apply_result(
    event: &str,
    relay: &codex_plus_core::settings::RelayProfile,
    status: &codex_plus_core::relay_config::RelayStatus,
    backup_path: Option<&String>,
    error: Option<String>,
) {
    log_manager_event(
        event,
        json!({
            "relayId": relay.id,
            "relayName": relay.name,
            "relayMode": relay.relay_mode,
            "protocol": relay.protocol,
            "configured": status.configured,
            "requiresOpenaiAuth": status.requires_openai_auth,
            "hasBearerToken": status.has_bearer_token,
            "backupPath": backup_path,
            "error": error
        }),
    );
}

fn log_manager_event(event: &str, detail: Value) {
    let _ = codex_plus_core::diagnostic_log::append_diagnostic_log(event, detail);
}

fn sanitize_manager_event(event: &str) -> String {
    let suffix = event
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let suffix = suffix.trim_matches(['.', '_', '-']).trim();
    if suffix.is_empty() {
        "manager.ui.event".to_string()
    } else if suffix.starts_with("manager.") {
        suffix.to_string()
    } else {
        format!("manager.ui.{suffix}")
    }
}

fn refresh_cli_wrapper_after_settings_save(settings: &BackendSettings) -> String {
    match codex_plus_core::cli_wrapper::ensure_cli_wrapper(settings) {
        Ok(Some(install)) => format!(
            " 鍛戒护鍖呰鍣ㄥ凡鏇存柊锛歿}銆?,
            install.real_codex.to_string_lossy()
        ),
        Ok(None) => String::new(),
        Err(error) => format!(" 浣嗗懡浠ゅ寘瑁呭櫒鏇存柊澶辫触锛歿error}銆?),
    }
}

fn relay_payload(
    status: codex_plus_core::relay_config::RelayStatus,
    backup_path: Option<String>,
) -> RelayPayload {
    RelayPayload {
        authenticated: status.authenticated,
        auth_source: status.auth_source,
        account_label: status.account_label,
        config_path: status.config_path,
        configured: status.configured,
        requires_openai_auth: status.requires_openai_auth,
        has_bearer_token: status.has_bearer_token,
        backup_path,
    }
}

fn relay_switch_payload(
    settings: BackendSettings,
    status: codex_plus_core::relay_config::RelayStatus,
    backup_path: Option<String>,
) -> RelaySwitchPayload {
    RelaySwitchPayload {
        settings,
        relay: relay_payload(status, backup_path),
        settings_path: codex_plus_core::paths::default_settings_path()
            .to_string_lossy()
            .to_string(),
        user_scripts: user_script_inventory(),
    }
}

fn relay_switch_mutex() -> &'static Mutex<()> {
    static RELAY_SWITCH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    RELAY_SWITCH_LOCK.get_or_init(|| Mutex::new(()))
}

fn empty_context_entries() -> codex_plus_core::relay_config::CodexContextEntries {
    codex_plus_core::relay_config::CodexContextEntries {
        mcp_servers: Vec::new(),
        skills: Vec::new(),
        plugins: Vec::new(),
    }
}

fn relay_files_payload_from_home(home: &std::path::Path) -> anyhow::Result<RelayFilesPayload> {
    let config_path = home.join("config.toml");
    let auth_path = home.join("auth.json");
    Ok(RelayFilesPayload {
        config_path: config_path.to_string_lossy().to_string(),
        auth_path: auth_path.to_string_lossy().to_string(),
        config_contents: read_optional_text_file(&config_path)?,
        auth_contents: read_optional_text_file(&auth_path)?,
    })
}

fn save_relay_file_in_home(
    home: &std::path::Path,
    kind: &str,
    contents: &str,
) -> anyhow::Result<()> {
    let path = match kind {
        "config" => home.join("config.toml"),
        "auth" => home.join("auth.json"),
        other => anyhow::bail!("鏈煡閰嶇疆鏂囦欢绫诲瀷锛歿other}"),
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, contents)?;
    Ok(())
}

fn read_optional_text_file(path: &std::path::Path) -> anyhow::Result<String> {
    match std::fs::read_to_string(path) {
        Ok(contents) => Ok(contents),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(error.into()),
    }
}



fn open_url(url: &str) -> anyhow::Result<()> {
    #[cfg(windows)]
    {
        codex_plus_core::windows_open_url(url)
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|error| anyhow::anyhow!("鍚姩绯荤粺娴忚鍣ㄥけ璐ワ細{error}"))
    }
}

fn settings_payload(message: &str, failure_context: &str) -> CommandResult<SettingsPayload> {
    match settings_payload_value() {
        Ok(payload) => ok(message, payload),
        Err((error, payload)) => failed(&format!("{failure_context}锛歿error}"), payload),
    }
}

fn settings_payload_value() -> Result<SettingsPayload, (anyhow::Error, SettingsPayload)> {
    let store = SettingsStore::default();
    let settings_path = codex_plus_core::paths::default_settings_path()
        .to_string_lossy()
        .to_string();
    match store.load() {
        Ok(settings) => Ok(SettingsPayload {
            settings,
            settings_path,
            user_scripts: user_script_inventory(),
        }),
        Err(error) => Err((
            error,
            SettingsPayload {
                settings: BackendSettings::default(),
                settings_path,
                user_scripts: user_script_inventory(),
            },
        )),
    }
}

fn fallback_settings_payload() -> SettingsPayload {
    SettingsPayload {
        settings: SettingsStore::default().load().unwrap_or_default(),
        settings_path: codex_plus_core::paths::default_settings_path()
            .to_string_lossy()
            .to_string(),
        user_scripts: user_script_inventory(),
    }
}

fn user_script_inventory() -> Value {
    default_user_script_manager()
        .inventory()
        .unwrap_or_else(|error| {
            json!({
                "enabled": true,
                "scripts": [],
                "error": error.to_string()
            })
        })
}

fn failed_script_market_payload(message: &str) -> ScriptMarketPayload {
    ScriptMarketPayload {
        market: json!({
            "status": "failed",
            "message": message,
            "indexUrl": script_market::DEFAULT_MARKET_INDEX_URL,
            "updatedAt": "",
            "scripts": []
        }),
        user_scripts: user_script_inventory(),
    }
}

fn script_market_payload_from_manifest(
    manifest: &ScriptMarketManifest,
    status: &str,
    message: &str,
) -> ScriptMarketPayload {
    let user_scripts = user_script_inventory();
    let installed = installed_market_versions(&user_scripts);
    let scripts = manifest
        .scripts
        .iter()
        .map(|script| market_script_payload(script, &installed))
        .collect::<Vec<_>>();
    ScriptMarketPayload {
        market: json!({
            "status": status,
            "message": message,
            "indexUrl": script_market::DEFAULT_MARKET_INDEX_URL,
            "updatedAt": manifest.updated_at.clone().unwrap_or_default(),
            "scripts": scripts
        }),
        user_scripts,
    }
}

fn installed_market_versions(user_scripts: &Value) -> BTreeMap<String, String> {
    user_scripts
        .get("scripts")
        .and_then(Value::as_array)
        .map(|scripts| {
            scripts
                .iter()
                .filter_map(|script| {
                    let id = script.get("market_id").and_then(Value::as_str)?;
                    if id.is_empty() {
                        return None;
                    }
                    let version = script
                        .get("version")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    Some((id.to_string(), version))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn market_script_payload(script: &MarketScript, installed: &BTreeMap<String, String>) -> Value {
    let installed_version = installed.get(&script.id).cloned().unwrap_or_default();
    let is_installed = !installed_version.is_empty();
    json!({
        "id": script.id,
        "name": script.name,
        "description": script.description,
        "version": script.version,
        "author": script.author,
        "tags": script.tags,
        "homepage": script.homepage,
        "script_url": script.script_url,
        "sha256": script.sha256,
        "installed": is_installed,
        "installedVersion": installed_version,
        "updateAvailable": is_installed && installed.get(&script.id).map(|version| version != &script.version).unwrap_or(false)
    })
}

fn default_user_script_manager() -> UserScriptManager {
    let config_dir = user_scripts_config_dir();
    UserScriptManager::new(
        builtin_user_scripts_dir(),
        config_dir.join("user_scripts"),
        config_dir.join("user_scripts.json"),
    )
}

fn user_scripts_config_dir() -> PathBuf {
    if cfg!(windows) {
        if let Some(roaming) = std::env::var_os("APPDATA") {
            return PathBuf::from(roaming).join("LDCodex");
        }
    }
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| directories::BaseDirs::new().map(|dirs| dirs.home_dir().join(".config")))
        .unwrap_or_else(|| PathBuf::from(".config"))
        .join("LDCodex")
}

fn builtin_user_scripts_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .map(|path| path.join("user_scripts"))
        .unwrap_or_else(|| PathBuf::from("user_scripts"))
}

fn diagnostics_report() -> String {
    let (codex_app_path, entrypoints, latest_launch) = load_overview_payload();
    let overview = ok(
        "姒傝宸插姞杞姐€?,
        OverviewPayload {

            latest_launch,
            current_version: codex_plus_core::version::VERSION.to_string(),
            update_status: "not_checked".to_string(),
            settings_path: codex_plus_core::paths::default_settings_path()
                .to_string_lossy()
                .to_string(),
            logs_path: codex_plus_core::paths::default_diagnostic_log_path()
                .to_string_lossy()
                .to_string(),
        },
    );
    let settings = SettingsStore::default().load().unwrap_or_default();
    let generated_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    serde_json::to_string_pretty(&json!({
        "generatedAtMs": generated_at_ms,
        "version": codex_plus_core::version::VERSION,
        "overview": overview.payload,
        "settings": settings,
        "logs": {
            "diagnosticLogPath": codex_plus_core::paths::default_diagnostic_log_path(),
            "latestStatusPath": codex_plus_core::paths::default_latest_status_path()
        },
        "platform": {
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH
        }
    }))
    .unwrap_or_else(|error| format!("璇婃柇鎶ュ憡搴忓垪鍖栧け璐ワ細{error}"))
}

fn load_overview_payload() -> (
    Option<PathBuf>,
    install::EntryPointState,
    Option<LaunchStatus>,
) {
    let settings = SettingsStore::default().load().unwrap_or_default();
    (
        codex_plus_core::app_paths::resolve_codex_app_dir_with_saved(
            None,
            Some(settings.codex_app_path.as_str()),
        ),
        install::inspect_entrypoints(),
        StatusStore::default().load_latest().unwrap_or(None),
    )
}

fn install_background_failure(action: &str, error: impl std::fmt::Display) -> InstallActionResult {
    let state = install::inspect_entrypoints();
    InstallActionResult {
        status: "failed".to_string(),
        message: format!("{action}鍚庡彴浠诲姟澶辫触锛歿error}"),
        silent_shortcut: state.silent_shortcut,
        management_shortcut: state.management_shortcut,
    }
}

fn watcher_payload() -> WatcherPayload {
    let flag = codex_plus_core::watcher::default_watcher_disabled_flag();
    WatcherPayload {
        enabled: !flag.exists(),
        disabled_flag: flag.to_string_lossy().to_string(),
    }
}

fn read_tail(path: &Path, max_lines: usize) -> std::io::Result<String> {
    let contents = fs::read_to_string(path)?;
    let mut lines = contents.lines().rev().take(max_lines).collect::<Vec<_>>();
    lines.reverse();
    Ok(lines.join("\n"))
}

fn path_state(path: Option<PathBuf>) -> PathState {
    match path {
        Some(path) => PathState {
            status: "found".to_string(),
            path: Some(path.to_string_lossy().to_string()),
        },
        None => PathState {
            status: "missing".to_string(),
            path: None,
        },
    }
}

fn shortcut_state(shortcut: install::ShortcutState) -> PathState {
    PathState {
        status: if shortcut.installed {
            "installed".to_string()
        } else {
            "missing".to_string()
        },
        path: shortcut.path,
    }
}

fn ok<T: Serialize>(message: &str, payload: T) -> CommandResult<T> {
    CommandResult {
        status: "ok".to_string(),
        message: message.to_string(),
        payload,
    }
}

fn failed<T: Serialize>(message: &str, payload: T) -> CommandResult<T> {
    CommandResult {
        status: "failed".to_string(),
        message: message.to_string(),
        payload,
    }
}

fn default_debug_port() -> u16 {
    9229
}

fn default_helper_port() -> u16 {
    57321
}

fn default_log_lines() -> usize {
    200
}


// 鈹€鈹€ Bridge (LuoDaBridge) process management 鈹€鈹€
static BRIDGE_CHILD: std::sync::Mutex<Option<std::process::Child>> = std::sync::Mutex::new(None);

#[derive(Debug, Clone, Serialize)]
pub struct BridgeStatusPayload {
    pub running: bool,
    pub port: u16,
    pub message: String,
}

#[tauri::command]
pub fn start_bridge(port: Option<u16>) -> CommandResult<BridgeStatusPayload> {
    let port = port.unwrap_or(37000);
    let exe = std::env::current_exe().unwrap_or_default();
    let exe_dir = exe.parent().unwrap_or(std::path::Path::new("."));
    let bridge_paths = [
        exe_dir.join("bridge").join("index.mjs"),
        exe_dir.join(r"..\bridge\index.mjs"),
        exe_dir.join(r"..\..\..\bridge\index.mjs"),
        std::path::PathBuf::from(r"J:\codex-work\LDCodex2\bridge\index.mjs"),
    ];
    let bridge_path = bridge_paths.iter().find(|p| p.exists()).cloned();
    let Some(bridge_path) = bridge_path else {
        return failed("鏈壘鍒癰ridge/index.mjs", BridgeStatusPayload { running: false, port, message: "bridge鐩綍涓嶅瓨鍦?.into() });
    };

    let mut guard = BRIDGE_CHILD.lock().unwrap();
    if guard.as_mut().map(|c| c.try_wait().unwrap_or(None).is_none()).unwrap_or(false) {
        return ok("浠ｇ悊鏈嶅姟鍣ㄥ凡鍦ㄨ繍琛屼腑", BridgeStatusPayload { running: true, port, message: "宸插湪杩愯".into() });
    }

    match std::process::Command::new("node")
        .arg(bridge_path.as_os_str())
        .current_dir(bridge_path.parent().unwrap_or(std::path::Path::new(".")))
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(child) => {
            *guard = Some(child);
            ok("浠ｇ悊鏈嶅姟鍣ㄥ凡鍚姩", BridgeStatusPayload { running: true, port, message: "宸插惎鍔?.into() })
        }
        Err(e) => {
            failed(&format!("鍚姩浠ｇ悊鏈嶅姟鍣ㄥけ璐? {e}"), BridgeStatusPayload { running: false, port, message: e.to_string() })
        }
    }
}

#[tauri::command]
pub fn stop_bridge() -> CommandResult<BridgeStatusPayload> {
    let mut guard = BRIDGE_CHILD.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
        ok("浠ｇ悊鏈嶅姟鍣ㄥ凡鍋滄", BridgeStatusPayload { running: false, port: 37000, message: "宸插仠姝?.into() })
    } else {
        ok("浠ｇ悊鏈嶅姟鍣ㄦ湭鍦ㄨ繍琛?, BridgeStatusPayload { running: false, port: 37000, message: "鏈繍琛?.into() })
    }
}

#[tauri::command]
pub fn bridge_status() -> CommandResult<BridgeStatusPayload> {
    let mut guard = BRIDGE_CHILD.lock().unwrap();
    let running = guard.as_mut().map(|c| c.try_wait().unwrap_or(None).is_none()).unwrap_or(false);
    if !running {
        *guard = None;
    }
    let msg = if running { "杩愯涓? } else { "宸插仠姝? };
    ok(msg, BridgeStatusPayload { running, port: 37000, message: msg.into() })
}

#[tauri::command]
pub fn read_bridge_logs() -> CommandResult<LogsPayload> {
    let log_paths = [
        std::path::PathBuf::from(r"J:\codex-work\LDCodex2\bridge\dataluoda.log"),
        std::path::PathBuf::from(r"J:\codex-work\LDCodex2\bridge\bridge.log"),
    ];
    for path in &log_paths {
        if path.exists() {
            match read_tail(&path, 200) {
                Ok(text) => return ok("鏃ュ織宸茶鍙?, LogsPayload { text, path: path.to_string_lossy().to_string(), lines: 0 }),
                Err(e) => return failed(&format!("璇诲彇鏃ュ織澶辫触: {e}"), LogsPayload { text: String::new(), path: path.to_string_lossy().to_string(), lines: 0 }),
            }
        }
    }
    ok("鏆傛棤鏃ュ織", LogsPayload { text: String::new(), path: String::new(), lines: 0 })
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_version_returns_structured_payload() {
        let result = backend_version();

        assert_eq!(result.status, "ok");
        assert!(!result.payload.version.is_empty());
    }

    #[test]
    fn startup_options_returns_structured_payload() {
        let result = startup_options();

        assert_eq!(result.status, "ok");
    }

    #[test]
    fn startup_options_honors_show_update_environment() {
        unsafe {
            std::env::set_var("CODEX_PLUS_SHOW_UPDATE", "1");
        }

        let result = startup_options();

        unsafe {
            std::env::remove_var("CODEX_PLUS_SHOW_UPDATE");
        }

        assert_eq!(result.status, "ok");
        assert!(result.payload.show_update);
    }

    #[test]
    fn startup_options_honors_show_update_argument() {
        assert!(should_show_update(
            ["ldcodex-manager.exe", "--show-update"],
            None
        ));
    }

    #[test]
    fn overview_contains_expected_operational_fields() {
        let result = load_overview_sync();

        assert_eq!(result.status, "ok");
        assert!(!result.payload.current_version.is_empty());
        assert!(

            "installed" | "missing"
        ));
    }

    #[test]
    fn update_install_requires_release_payload() {
        let result = tauri::async_runtime::block_on(perform_update(None));

        assert_eq!(result.status, "failed");
        assert!(result.message.contains("鍗囩骇鍔熻兘宸茬鐢?));
    }

    #[test]
    fn watcher_state_returns_disabled_flag_path() {
        let result = load_watcher_state();

        assert_eq!(result.status, "ok");
        assert!(result.payload.disabled_flag.contains("watcher.disabled"));
    }

    #[test]
    fn missing_logs_return_failed_status() {
        let result = read_latest_logs(LogRequest { lines: 25 });

        if result.payload.text.is_empty() {
            assert_eq!(result.status, "failed");
        }
    }

    #[test]
    fn relay_payload_does_not_expose_token_text() {
        let payload = relay_payload(
            codex_plus_core::relay_config::RelayStatus {
                authenticated: true,
                auth_source: "registry.json".to_string(),
                account_label: Some("user@example.test".to_string()),
                config_path: "config.toml".to_string(),
                configured: true,
                requires_openai_auth: true,
                has_bearer_token: true,
            },
            None,
        );
        let text = serde_json::to_string(&payload).unwrap();

        assert!(!text.contains("sk-"));
        assert!(text.contains("hasBearerToken"));
    }

    #[test]
    fn relay_files_payload_reads_config_and_auth_contents() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path().join("config.toml"),
            "model_provider = \"custom\"\n",
        )
        .unwrap();
        std::fs::write(
            temp.path().join("auth.json"),
            "{\"OPENAI_API_KEY\":\"sk-test\"}\n",
        )
        .unwrap();

        let payload = relay_files_payload_from_home(temp.path()).unwrap();

        assert!(payload.config_path.ends_with("config.toml"));
        assert!(payload.auth_path.ends_with("auth.json"));
        assert_eq!(payload.config_contents, "model_provider = \"custom\"\n");
        assert_eq!(payload.auth_contents, "{\"OPENAI_API_KEY\":\"sk-test\"}\n");
    }

    #[test]
    fn delete_local_session_falls_back_when_requested_db_no_longer_contains_thread() {
        let temp = tempfile::tempdir().unwrap();
        let previous_codex_home = std::env::var_os("CODEX_HOME");
        let codex_home = temp.path().join("codex-home");
        let sqlite_dir = codex_home.join("sqlite");
        std::fs::create_dir_all(&sqlite_dir).unwrap();
        let stale_db = sqlite_dir.join("codex-dev.db");
        let active_db = sqlite_dir.join("state_5.sqlite");
        let rollout_path = temp.path().join("rollout.jsonl");
        std::fs::write(&rollout_path, "{\"type\":\"message\"}\n").unwrap();
        let stale = rusqlite::Connection::open(&stale_db).unwrap();
        stale
            .execute(
                "CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, title TEXT)",
                [],
            )
            .unwrap();
        drop(stale);
        let active = rusqlite::Connection::open(&active_db).unwrap();
        active
            .execute(
                "CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, title TEXT)",
                [],
            )
            .unwrap();
        active
            .execute(
                "INSERT INTO threads VALUES ('t1', ?1, 'Active Thread')",
                [rollout_path.to_string_lossy().to_string()],
            )
            .unwrap();
        drop(active);

        unsafe {
            std::env::set_var("CODEX_HOME", &codex_home);
        }
        let result = delete_local_session(DeleteLocalSessionRequest {
            session_id: "t1".to_string(),
            title: "Active Thread".to_string(),
            db_path: Some(stale_db.to_string_lossy().to_string()),
        });
        unsafe {
            if let Some(value) = previous_codex_home {
                std::env::set_var("CODEX_HOME", value);
            } else {
                std::env::remove_var("CODEX_HOME");
            }
        }

        assert_eq!(result.status, "ok");
        assert_eq!(
            result.payload.status,
            codex_plus_core::models::DeleteStatus::LocalDeleted
        );
        let active = rusqlite::Connection::open(&active_db).unwrap();
        assert_eq!(
            active
                .query_row("SELECT COUNT(*) FROM threads WHERE id = 't1'", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );
    }

    #[test]
    fn list_local_sessions_deduplicates_threads_across_current_and_legacy_dbs() {
        let temp = tempfile::tempdir().unwrap();
        let previous_codex_home = std::env::var_os("CODEX_HOME");
        let codex_home = temp.path().join("codex-home");
        let sqlite_dir = codex_home.join("sqlite");
        std::fs::create_dir_all(&sqlite_dir).unwrap();
        let current_db = sqlite_dir.join("state_5.sqlite");
        let legacy_db = codex_home.join("state_5.sqlite");
        create_minimal_thread_db(&current_db, "t1", "Current Copy", 100);
        create_minimal_thread_db(&legacy_db, "t1", "Legacy Copy", 200);

        unsafe {
            std::env::set_var("CODEX_HOME", &codex_home);
        }
        let result = list_local_sessions();
        restore_codex_home(previous_codex_home);

        assert_eq!(result.status, "ok");
        assert_eq!(result.payload.sessions.len(), 1);
        assert_eq!(result.payload.sessions[0].id, "t1");
        assert_eq!(result.payload.sessions[0].title, "Legacy Copy");
        assert_eq!(
            result.payload.sessions[0].db_path,
            legacy_db.to_string_lossy()
        );
    }

    #[test]
    fn delete_local_session_removes_duplicate_threads_from_all_candidate_dbs() {
        let temp = tempfile::tempdir().unwrap();
        let previous_codex_home = std::env::var_os("CODEX_HOME");
        let codex_home = temp.path().join("codex-home");
        let sqlite_dir = codex_home.join("sqlite");
        std::fs::create_dir_all(&sqlite_dir).unwrap();
        let current_db = sqlite_dir.join("state_5.sqlite");
        let legacy_db = codex_home.join("state_5.sqlite");
        create_minimal_thread_db(&current_db, "t1", "Current Copy", 100);
        create_minimal_thread_db(&legacy_db, "t1", "Legacy Copy", 200);

        unsafe {
            std::env::set_var("CODEX_HOME", &codex_home);
        }
        let result = delete_local_session(DeleteLocalSessionRequest {
            session_id: "t1".to_string(),
            title: "Legacy Copy".to_string(),
            db_path: Some(legacy_db.to_string_lossy().to_string()),
        });
        restore_codex_home(previous_codex_home);

        assert_eq!(result.status, "ok");
        assert_eq!(thread_count(&current_db, "t1"), 0);
        assert_eq!(thread_count(&legacy_db, "t1"), 0);
    }

    fn create_minimal_thread_db(path: &Path, id: &str, title: &str, updated_at_ms: i64) {
        let db = rusqlite::Connection::open(path).unwrap();
        db.execute(
            "CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, title TEXT, updated_at_ms INTEGER)",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO threads VALUES (?1, '', ?2, ?3)",
            (id, title, updated_at_ms),
        )
        .unwrap();
    }

    fn thread_count(path: &Path, id: &str) -> i64 {
        let db = rusqlite::Connection::open(path).unwrap();
        db.query_row("SELECT COUNT(*) FROM threads WHERE id = ?1", [id], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap()
    }

    fn restore_codex_home(previous: Option<std::ffi::OsString>) {
        unsafe {
            if let Some(value) = previous {
                std::env::set_var("CODEX_HOME", value);
            } else {
                std::env::remove_var("CODEX_HOME");
            }
        }
    }

    #[test]
    fn apply_relay_profile_to_home_with_switch_rules_preserves_custom_provider_id() {
        let temp = tempfile::tempdir().unwrap();
        let profile = RelayProfile {
            relay_mode: codex_plus_core::settings::RelayMode::PureApi,
            protocol: codex_plus_core::settings::RelayProtocol::Responses,
            config_contents: "model_provider = \"ai\"\nmodel = \"gpt-image-2\"\n\n[model_providers.ai]\nname = \"ai\"\nwire_api = \"responses\"\nrequires_openai_auth = true\nbase_url = \"https://ahg.codes\"\n"
                .to_string(),
            auth_contents: "{}\n".to_string(),
            ..RelayProfile::default()
        };

        codex_plus_core::relay_config::apply_relay_profile_to_home_with_switch_rules(
            temp.path(),
            &profile,
            "",
        )
        .unwrap();

        let applied = std::fs::read_to_string(temp.path().join("config.toml")).unwrap();
        assert!(applied.contains("model_provider = \"ai\""));
        assert!(applied.contains("[model_providers.ai]"));
        assert!(!applied.contains("[model_providers.custom]"));
    }

    #[test]
    fn save_relay_file_in_home_only_allows_known_files() {
        let temp = tempfile::tempdir().unwrap();

        save_relay_file_in_home(temp.path(), "config", "model = \"gpt-5\"\n").unwrap();
        save_relay_file_in_home(temp.path(), "auth", "{}\n").unwrap();

        assert_eq!(
            std::fs::read_to_string(temp.path().join("config.toml")).unwrap(),
            "model = \"gpt-5\"\n"
        );
        assert_eq!(
            std::fs::read_to_string(temp.path().join("auth.json")).unwrap(),
            "{}\n"
        );
        assert!(save_relay_file_in_home(temp.path(), "../bad", "").is_err());
    }

    #[test]
    fn normalize_settings_before_save_preserves_profile_context_until_manual_extract() {
        let settings = BackendSettings {
            relay_common_config_contents: "[mcp_servers.context7]\ncommand = \"npx\"\n".to_string(),
            relay_profiles: vec![RelayProfile {
                use_common_config: false,
                relay_mode: codex_plus_core::settings::RelayMode::PureApi,
                config_contents: "model = \"gpt-5\"\n\n[mcp_servers.context7]\ncommand = \"npx\"\n"
                    .to_string(),
                ..RelayProfile::default()
            }],
            ..BackendSettings::default()
        };

        let normalized = normalize_settings_before_save(settings);

        assert!(
            normalized.relay_profiles[0]
                .config_contents
                .contains("model = \"gpt-5\"")
        );
        assert!(
            normalized.relay_profiles[0]
                .config_contents
                .contains("[mcp_servers.context7]")
        );
        assert!(
            normalized
                .relay_context_config_contents
                .contains("[mcp_servers.context7]")
        );
        assert!(
            !normalized
                .relay_common_config_contents
                .contains("[mcp_servers")
        );
    }

    #[test]
    fn normalize_settings_before_save_preserves_official_profile_auth() {
        let settings = BackendSettings {
            relay_profiles: vec![RelayProfile {
                relay_mode: codex_plus_core::settings::RelayMode::Official,
                official_mix_api_key: false,
                auth_contents: r#"{"auth_mode":"chatgpt","tokens":{"access_token":"edited"}}"#
                    .to_string(),
                config_contents: "model_provider = \"custom\"\n".to_string(),
                ..RelayProfile::default()
            }],
            ..BackendSettings::default()
        };

        let normalized = normalize_settings_before_save(settings);

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&normalized.relay_profiles[0].auth_contents)
                .unwrap(),
            serde_json::json!({"auth_mode":"chatgpt","tokens":{"access_token":"edited"}})
        );
        assert!(normalized.relay_profiles[0].config_contents.is_empty());
    }

    #[test]
    fn normalize_settings_before_save_strips_common_from_enabled_profile() {
        let settings = BackendSettings {
            relay_common_config_contents: r#"model_reasoning_effort = "high"

[features]
goals = true

[plugins."superpowers@openai-curated"]
enabled = true
"#
            .to_string(),
            relay_profiles: vec![RelayProfile {
                use_common_config: true,
                relay_mode: codex_plus_core::settings::RelayMode::PureApi,
                config_contents: r#"model = "gpt-5"
model_reasoning_effort = "high"

[features]
goals = true
model_reasoning_effort = "high"

[plugins."superpowers@openai-curated"]
enabled = true
"#
                .to_string(),
                ..RelayProfile::default()
            }],
            ..BackendSettings::default()
        };

        let normalized = normalize_settings_before_save(settings);
        let config = &normalized.relay_profiles[0].config_contents;

        assert!(config.contains("model = \"gpt-5\""));
        assert!(!config.contains("model_reasoning_effort"));
        assert!(!config.contains("[features]"));
        assert!(!config.contains("[plugins.\"superpowers@openai-curated\"]"));
    }

    #[test]
    fn normalize_settings_before_save_repairs_invalid_profile_common_duplication() {
        let settings = BackendSettings {
            relay_common_config_contents: r#"model_reasoning_effort = "high"

[marketplaces.openai-bundled]
last_updated = "2026-05-25T11:52:46Z"
"#
            .to_string(),
            relay_profiles: vec![RelayProfile {
                use_common_config: true,
                relay_mode: codex_plus_core::settings::RelayMode::PureApi,
                config_contents: r#"model = "gpt-5"
model_reasoning_effort = "high"

[marketplaces.openai-bundled]
last_updated = "2026-05-25T11:52:46Z"

[marketplaces.openai-bundled]
last_updated = "2026-05-25T11:52:46Z"
"#
                .to_string(),
                ..RelayProfile::default()
            }],
            ..BackendSettings::default()
        };

        let normalized = normalize_settings_before_save(settings);
        let config = &normalized.relay_profiles[0].config_contents;

        assert!(config.contains("model = \"gpt-5\""));
        assert!(!config.contains("model_reasoning_effort"));
        assert!(!config.contains("[marketplaces.openai-bundled]"));
    }

    #[test]
    fn normalize_settings_before_save_removes_model_catalog_from_common_config() {
        let settings = BackendSettings {
            relay_common_config_contents: r#"model_catalog_json = "C:\\Users\\Administrator\\.codex\\model-catalogs\\relay-a.json"
model_catalog_json = 'C:\Users\Administrator\.codex\model-catalogs\relay-b.json'
model_reasoning_effort = "high"
"#
            .to_string(),
            ..BackendSettings::default()
        };

        let normalized = normalize_settings_before_save(settings);

        assert!(
            !normalized
                .relay_common_config_contents
                .contains("model_catalog_json")
        );
        assert!(
            normalized
                .relay_common_config_contents
                .contains("model_reasoning_effort = \"high\"")
        );
    }

    #[test]
    fn context_entry_commands_update_settings_payload() {
        let settings = BackendSettings::default();
        let upsert = upsert_context_entry(ContextEntryRequest {
            settings: settings.clone(),
            kind: "mcp".to_string(),
            id: "context7".to_string(),
            toml_body: "command = \"npx\"\n".to_string(),
        });

        assert_eq!(upsert.status, "ok");
        assert!(
            upsert
                .payload
                .settings
                .relay_context_config_contents
                .contains("[mcp_servers.context7]")
        );

        let listed = list_context_entries(ContextSettingsRequest {
            settings: upsert.payload.settings.clone(),
        });
        assert_eq!(listed.payload.entries.mcp_servers[0].id, "context7");

        let deleted = delete_context_entry(ContextDeleteRequest {
            settings: upsert.payload.settings,
            kind: "mcp".to_string(),
            id: "context7".to_string(),
        });
        assert_eq!(deleted.status, "ok");
        assert!(
            !deleted
                .payload
                .settings
                .relay_context_config_contents
                .contains("[mcp_servers.context7]")
        );
    }

    #[test]
    fn open_external_url_rejects_non_http_urls() {
        let result = open_external_url("file:///C:/Windows/win.ini".to_string());

        assert_eq!(result.status, "failed");
        assert!(result.message.contains("鍙厑璁告墦寮€ http 鎴?https 閾炬帴"));
    }
}

