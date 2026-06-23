#![allow(unused_imports, dead_code)]
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
fn dot_char() -> String { char::from(46u8).to_string() }
fn codex_prefix_str() -> String {
    let d = dot_char();
    vec!["OpenAI", &d, "Codex_"].concat()
}

fn windows_app_package_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    roots.push(PathBuf::from(r"C:\Program Files\WindowsApps"));
    roots
}

fn macos_app_candidates(root: &Path) -> Vec<PathBuf> {
    if root.extension() == Some(OsStr::new("app")) {
        return vec![root.to_path_buf()];
    }
    let dot = char::from(46u8).to_string();
    let names = [
        vec!["Codex", &dot, "app"].concat(),
        vec!["OpenAI Codex", &dot, "app"].concat(),
        vec!["OpenAI", &dot, "Codex", &dot, "app"].concat(),
    ];
    names.into_iter().map(|name| root.join(name)).collect()
}

fn main() {}