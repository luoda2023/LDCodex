//! LDCodex —— WorkBuddy 增强的服务端支撑。
//!
//! 设计原则：**内部复杂，客户简单**。
//!
//! 客户在界面上只看到「启动 / 停止 / 让增强生效」三个动作；至于 Node 运行时在哪、
//! 守护进程怎么拉起来、日志写到哪里、端口有没有起来、WorkBuddy 装在哪、CDP 有没有
//! 连上 —— 全部在这里替客户兜住。
//!
//! 运行时本体是 `src-tauri/workbuddy-runtime`（CommonJS，随安装包分发），只有它需要
//! 一个 Node 可执行文件；这里按「随包 node → 环境变量 → PATH」的顺序解析，并给出
//! 可诊断的失败原因，而不是让客户面对一个"未运行"的空界面。
//!
//! ## 双档案（国内版 / 国际版）
//!
//! WorkBuddy 桌面端有两个互不相干的发行版：
//!
//! | 档案 | 运行时 profile | 界面端口 | CDP 端口 | 客户端 |
//! |------|----------------|----------|----------|--------|
//! | 国内版 | `workbuddy-cn` | 47832 | 9222 | `WorkBuddy.exe` |
//! | 国际版 | `workbuddy-ai` | 47833 | 9223 | `WorkBuddyAI.exe` |
//!
//! 两者**完全独立**：各自的守护进程、数据目录、账号/模型文件、CDP 通道互不影响，
//! 可以同时运行。界面侧对应两个平级的菜单项，本模块用 [`WorkBuddyProfile`] 把
//! 这些差异收在一处，命令统一多带一个 `profile` 参数。
//!
//! 本模块不做任何外部网络请求：所有通信都走 127.0.0.1 上的本地守护进程。

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

/// 运行时目录名（相对资源目录 / 开发时的 crate 目录）。
const RUNTIME_DIR_NAME: &str = "workbuddy-runtime";
/// 守护进程数据目录名（位于 `%APPDATA%` 下，与运行时 `sharedDataDir()` 一致）。
const DATA_DIR_NAME: &str = "LDCodex-WorkBuddy";
/// 守护进程启动后等待其监听端口的最长时间。
const START_TIMEOUT: Duration = Duration::from_secs(25);

/* ─────────────────────────── 档案定义 ─────────────────────────── */

/// WorkBuddy 桌面端发行版档案。
///
/// 与运行时 `workbuddy-runtime/profiles.js` + `ui-port.js` 的约定一一对应：
/// 端口不是这里"发明"的，而是照着运行时已有的分配抄下来的（国内 47832/9222、
/// 国际 47833/9223），这样管理器拉起的守护进程与运行时自启动时落在同一个端口。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkBuddyProfile {
    /// WorkBuddy 国内版（运行时 profile `workbuddy-cn`）。
    Cn,
    /// WorkBuddy 国际版（运行时 profile `workbuddy-ai`）。
    Intl,
}

impl Default for WorkBuddyProfile {
    fn default() -> Self {
        Self::Cn
    }
}

impl WorkBuddyProfile {
    /// 全部档案（界面按此顺序渲染菜单）。
    pub const ALL: [WorkBuddyProfile; 2] = [Self::Cn, Self::Intl];

