use std::ffi::OsStr;
use std::path::{Path, PathBuf};

fn dot_char() -> String {
    char::from(46u8).to_string()
}

fn codex_prefix_str() -> String {
    let d = dot_char();
    vec!["OpenAI", &d, "Codex_"].concat()
}

pub fn find_latest_codex_app_dir(root: &Path) -> Option<PathBuf> {
    let mut matches = std::fs::read_dir(root)
        .ok()?
        .filter_map(Result::ok)
        .filter(|entry| {
            let name = entry.file_name();
            name.to_str().map_or(false, |n| n.starts_with(&codex_prefix_str()))
        })
        .collect::<Vec<_>>();
    matches.sort_by_key(|entry| entry.file_name());
    matches.last().map(|entry| entry.path())
}

pub fn find_latest_codex_app_dirs(root: &Path) -> Vec<PathBuf> {
    let mut matches: Vec<_> = std::fs::read_dir(root)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| {
            let name = entry.file_name();
            name.to_str().map_or(false, |n| n.starts_with(&codex_prefix_str()))
        })
        .collect();
    matches.sort_by_key(|entry| entry.file_name());
    matches.into_iter().map(|entry| entry.path()).collect()
}