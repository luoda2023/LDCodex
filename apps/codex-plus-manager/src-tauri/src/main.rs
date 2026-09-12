#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    for arg in std::env::args() {
        if arg.starts_with("dreamskin://") {
            if codex_plus_manager_lib::handle_dream_skin_url(&arg) {
                codex_plus_manager_lib::focus_existing_manager_window();
            }
        } else if arg.starts_with("ldcodex://session") || arg.starts_with("codexplusplus://session") {
            if codex_plus_manager_lib::handle_session_share_url(&arg) {
                codex_plus_manager_lib::focus_existing_manager_window();
            }
        } else if arg.starts_with("ldcodex://") || arg.starts_with("codexplusplus://") {
            match codex_plus_core::provider_import::save_pending_provider_import_from_url(&arg) {
                Ok(request) => {
                    let _ = codex_plus_core::diagnostic_log::append_diagnostic_log(
                        "manager.provider_import_url.pending",
                        serde_json::json!({
                            "name": request.name,
                            "baseUrl": request.base_url
                        }),
                    );
                    codex_plus_manager_lib::focus_existing_manager_window();
                }
                Err(error) => {
                    let _ = codex_plus_core::diagnostic_log::append_diagnostic_log(
                        "manager.provider_import_url.failed",
                        serde_json::json!({
                            "error": error.to_string()
                        }),
                    );
                }
            }
        }
    }
    if std::env::args().any(|arg| arg == "--show-update") {
        unsafe {
            std::env::set_var("CODEX_PLUS_SHOW_UPDATE", "1");
        }
    }
    // LDCodex：桌面「WorkBuddy增强」图标以 `--route=workbuddy` 启动管理器。
    // 这里先把导航意图落盘，再交给（可能已经在运行的）管理器实例消费：
    // 单实例守卫失败时 `focus_existing_manager_window()` 会把已开窗口拉到前台，
    // 前台窗口收到 focus 事件后读取并消费这份意图，于是双击图标就能直达增强页。
    save_route_from_args();
    codex_plus_manager_lib::run();
}

/// 解析 `--route=<page>` 并落盘一份待消费的导航意图。
///
/// 页面名由 `manager_navigation` 统一校验，非法值只会被安全忽略。
fn save_route_from_args() {
    let Some(page) = std::env::args().find_map(|arg| {
        arg.strip_prefix("--route=")
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }) else {
        return;
    };

    let navigation = codex_plus_core::manager_navigation::ManagerNavigationIntent {
        page,
        section: None,
    };
    let _ = codex_plus_core::manager_navigation::save_pending_manager_navigation(&navigation);
}