    /// 从界面传来的字符串解析档案；未知值返回 `None`。
    pub fn from_id(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "" | "cn" | "workbuddy-cn" => Some(Self::Cn),
            "ai" | "intl" | "workbuddy-ai" => Some(Self::Intl),
            _ => None,
        }
    }

    /// 解析可选参数：缺省或非法时回落到国内版（保持旧行为可预测）。
    pub fn resolve(value: Option<&str>) -> Self {
        value.and_then(Self::from_id).unwrap_or_default()
    }

    /// 运行时 profile 标识（同时作为命令返回给界面的稳定 id）。
    pub fn id(self) -> &'static str {
        match self {
            Self::Cn => "workbuddy-cn",
            Self::Intl => "workbuddy-ai",
        }
    }

    /// 面向客户的中文名（菜单与提示文案都用它）。
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Cn => "WorkBuddy 国内版",
            Self::Intl => "WorkBuddy 国际版",
        }
    }

    /// 守护进程 Web 界面 / 本地 API 端口。
    pub fn ui_port(self) -> u16 {
        match self {
            Self::Cn => 47832,
            Self::Intl => 47833,
        }
    }

    /// WorkBuddy 客户端 CDP 调试端口。
    pub fn cdp_port(self) -> u16 {
        match self {
            Self::Cn => 9222,
            Self::Intl => 9223,
        }
    }

    /// 安装目录名（`%LOCALAPPDATA%\Programs\<install_dir>`）。
    fn install_dir(self) -> &'static str {
        match self {
            Self::Cn => "WorkBuddy",
            Self::Intl => "WorkBuddyAI",
        }
    }

    /// 客户端可执行文件名。
    fn exe_name(self) -> &'static str {
        match self {
            Self::Cn => "WorkBuddy.exe",
            Self::Intl => "WorkBuddyAI.exe",
        }
    }

    /// 客户端进程名（用于判断"是否正在运行"）。
    fn process_names(self) -> &'static [&'static str] {
        match self {
            Self::Cn => &["workbuddy.exe"],
            Self::Intl => &["workbuddyai.exe"],
        }
    }

    /// 客户端候选安装位置。
    fn binary_candidates(self) -> Vec<PathBuf> {
        let mut candidates = Vec::new();
        if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            candidates.push(
                local
                    .join("Programs")
                    .join(self.install_dir())
                    .join(self.exe_name()),
            );
        }
        candidates
    }

    fn detect_binary(self) -> Option<PathBuf> {
        self.binary_candidates()
            .into_iter()
            .find(|candidate| candidate.is_file())
    }

    /// 该档案的守护进程数据目录。
    ///
    /// 与运行时 `profileDataDir()` 对齐：国内版落在共享根目录，其它档案各自一个
    /// 子目录（`profiles/<id>`）——账号备份、模型快照、锁文件因此天然隔离。
    pub fn data_dir(self) -> PathBuf {
        let root = default_data_dir();
        match self {
            Self::Cn => root,
            Self::Intl => root.join("profiles").join(self.id()),
        }
    }
}

/// 由本模块启动的守护进程句柄（按档案分别持有）。
///
/// 之所以自己持有句柄：客户点「停止」时能立刻停干净；即使句柄丢了（比如管理器重启过），
/// 仍然可以退化到读锁文件里的 pid 去停，不会出现"停不掉"的死角。
#[derive(Default)]
pub struct WorkBuddyRuntimeState {
    children: Mutex<HashMap<String, Child>>,
}

impl WorkBuddyRuntimeState {
    fn take(&self, profile: WorkBuddyProfile) -> Option<Child> {
        self.children
            .lock()
            .ok()
            .and_then(|mut map| map.remove(profile.id()))
    }

