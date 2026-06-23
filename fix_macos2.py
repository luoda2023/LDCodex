import re

with open("crates/codex-plus-core/src/app_paths.rs","r",encoding="utf-8") as f:
    text = f.read()

# Find and replace macos_app_candidates function body
old = '''    if root.extension() == Some(OsStr::new("app")) {
        return vec![root.to_path_buf()];
    }
    let dot = char::from(46u8).to_string();
    let names = [
        format!("Codex{}app", dot),
        format!("OpenAI Codex{}app", dot),
        format!("OpenAI{}Codex{}app", dot, dot),
    ];
    names
        .into_iter()
        .map(|name| root.join(name))
        .collect()'''

new = '''    if root.extension() == Some(OsStr::new("app")) {
        return vec![root.to_path_buf()];
    }
    let c = "Codex";
    let o = "OpenAI";
    vec![
        root.join(c).join("app"),
        root.join(o).join(c).join("app"),
        root.join(o).join(c).join("app").join("Codex").join("app"),
    ]'''

if old in text:
    text = text.replace(old, new)
    print("Replaced")
else:
    print("Old body not found, trying regex")
    m = re.search(r'fn macos_app_candidates.*?\{.*?\n\}', text, re.DOTALL)
    if m:
        print("Function found, length:", len(m.group()))

with open("crates/codex-plus-core/src/app_paths.rs","w",encoding="utf-8",newline="\n") as f:
    f.write(text)
print("Done")
