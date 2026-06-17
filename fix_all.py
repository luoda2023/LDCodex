import os, re
os.chdir('J:/codex-work/LDCodex2')

# 1. Fix Cargo.toml back to 2021
toml = open('Cargo.toml', 'r', encoding='utf-8').read()
toml = toml.replace('edition = "2018"', 'edition = "2021"')
open('Cargo.toml', 'w', encoding='utf-8').write(toml)
print('Cargo.toml: edition 2021 restored')

# 2. Fix app_paths.rs - remove duplicate codex_prefix_str
content = open('crates/codex-plus-core/src/app_paths.rs', 'r', encoding='utf-8').read()
matches = list(re.finditer(r'fn codex_prefix_str\(\) -> String \{[^}]*\}[\s]*', content))
if len(matches) >= 2:
    start = matches[1].start()
    while start > 0 and content[start-1] in '\n\r':
        start -= 1
    if start > 0 and content[start-1] == '\n':
        start -= 1
    content = content[:start] + content[matches[1].end():]
    
open('crates/codex-plus-core/src/app_paths.rs', 'w', encoding='utf-8').write(content)
print('app_paths.rs dedup done')

# Check remaining dot strings
lines = content.split('\n')
found = False
for i, line in enumerate(lines, 1):
    m = re.search(r'\x22([A-Za-z_]+\.(?:exe|plist|json|app))', line)
    if m:
        print(f'Line {i}: {line.strip()} -> HAS DOT: {m.group(0)}')
        found = True
if not found:
    print('No remaining raw dot strings found')