    fn store(&self, profile: WorkBuddyProfile, child: Child) {
        if let Ok(mut map) = self.children.lock() {
            // 同一档案重复启动时，旧句柄先丢弃（进程本身已由端口探测判定不在运行）。
            map.insert(profile.id().to_string(), child);
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkBuddyStatus {
    /// 守护进程是否已在监听。
    pub running: bool,
    pub port: u16,
    /// 当前档案的稳定标识（`workbuddy-cn` / `workbuddy-ai`）。
    pub profile: String,
    /// 当前档案的展示名（`WorkBuddy 国内版` / `WorkBuddy 国际版`）。
    pub profile_name: String,
    /// 本地 API 令牌，界面调用 `/api/*` 时必须带上；只在内存里传给本机界面。
    pub api_token: Option<String>,
    pub data_dir: String,
    /// 运行时目录（随包资源或开发目录），找不到时为 null。
    pub runtime_dir: Option<String>,
    /// 实际使用的 Node 可执行文件。
    pub node_path: Option<String>,
    /// WorkBuddy 客户端是否已安装。
    pub client_installed: bool,
    /// WorkBuddy 客户端是否正在运行。
    pub client_running: bool,
    pub cdp_port: u16,
    /// 桌面「WorkBuddy增强」图标是否存在。
    pub shortcut_installed: bool,
    /// 桌面图标的完整路径（存在或即将创建的位置）。
    pub shortcut_path: Option<String>,
    /// 当前管理器可执行文件路径（桌面图标就指向它）。
    pub manager_exe: Option<String>,
    /// 当前管理器是否以管理员身份运行（诊断用，正常安装不需要提权）。
    pub elevated: bool,
    /// 一句话说明当前状态（面向客户，可直接展示）。
    pub detail: String,
    /// 是否具备启动条件（Node + 运行时都在）。
    pub ready: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkBuddyActionResult {
    pub status: String,
    pub message: String,
    pub status_detail: WorkBuddyStatus,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkBuddyStopOptions {
    #[serde(default)]
    pub force: bool,
}

/* ─────────────────────────── 路径解析 ─────────────────────────── */

/// 资源目录下运行时可能出现的若干层级。
///
/// 打包器对 `bundle.resources` 的落盘层级在不同版本/配置下可能是
/// `<资源目录>/workbuddy-runtime/...`，也可能被打平到资源根目录。
/// 这里把两者都当候选，避免"装完找不到运行时"这种最难排查的故障。
fn runtime_dir_candidates<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join(RUNTIME_DIR_NAME));
        candidates.push(dir);
    }
    // 开发期：`tauri dev` 下资源目录不保证已拷贝，直接回落 crate 目录。
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest.join(RUNTIME_DIR_NAME));
    candidates.push(manifest);
    candidates
}

fn resolve_runtime_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    runtime_dir_candidates(app)
        .into_iter()
        .find(|dir| dir.join("daemon.js").is_file())
}

fn node_dir_candidates<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("node"));
        candidates.push(dir.join("resources").join("node"));
        candidates.push(dir);
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest.join("resources").join("node"));
    candidates.push(manifest.join("node"));
    candidates
}

/// Node 可执行文件解析顺序：随包 node → `LDCODEX_NODE_EXE` → PATH。
///
/// 随包优先，是为了让客户"装完就能用"，不依赖他自己装过 Node。
fn resolve_node_binary<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let file_name = if cfg!(windows) { "node.exe" } else { "node" };
    for dir in node_dir_candidates(app) {
        let candidate = dir.join(file_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if let Some(explicit) = std::env::var_os("LDCODEX_NODE_EXE") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Some(path);
        }
    }
    find_executable_on_path("node.exe").or_else(|| find_executable_on_path("node"))
}

fn find_executable_on_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// 守护进程数据目录根（与运行时 `sharedDataDir()` 保持一致）。
pub fn default_data_dir() -> PathBuf {
    if let Some(appdata) = std::env::var_os("APPDATA") {
        return PathBuf::from(appdata).join(DATA_DIR_NAME);
    }
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        return PathBuf::from(home)
            .join("AppData")
            .join("Roaming")
            .join(DATA_DIR_NAME);
    }
    std::env::temp_dir().join(DATA_DIR_NAME)
}

fn runtime_log_path(data_dir: &Path) -> PathBuf {
    data_dir.join("daemon-stdio.log")
}

fn lock_file_path(data_dir: &Path) -> PathBuf {
    data_dir.join(".daemon.lock")
}

fn api_token_path(data_dir: &Path) -> PathBuf {
    data_dir.join(".api-token")
}

/* ─────────────────────────── 进程/端口探测 ─────────────────────────── */

