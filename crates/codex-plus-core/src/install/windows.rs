use std::path::{Path, PathBuf};

use super::{
    InstallOptions, MANAGER_BINARY, MANAGER_NAME, SILENT_BINARY, SILENT_NAME,
    ZCODE_BINARY, ZCODE_NAME,
    install_root_or_default, option_or_current_exe,
};

const UNINSTALL_SUBKEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\LDAI";
const LEGACY_UNINSTALL_SUBKEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Uninstall\LDAI";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowsEntrypointPlan {
    pub install_root: String,
    pub silent_shortcut: String,
    pub manager_shortcut: String,
    pub zcode_shortcut: String,
    pub launcher_path: String,
    pub manager_path: String,
    pub zcode_path: String,
    pub icon_path: String,
    pub silent_icon_path: String,
    pub manager_icon_path: String,
    pub zcode_icon_path: String,
    pub uninstall_key: String,
    pub legacy_uninstall_key: String,
    pub remove_owned_data: bool,
}

pub fn build_windows_entrypoint_plan(options: &InstallOptions) -> WindowsEntrypointPlan {
    let install_root = install_root_or_default(options);
    let launcher_path = option_or_current_exe(&options.launcher_path, SILENT_BINARY);
    let manager_path = option_or_current_exe(&options.manager_path, MANAGER_BINARY);
    let zcode_path = option_or_current_exe(&options.launcher_path, ZCODE_BINARY);
    let icon_path = default_icon_path();
    WindowsEntrypointPlan {
        silent_shortcut: install_root
            .join("LDCodex.lnk")
            .to_string_lossy()
            .to_string(),
        manager_shortcut: install_root
            .join("LDAI管理工具.lnk")
            .to_string_lossy()
            .to_string(),
        zcode_shortcut: install_root
            .join("LDZcode.lnk")
            .to_string_lossy()
            .to_string(),
        install_root: install_root.to_string_lossy().to_string(),
        launcher_path: launcher_path.to_string_lossy().to_string(),
        manager_path: manager_path.to_string_lossy().to_string(),
        zcode_path: zcode_path.to_string_lossy().to_string(),
        icon_path: icon_path.to_string_lossy().to_string(),
        silent_icon_path: launcher_path.to_string_lossy().to_string(),
        manager_icon_path: manager_path.to_string_lossy().to_string(),
        zcode_icon_path: zcode_path.to_string_lossy().to_string(),
        uninstall_key: "LDAI".to_string(),
        legacy_uninstall_key: "LDAI".to_string(),
        remove_owned_data: options.remove_owned_data,
    }
}

#[cfg(windows)]
pub fn install_shortcuts(options: &InstallOptions) -> anyhow::Result<()> {
    let plan = build_windows_entrypoint_plan(options);
    let install_root = PathBuf::from(&plan.install_root);
    std::fs::create_dir_all(&install_root)?;
    create_entrypoint_shortcut(
        PathBuf::from(&plan.silent_shortcut),
        PathBuf::from(&plan.launcher_path),
        "启动 LDCodex",
        PathBuf::from(&plan.silent_icon_path),
    )?;
    create_entrypoint_shortcut(
        PathBuf::from(&plan.manager_shortcut),
        PathBuf::from(&plan.manager_path),
        "打开 LDAI管理工具",
        PathBuf::from(&plan.manager_icon_path),
    )?;
    create_entrypoint_shortcut(
        PathBuf::from(&plan.zcode_shortcut),
        PathBuf::from(&plan.zcode_path),
        "启动 LDZcode",
        PathBuf::from(&plan.zcode_icon_path),
    )?;
    write_uninstall_registration(&plan)?;
    Ok(())
}

#[cfg(windows)]
pub fn uninstall_shortcuts(options: &InstallOptions) -> anyhow::Result<()> {
    let plan = build_windows_entrypoint_plan(options);
    let _ = std::fs::remove_file(&plan.silent_shortcut);
    let _ = std::fs::remove_file(&plan.manager_shortcut);
    let _ = std::fs::remove_file(&plan.zcode_shortcut);
    let _ = crate::windows_integration::delete_current_user_key(LEGACY_UNINSTALL_SUBKEY);
    let _ = crate::windows_integration::delete_current_user_key(UNINSTALL_SUBKEY);
    Ok(())
}

#[cfg(not(windows))]
pub fn install_shortcuts(_options: &InstallOptions) -> anyhow::Result<()> {
    anyhow::bail!("Windows shortcuts are only supported on Windows")
}

#[cfg(not(windows))]
pub fn uninstall_shortcuts(_options: &InstallOptions) -> anyhow::Result<()> {
    anyhow::bail!("Windows shortcuts are only supported on Windows")
}

#[cfg(windows)]
fn create_entrypoint_shortcut(
    path: PathBuf,
    target: PathBuf,
    description: &str,
    icon: PathBuf,
) -> anyhow::Result<()> {
    crate::windows_integration::create_shortcut(&crate::windows_integration::ShortcutSpec {
        working_directory: target.parent().map(Path::to_path_buf),
        path,
        target,
        arguments: String::new(),
        description: description.to_string(),
        icon: Some(icon),
        show_minimized: false,
    })
}

#[cfg(windows)]
fn write_uninstall_registration(plan: &WindowsEntrypointPlan) -> anyhow::Result<()> {
    let _ = crate::windows_integration::delete_current_user_key(LEGACY_UNINSTALL_SUBKEY);
    let uninstall_command = format!("\"{}\"", plan.manager_path);
    let install_location = Path::new(&plan.manager_path)
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from(&plan.install_root))
        .to_string_lossy()
        .to_string();
    for (name, value) in [
        ("DisplayName", "LDAI管理工具".to_string()),
        ("DisplayVersion", crate::version::VERSION.to_string()),
        ("Publisher", "LUODA".to_string()),
        ("DisplayIcon", plan.manager_icon_path.clone()),
        ("InstallLocation", install_location),
        ("UninstallString", uninstall_command.clone()),
        ("QuietUninstallString", uninstall_command),
    ] {
        crate::windows_integration::set_current_user_string_value(UNINSTALL_SUBKEY, name, &value)?;
    }
    Ok(())
}

fn default_icon_path() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .map(|path| path.join("ldcodex.ico"))
        .unwrap_or_else(|| PathBuf::from("ldcodex.ico"))
}

#[allow(dead_code)]
fn _entrypoint_names() -> (&'static str, &'static str, &'static str) {
    (SILENT_NAME, MANAGER_NAME, ZCODE_NAME)
}
