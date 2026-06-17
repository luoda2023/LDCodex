import os
os.chdir("J:/codex-work/LDCodex2")
content = open("crates/codex-plus-core/src/app_paths.rs", "r", encoding="utf-8-sig").read()
old = 'pub fn codex_app_version(app_dir: &Path) -> Option<String> {\n    if app_dir.extension() == Some(OsStr::new("app")) {\n        return macos_app_version(app_dir);\n    }'
new = 'pub fn codex_app_version(app_dir: &Path) -> Option<String> {\n    #[cfg(target_os = "macos")]\n    if app_dir.extension() == Some(OsStr::new("app")) {\n        return macos_app_version(app_dir);\n    }\n    #[cfg(not(target_os = "macos"))]\n    if app_dir.extension() == Some(OsStr::new("app")) {\n        return None;\n    }'
content = content.replace(old, new)
open("crates/codex-plus-core/src/app_paths.rs", "w", encoding="utf-8-sig").write(content)
print("Fixed")