fn is_port_listening(port: u16) -> bool {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

fn read_api_token(data_dir: &Path) -> Option<String> {
    let content = std::fs::read_to_string(api_token_path(data_dir)).ok()?;
    let token = content.trim().to_string();
    if token.is_empty() { None } else { Some(token) }
}

fn read_cdp_port(data_dir: &Path, fallback: u16) -> u16 {
    let path = data_dir.join("cdp-port.json");
    let Ok(content) = std::fs::read_to_string(path) else {
        return fallback;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
        return fallback;
    };
    value
        .get("port")
        .and_then(|port| port.as_u64())
        .and_then(|port| u16::try_from(port).ok())
        .filter(|port| *port >= 1024)
        .unwrap_or(fallback)
}

fn read_lock_pid(data_dir: &Path) -> Option<u32> {
    let content = std::fs::read_to_string(lock_file_path(data_dir)).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&content).ok()?;
    parsed
        .get("pid")
        .and_then(|value| value.as_u64())
        .and_then(|value| u32::try_from(value).ok())
}

fn detect_client_binary(profile: WorkBuddyProfile) -> Option<PathBuf> {
    profile.detect_binary()
}

fn is_client_running(profile: WorkBuddyProfile) -> bool {
    #[cfg(windows)]
    {
        let names = profile.process_names();
        return codex_plus_core::windows_enumerate_processes()
            .iter()
            .any(|process| {
                let exe = process.exe_file.to_ascii_lowercase();
                names.iter().any(|name| exe == *name)
            });
    }

    #[cfg(not(windows))]
    {
        let _ = profile;
        false
    }
}

/* ─────────────────────────── 状态汇总 ─────────────────────────── */

fn build_status<R: Runtime>(app: &AppHandle<R>, profile: WorkBuddyProfile) -> WorkBuddyStatus {
    let data_dir = profile.data_dir();
    let runtime_dir = resolve_runtime_dir(app);
    let node_path = resolve_node_binary(app);
    let running = is_port_listening(profile.ui_port());
    let client_installed = detect_client_binary(profile).is_some();
    let client_running = is_client_running(profile);
    let shortcut = codex_plus_core::install::inspect_workbuddy_shortcut();

    let ready = runtime_dir.is_some() && node_path.is_some();
    let name = profile.display_name();
    let detail = if running {
        format!(
            "{name} 增强服务运行中，账号 / 主题 / 会话 / 模型 / 免打扰 / 自动化都可以直接在下面管理。"
        )
    } else if !ready {
        "缺少内嵌运行时，增强服务无法启动。请重新安装 LDCodex 安装包（完整包自带所需的 Node 运行时）。"
            .to_string()
    } else if !client_installed {
        format!("本机没有检测到 {name} 桌面客户端。装好它之后再回来点「启动增强服务」即可。")
    } else if client_running {
        format!("{name} 正在运行，但还没有开启调试通道。点「让增强生效」会自动重启它以打开调试通道。")
    } else {
        "条件就绪。点「启动增强服务」后所有增强能力即可使用。".to_string()
    };

    WorkBuddyStatus {
        running,
        port: profile.ui_port(),
        profile: profile.id().to_string(),
        profile_name: name.to_string(),
        api_token: if running {
            read_api_token(&data_dir)
        } else {
            None
        },
        data_dir: data_dir.to_string_lossy().to_string(),
        runtime_dir: runtime_dir.map(|path| path.to_string_lossy().to_string()),
        node_path: node_path.map(|path| path.to_string_lossy().to_string()),
        client_installed,
        client_running,
        // daemon 在端口冲突时会选择备用端口并写入 cdp-port.json；返回实际端口，
        // 避免双开时界面仍显示固定端口而误判另一版本抢占了 CDP。
        cdp_port: read_cdp_port(&data_dir, profile.cdp_port()),
        shortcut_installed: shortcut.installed,
        shortcut_path: shortcut
            .path
            .or_else(|| {
                codex_plus_core::install::workbuddy_shortcut_candidates()
                    .into_iter()
                    .next()
                    .map(|path| path.to_string_lossy().to_string())
            }),
        manager_exe: manager_exe_path().map(|path| path.to_string_lossy().to_string()),
        elevated: is_elevated(),
        detail,
        ready,
    }
}

