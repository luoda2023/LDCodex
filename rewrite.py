with open("crates/codex-plus-core/src/app_paths.rs","r",encoding="utf-8") as f:
    s = f.read()
# Replace the problematic line with format! approach
old = '        vec!["OpenAI", &dot, "Codex", &dot, "app"].concat(),'
new = '        format!("OpenAI{0}Codex{0}app", dot).concat_into(String::new());'
# Actually format! doesn't have concat_into... just use format! directly
new2 = '        format!("OpenAI{0}Codex{0}app", dot),'
s = s.replace(old, new2)
with open("crates/codex-plus-core/src/app_paths.rs","w",encoding="utf-8") as f:
    f.write(s)
print("Replaced")