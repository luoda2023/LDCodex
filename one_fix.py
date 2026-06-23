with open('crates/codex-plus-core/src/app_paths.rs','r',encoding='utf-8') as f:
    s = f.read()

# Replace all vec![str, &dot, str].concat() with format! macro
import re
# Pattern: vec![\"XXX\", &dot, \"YYY\"].concat()
s = re.sub(r'vec!\["([^"]+)"\s*,\s*&dot\s*,\s*"([^"]+)"\]\.concat\(\)',
           r'format!("{}\u0000{}", dot, "\1", "\2")',
           s)
# Also handle vec![\"XXX\", &dot, \"YYY\", &dot, \"ZZZ\"].concat()
s = re.sub(r'vec!\["([^"]+)"\s*,\s*&dot\s*,\s*"([^"]+)"\s*,\s*&dot\s*,\s*"([^"]+)"\]\.concat\(\)',
           r'format!("{}\u0000{}\u0000{}", dot, "\1", "\2", "\3")',
           s)

# Fix the format strings - remove null placeholders, use actual concat
with open('crates/codex-plus-core/src/app_paths.rs','w',encoding='utf-8') as f:
    f.write(s)
print('Done, size:', len(s))