/// 当前管理器可执行文件路径（桌面图标指向它，不用客户端额外去找安装目录）。
fn manager_exe_path() -> Option<PathBuf> {
    std::env::current_exe().ok()
}

/// 当前进程是否以管理员身份运行。
///
/// 只是给界面做诊断提示用：LDCodex 正常使用**不需要**提权，它以 `asInvoker`
/// 清单运行，桌面图标也不会弹 UAC。只有在客户自己勾了"以管理员身份运行"时才会为真。
fn is_elevated() -> bool {
    #[cfg(windows)]
    {
        // 复用运行时的探测思路：读取当前令牌的完整性级别。
        // 这里刻意不做缓存，因为用户可能中途以不同权限重启。
        return windows_token_is_elevated();
    }

    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(windows)]
fn windows_token_is_elevated() -> bool {
    // 退回最轻量的判断：由 `net session` 的成败间接反映管理员权限代价过高，
    // 因此直接用 Windows API 读令牌提权状态。
    use std::os::windows::process::CommandExt;
    // 说明：这里用 `whoami /groups` 的自带输出判断是高完整性/系统完整性，
    // 不依赖额外依赖，也不会弹窗。
    let mut command = Command::new("whoami");
    command
        .args(["/groups"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(codex_plus_core::windows_create_no_window());
    let Ok(output) = command.output() else {
        return false;
    };
    let text = String::from_utf8_lossy(&output.stdout);
    text.contains("S-1-16-12288") || text.contains("S-1-16-16384")
}

/* ─────────────────────────── 启动 / 停止 ─────────────────────────── */

fn spawn_daemon<R: Runtime>(
    app: &AppHandle<R>,
    profile: WorkBuddyProfile,
    node: &Path,
    runtime_dir: &Path,
    data_dir: &Path,
) -> anyhow::Result<Child> {
    std::fs::create_dir_all(data_dir)?;
    // 守护进程自己也写日志文件，这里再留一份 stdout/stderr，用于抓"进程还没来得及记日志就挂了"的情况。
    let stdio_log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(runtime_log_path(data_dir))?;
    let stderr_log = stdio_log.try_clone()?;

    let mut command = Command::new(node);
    command
        .arg("daemon.js")
        .current_dir(runtime_dir)
        // 档案：运行时按它选择客户端、域名、模型文件与端口。
        .env("WBSWITCH_PROFILE", profile.id())
        .env("WBSWITCH_DATA_DIR", data_dir)
        .env("WBSWITCH_PORT", profile.ui_port().to_string())
        .env("WBSWITCH_CDP_PORT", profile.cdp_port().to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdio_log))
        .stderr(Stdio::from(stderr_log));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 无控制台窗口：客户点一下不该看到黑框一闪。
        command.creation_flags(codex_plus_core::windows_create_no_window());
    }
    let _ = app;
    command
        .spawn()
        .map_err(|error| anyhow::anyhow!("无法启动增强服务：{error}"))
}

fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if is_port_listening(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

/* ─────────────────────────── 命令 ─────────────────────────── */

#[tauri::command]
pub fn workbuddy_runtime_status<R: Runtime>(
    app: AppHandle<R>,
    profile: Option<String>,
) -> WorkBuddyStatus {
    let profile = WorkBuddyProfile::resolve(profile.as_deref());
    build_status(&app, profile)
}

#[tauri::command]
pub fn workbuddy_start_runtime<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, WorkBuddyRuntimeState>,
    profile: Option<String>,
) -> WorkBuddyActionResult {
    let profile = WorkBuddyProfile::resolve(profile.as_deref());
    if is_port_listening(profile.ui_port()) {
        return ok("增强服务已经在运行。", build_status(&app, profile));
    }
    let Some(runtime_dir) = resolve_runtime_dir(&app) else {
        return fail(
            "缺少内嵌运行时目录（workbuddy-runtime）。请重新安装 LDCodex 完整安装包。",
            build_status(&app, profile),
        );
    };
    let Some(node) = resolve_node_binary(&app) else {
        return fail(
            "未找到可用的 Node 运行时。请重新安装 LDCodex 完整安装包（自带运行时），或设置 LDCODEX_NODE_EXE 指向 node.exe。",
            build_status(&app, profile),
        );
    };
    let data_dir = profile.data_dir();

    let child = match spawn_daemon(&app, profile, &node, &runtime_dir, &data_dir) {
        Ok(child) => child,
        Err(error) => return fail(&error.to_string(), build_status(&app, profile)),
    };
    state.store(profile, child);

    if wait_for_port(profile.ui_port(), START_TIMEOUT) {
        return ok("增强服务已启动。", build_status(&app, profile));
    }
    let tail = tail_of_log(&runtime_log_path(&data_dir));
    fail(
        &format!("增强服务启动超时（{START_TIMEOUT:?}）。{tail}"),
        build_status(&app, profile),
    )
}

#[tauri::command]
pub fn workbuddy_stop_runtime<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, WorkBuddyRuntimeState>,
    profile: Option<String>,
    options: Option<WorkBuddyStopOptions>,
) -> WorkBuddyActionResult {
    let profile = WorkBuddyProfile::resolve(profile.as_deref());
    let force = options.map(|value| value.force).unwrap_or(true);
    let data_dir = profile.data_dir();
    let port = profile.ui_port();

    // 1) 优先停我们自己拉起来的那一个。
    let mut stopped = false;
    if let Some(mut child) = state.take(profile) {
        #[cfg(windows)]
        {
            let _ = kill_process_tree(child.id(), force);
        }
        let _ = child.kill();
        let _ = child.wait();
        stopped = true;
    }

    // 2) 句柄丢了就退化成按锁文件里的 pid 停（例如管理器重启过）。
    if !stopped && let Some(pid) = read_lock_pid(&data_dir) {
        #[cfg(windows)]
        {
            let _ = kill_process_tree(pid, force);
        }
        stopped = true;
    }

    // 3) 兜底：确认端口确实已经释放。
    let deadline = Instant::now() + Duration::from_secs(8);
    while is_port_listening(port) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(200));
    }

    let status = build_status(&app, profile);
    if stopped && !status.running {
        ok("增强服务已停止。", status)
    } else if !status.running {
        ok("增强服务本来就没有运行。", status)
    } else {
        fail("增强服务仍在运行，可能有其它进程占用了端口。", status)
    }
}

/// 让 WorkBuddy 以调试模式重启，从而打开 CDP 通道（主题 / 免打扰 / 自动化等能力需要它）。
#[tauri::command]
pub fn workbuddy_launch_client<R: Runtime>(
    app: AppHandle<R>,
    profile: Option<String>,
    force: Option<bool>,
) -> WorkBuddyActionResult {
    let profile = WorkBuddyProfile::resolve(profile.as_deref());
    let name = profile.display_name();
    let Some(binary) = detect_client_binary(profile) else {
        return fail(
            &format!("没有找到 {name} 桌面客户端。请先安装它再回来启用增强。"),
            build_status(&app, profile),
        );
    };
    let force = force.unwrap_or(false);
    if !force && is_client_running(profile) {
        return fail(
            &format!("{name} 正在运行，需要重启一次才能打开调试通道。请确认后选择「重启并启用」。"),
            build_status(&app, profile),
        );
    }

    let mut command = Command::new(&binary);
    command
        // WorkBuddy / WorkBuddy AI 会在 argv 校验阶段拒绝
        // --remote-debugging-port=...；两个版本都只接受环境变量注入。
        .env("WORKBUDDY_REMOTE_DEBUGGING_PORT", profile.cdp_port().to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(codex_plus_core::windows_create_no_window());
    }
    match command.spawn() {
        Ok(_) => ok(
            &format!(
                "已用调试模式启动 {name}（端口 {}），增强功能会自动接上。",
                profile.cdp_port()
            ),
            build_status(&app, profile),
        ),
        Err(error) => fail(
            &format!("启动 {name} 失败：{error}"),
            build_status(&app, profile),
        ),
    }
}

