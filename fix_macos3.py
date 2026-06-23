with open("crates/codex-plus-core/src/app_paths.rs","r",encoding="utf-8") as f:
    t = f.read()

old = (
    '    let dot = char::from(46u8).to_string();\n'
    '    let names = [\n'
    '        vec!["Codex", &dot, "app"].concat(),\n'
    '        vec!["OpenAI Codex", &dot, "app"].concat(),\n'
    '        vec!["OpenAI", &dot, "Codex", &dot, "app"].concat(),\n'
    '    ];\n'
    '    names\n'
    '        .into_iter()\n'
    '        .map(|name| root.join(name))\n'
    '        .collect()'
)

new = (
    '    vec![\n'
    '        root.join("Codex").join("app"),\n'
    '        root.join("OpenAI Codex").join("app"),\n'
    '        root.join("OpenAI").join("Codex").join("app"),\n'
    '    ]'
)

if old in t:
    t = t.replace(old, new)
    print("Replaced")
else:
    print("Not found")
    # Find the function
    import re
    m = re.search(r'fn macos_app_candidates.*?\n\}', t, re.DOTALL)
    print(repr(m.group()))

with open("crates/codex-plus-core/src/app_paths.rs","w",encoding="utf-8",newline="\n") as f:
    f.write(t)
print("Done")
