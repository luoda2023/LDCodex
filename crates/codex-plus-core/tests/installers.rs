use codex_plus_core::install::{
    InstallOptions, SILENT_BINARY, build_macos_app_bundle,
    build_macos_zcode_app_bundle, build_windows_entrypoint_plan,
    companion_binary_path_from_exe, default_install_root_strategy,
};

#[test]
fn windows_entrypoint_plan_contains_silent_and_manager_and_zcode_entrypoints() {
    let options = InstallOptions {
        install_root: Some("C:/Users/A/Desktop".into()),
        launcher_path: Some("C:/Tools/ldcodex.exe".into()),
        manager_path: Some("C:/Tools/ldai-manager.exe".into()),
        remove_owned_data: false,
    };

    let plan = build_windows_entrypoint_plan(&options);

    assert!(plan.silent_shortcut.ends_with("LD AI工具.lnk"));
    assert!(plan.manager_shortcut.ends_with("LD AI工具 管理工具.lnk"));
    assert!(plan.zcode_shortcut.ends_with("LD AI工具 ZCode启动器.lnk"));
    assert_eq!(plan.launcher_path, "C:/Tools/ldcodex.exe");
    assert_eq!(plan.manager_path, "C:/Tools/ldai-manager.exe");
    assert_eq!(plan.silent_icon_path, "C:/Tools/ldcodex.exe");
    assert_eq!(plan.manager_icon_path, "C:/Tools/ldai-manager.exe");
    assert_eq!(plan.uninstall_key, "LDAI");
    assert_eq!(plan.legacy_uninstall_key, "LDAI");
}

#[test]
fn windows_entrypoint_plan_can_request_owned_data_removal_without_shell_script() {
    let options = InstallOptions {
        install_root: Some("C:/Users/A/Desktop".into()),
        launcher_path: None,
        manager_path: None,
        remove_owned_data: true,
    };

    let plan = build_windows_entrypoint_plan(&options);

    assert!(plan.silent_shortcut.ends_with("LD AI工具.lnk"));
    assert!(plan.manager_shortcut.ends_with("LD AI工具 管理工具.lnk"));
    assert!(plan.remove_owned_data);
}

#[test]
fn macos_bundle_metadata_contains_silent_manager_and_zcode_apps() {
    let options = InstallOptions {
        install_root: Some("/Applications".into()),
        launcher_path: Some("/opt/LDCodex/ldcodex".into()),
        manager_path: Some("/opt/LDCodex/ldai-manager".into()),
        remove_owned_data: false,
    };

    let silent = build_macos_app_bundle(&options, false);
    let manager = build_macos_app_bundle(&options, true);
    let zcode = build_macos_zcode_app_bundle(&options);

    assert!(silent.app_path.ends_with("LD AI工具.app"));
    assert!(manager.app_path.ends_with("LD AI工具 管理工具.app"));
    assert!(zcode.app_path.ends_with("LD AI工具 ZCode启动器.app"));
    assert!(silent.info_plist.contains("<string>LD AI工具</string>"));
    assert!(manager.info_plist.contains("<string>LD AI工具 管理工具</string>"));
    assert!(zcode.info_plist.contains("<string>LD AI工具 ZCode启动器</string>"));
    assert!(silent.launch_script.contains("ldcodex"));
    assert!(manager.launch_script.contains("ldai-manager"));
    assert!(zcode.launch_script.contains("ldzcode"));
}

#[test]
fn companion_binary_path_resolves_macos_silent_app_next_to_manager_app() {
    let manager_exe = std::path::Path::new(
        "/Applications/LD AI工具 管理工具.app/Contents/MacOS/LDAIManager",
    );

    let companion = companion_binary_path_from_exe(manager_exe, SILENT_BINARY);

    assert_eq!(
        companion,
        std::path::PathBuf::from("/Applications/LD AI工具.app/Contents/MacOS/LDCodex")
    );
    assert_ne!(
        companion,
        std::path::PathBuf::from(
            "/Applications/LD AI工具 管理工具.app/Contents/MacOS/ldcodex"
        )
    );
}

#[test]
fn macos_bundle_does_not_wrap_the_bundle_executable_in_itself() {
    let options = InstallOptions {
        install_root: Some("/Applications".into()),
        launcher_path: Some("/Applications/LD AI工具.app/Contents/MacOS/LDCodex".into()),
        manager_path: Some(
            "/Applications/LD AI工具 管理工具.app/Contents/MacOS/LDAIManager".into(),
        ),
        remove_owned_data: false,
    };

    let silent = build_macos_app_bundle(&options, false);
    let manager = build_macos_app_bundle(&options, true);

    assert!(!silent.launch_script.contains("LDCodex\""));
    assert!(!manager.launch_script.contains("LDAIManager\""));
    assert!(silent.launch_script.contains("ldcodex"));
    assert!(manager.launch_script.contains("ldai-manager"));
}

#[test]
fn windows_default_install_root_uses_known_folder_before_userprofile_desktop() {
    let strategy = default_install_root_strategy();

    if cfg!(windows) {
        assert_eq!(strategy, "windows-known-folder");
    } else if cfg!(target_os = "macos") {
        assert_eq!(strategy, "macos-applications");
    } else {
        assert_eq!(strategy, "user-dirs-desktop");
    }
}