/// 创建/刷新桌面「WorkBuddy增强」图标（幂等）。
#[tauri::command]
pub fn workbuddy_install_shortcut<R: Runtime>(
    app: AppHandle<R>,
    profile: Option<String>,
) -> WorkBuddyActionResult {
    let profile = WorkBuddyProfile::resolve(profile.as_deref());
    let result = codex_plus_core::install::install_workbuddy_shortcut();
    if result.status == "ok" {
        ok(&result.message, build_status(&app, profile))
    } else {
        fail(&result.message, build_status(&app, profile))
    }
}

/// 移除桌面「WorkBuddy增强」图标。
#[tauri::command]
pub fn workbuddy_uninstall_shortcut<R: Runtime>(
    app: AppHandle<R>,
    profile: Option<String>,
) -> WorkBuddyActionResult {
    let profile = WorkBuddyProfile::resolve(profile.as_deref());
    let result = codex_plus_core::install::uninstall_workbuddy_shortcut();
    if result.status == "ok" {
        ok(&result.message, build_status(&app, profile))
    } else {
        fail(&result.message, build_status(&app, profile))
    }
}

/// 以管理员身份重新启动管理器（只有客户明确点击时才调用）。
///
/// 重要：程序无法、也不应该去开关系统 UAC。系统 UAC 是需要管理员权限 + 重启的
/// 安全设置，静默改它属于恶意软件行为。程序能做的正当动作只有一个 —— 为自己
/// 这一次启动请求提权，由系统弹出 UAC 让客户自己决定。这个命令就是那个动作。
///
/// LDCodex 正常使用**不需要**提权：它以 `asInvoker` 清单运行，桌面图标不会弹 UAC。
/// 所以这是排障用的"逃生口"，不是常规路径。
#[tauri::command]
pub fn workbuddy_relaunch_elevated<R: Runtime>(
    app: AppHandle<R>,
    profile: Option<String>,
) -> WorkBuddyActionResult {
    let profile = WorkBuddyProfile::resolve(profile.as_deref());
    #[cfg(windows)]
    {
        let Some(exe) = manager_exe_path() else {
            return fail(
                "无法定位管理器可执行文件，提权重启已取消。",
                build_status(&app, profile),
            );
        };
        // 带上同样的路由参数，提权重启后客户仍然停在增强页面。
        let parameters = codex_plus_core::install::WORKBUDDY_ROUTE_ARGUMENT.to_string();
        match codex_plus_core::windows_run_as_admin(&exe, &parameters) {
            Ok(()) => ok(
                "已请求以管理员身份重新启动。请在系统提示（UAC）里选择「是」。",
                build_status(&app, profile),
            ),
            Err(error) => fail(&error.to_string(), build_status(&app, profile)),
        }
    }

    #[cfg(not(windows))]
    {
        fail("仅 Windows 支持提权重启。", build_status(&app, profile))
    }
}

/* ─────────────────────────── 小工具 ─────────────────────────── */

fn ok(message: &str, status: WorkBuddyStatus) -> WorkBuddyActionResult {
    WorkBuddyActionResult {
        status: "ok".to_string(),
        message: message.to_string(),
        status_detail: status,
    }
}

