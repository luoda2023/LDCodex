with open("crates/codex-plus-core/src/app_paths.rs","r",encoding="utf-8") as f:
    t = f.read()
t = t.replace(
    'vec!["OpenAI", &dot_char(), "Codex"].concat()',
    '"OpenAI.Codex".to_string()'
)
with open("crates/codex-plus-core/src/app_paths.rs","w",encoding="utf-8",newline="\n") as f:
    f.write(t)
print("Fixed")
