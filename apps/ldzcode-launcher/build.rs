fn main() {
    #[cfg(windows)]
    {
        let mut resource = winresource::WindowsResource::new();
        resource.set_icon("../codex-plus-manager/src-tauri/icons/icon.ico");
        resource.set_manifest(include_str!(
            "../codex-plus-manager/src-tauri/windows-app-manifest.xml"
        ));
        if let Err(e) = resource.compile() {
            println!("cargo:warning=跳过 launcher 图标编译: {e}");
        }
    }
}