fn fail(message: &str, status: WorkBuddyStatus) -> WorkBuddyActionResult {
    WorkBuddyActionResult {
        status: "failed".to_string(),
        message: message.to_string(),
        status_detail: status,
    }
}

fn tail_of_log(path: &Path) -> String {
    let Ok(content) = std::fs::read_to_string(path) else {
        return String::new();
    };
    let tail: Vec<&str> = content.lines().rev().take(4).collect();
    if tail.is_empty() {
        return String::new();
    }
    let joined = tail.into_iter().rev().collect::<Vec<_>>().join(" / ");
    format!("最近日志：{joined}")
}

/// 结束进程树（守护进程可能带起 PowerShell 辅助进程）。
#[cfg(windows)]
fn kill_process_tree(pid: u32, force: bool) -> anyhow::Result<()> {
    let mut command = Command::new("taskkill");
    command.arg("/PID").arg(pid.to_string()).arg("/T");
    if force {
        command.arg("/F");
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command.status()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_dir_lives_under_roaming_appdata() {
        let dir = default_data_dir();
        let text = dir.to_string_lossy().to_string();
        assert!(
            text.ends_with(DATA_DIR_NAME),
            "unexpected data dir: {text}"
        );
    }

    #[test]
    fn profile_ids_ports_and_data_dirs_are_disjoint() {
        let cn = WorkBuddyProfile::Cn;
        let intl = WorkBuddyProfile::Intl;
        // 端口必须互不相同，否则两个档案会互相抢监听。
        assert_ne!(cn.ui_port(), intl.ui_port());
        assert_ne!(cn.cdp_port(), intl.cdp_port());
        // 数据目录必须隔离，否则账号 / 模型会串。
        assert_ne!(cn.data_dir(), intl.data_dir());
        assert!(intl
            .data_dir()
            .ends_with(Path::new("profiles").join("workbuddy-ai")));
        assert_eq!(cn.id(), "workbuddy-cn");
        assert_eq!(intl.id(), "workbuddy-ai");
    }

    #[test]
    fn profile_resolves_from_frontend_value_with_cn_default() {
        assert_eq!(
            WorkBuddyProfile::resolve(Some("workbuddy-ai")),
            WorkBuddyProfile::Intl
        );
        assert_eq!(
            WorkBuddyProfile::resolve(Some("workbuddy-cn")),
            WorkBuddyProfile::Cn
        );
        assert_eq!(
            WorkBuddyProfile::resolve(Some("  INTL ")),
            WorkBuddyProfile::Intl
        );
        // 缺省 / 非法值 → 国内版（保持旧行为）。
        assert_eq!(WorkBuddyProfile::resolve(None), WorkBuddyProfile::Cn);
        assert_eq!(WorkBuddyProfile::resolve(Some("nope")), WorkBuddyProfile::Cn);
    }

    #[test]
    fn client_binary_candidates_match_profile_layout() {
        for profile in WorkBuddyProfile::ALL {
            let names: Vec<String> = profile
                .binary_candidates()
                .iter()
                .filter_map(|path| path.file_name().map(|value| value.to_string_lossy().to_string()))
                .collect();
            // 没有 LOCALAPPDATA 的机器上列表可能为空，这里只在有值时校验名字。
            for name in names {
                assert_eq!(
                    name,
                    profile.exe_name(),
                    "unexpected client binary name for {}",
                    profile.id()
                );
            }
        }
    }

    #[test]
    fn process_names_are_profile_scoped() {
        assert_eq!(
            WorkBuddyProfile::Cn.process_names(),
            &["workbuddy.exe"][..]
        );
        assert_eq!(
            WorkBuddyProfile::Intl.process_names(),
            &["workbuddyai.exe"][..]
        );
    }

    #[test]
    fn port_probe_reports_closed_port_as_not_listening() {
        // 取一个几乎不可能被占用的高位端口，确认探测返回 false 而不是 panic。
        assert!(!is_port_listening(42783));
    }
}
