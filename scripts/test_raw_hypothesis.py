import sys

# Test if r" on Windows causes the issue
# Create a test file with r" exactly as in the source
test = [
    b"#![allow(unused_imports, dead_code)]",
    b"use std::ffi::OsStr;",
    b"use std::path::{Path, PathBuf};",
    b"fn dot_char() -> String { char::from(46u8).to_string() }",
    b"fn codex_prefix_str() -> String {",
    b'    let d = dot_char();',
    b'    vec!["OpenAI", &d, "Codex_"].concat()',
    b"}",
    b"",
    b'fn windows_app_package_roots() -> Vec<PathBuf> {',
    b"    let mut roots = Vec::new();",
    b'    roots.push(PathBuf::from(r"C:\\Program Files\\WindowsApps"));',
    b"    roots",
    b"}",
    b"",
    b"fn macos_app_candidates(root: &Path) -> Vec<PathBuf> {",
    b'    if root.extension() == Some(OsStr::new("app")) {',
    b"        return vec![root.to_path_buf()];",
    b"    }",
    b'    let dot = char::from(46u8).to_string();',
    b"    let names = [",
    b'        vec!["Codex", &dot, "app"].concat(),',
    b'        vec!["OpenAI Codex", &dot, "app"].concat(),',
    b'        vec!["OpenAI", &dot, "Codex", &dot, "app"].concat(),',
    b"    ];",
    b"    names.into_iter().map(|name| root.join(name)).collect()",
    b"}",
    b"",
    b"fn main() {}"
]

d = b"\n".join(test)
open("J:/codex-work/LDCodex/test_raw_hypothesis.rs","wb").write(d)
print("Written, size:", len(d))
