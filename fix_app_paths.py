import re, os

os.chdir("J:/codex-work/LDCodex2")
content = open("crates/codex-plus-core/src/app_paths.rs", "r", encoding="utf-8").read()

# 1. Remove duplicate fn dot_char function
matches = list(re.finditer(r"fn dot_char\(\) -> String \{[^}]*\}", content))
if len(matches) >= 2:
    start = matches[1].start()
    while start > 0 and content[start-1] in "\n\r":
        start -= 1
    if start > 0 and content[start-1] == "\n":
        start -= 1
    content = content[:start] + content[matches[1].end():]

# 2. Fix const CODEX_PREFIX - can"t call function in const
old = 'const CODEX_PREFIX: &str = vec!["OpenAI", &dot_char(), "Codex_"].concat();'
new = (
    "fn codex_prefix_str() -> String {\n"
    "    let d = dot_char();\n"
    '    vec!["OpenAI", &d, "Codex_"].concat()\n'
    "}"
)
content = content.replace(old, new)

# 3. Deduplicate #[cfg(target_os = "macos")]
for _ in range(5):
    content = content.replace(
        '#[cfg(target_os = "macos")]\n#[cfg(target_os = "macos")]\n#[cfg(target_os = "macos")]\n#[cfg(target_os = "macos")]',
        "#[cfg(target_os = \"macos\")]"
    )
    content = content.replace(
        '#[cfg(target_os = "macos")]\n#[cfg(target_os = "macos")]\n#[cfg(target_os = "macos")]',
        "#[cfg(target_os = \"macos\")]"
    )
    content = content.replace(
        '#[cfg(target_os = "macos")]\n#[cfg(target_os = "macos")]',
        "#[cfg(target_os = \"macos\")]"
    )

# 4. Fix missing newlines
content = content.replace("}fn macos_app_version", "}\n\nfn macos_app_version")
content = content.replace("}fn plist_string_value", "}\n\nfn plist_string_value")

# 5. Fix VerQueryValueW subblock
content = content.replace(
    'OsStr::new("\\")',
    'OsStr::new("\\\\")'
)

# 6. Trim trailing whitespace
content = content.rstrip() + "\n"

open("crates/codex-plus-core/src/app_paths.rs", "w", encoding="utf-8").write(content)
print("Done: app_paths.rs fixed")
