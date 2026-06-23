#![allow(unused_imports)]
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
fn dot_char() -> String { char::from(46u8).to_string() }
fn codex_prefix_str() -> String {
    let d = dot_char();
    vec!["OpenAI", &d, "Codex_"].concat()
}

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
fn dot_char() -> String {
    char::from(46u8).to_string()
}


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
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .filter_map(|path| version_tuple(&path).map(|version| (version, path)))
        .collect::<Vec<_>>();
    matches.sort_by(|left, right| left.0.cmp(&right.0));
    let (_, latest) = matches.pop()?;
    let app = latest.join("app");
    Some(if app.is_dir() { app } else { latest })
}

pub fn find_latest_codex_app_dir_from_roots(roots: &[PathBuf]) -> Option<PathBuf> {
    roots
        .iter()
        .filter_map(|root| find_latest_codex_app_dir(root))
        .max_by(|left, right| {
            version_tuple(left.parent().unwrap_or(left))
                .cmp(&version_tuple(right.parent().unwrap_or(right)))
        })
}

pub fn find_latest_codex_app_dir_default() -> Option<PathBuf> {

fn main() {}