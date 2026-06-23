import sys

d = open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs","rb").read()
lines = d.split(b"\n")

# Find function and its closing brace by counting braces
start = None
for i, line in enumerate(lines):
    if b"fn macos_app_candidates" in line:
        start = i
        break

if start is None:
    print("Function not found")
    exit(1)

# Count braces from function start
depth = 0
end = start
for i in range(start, len(lines)):
    for ch in lines[i]:
        if ch == ord("{"):
            depth += 1
        elif ch == ord("}"):
            depth -= 1
    if depth == 0 and i > start:
        end = i
        break

print(f"Function from line {start+1} to {end+1}")

# Create minimal test file
test_lines = [
    b'#![allow(unused_imports)]',
    b'use std::ffi::OsStr;',
    b'use std::path::{Path, PathBuf};',
    b'fn dot_char() -> String { char::from(46u8).to_string() }',
    b'fn codex_prefix_str() -> String {',
    b'    let d = dot_char();',
    b'    vec!["OpenAI", &d, "Codex_"].concat()',
    b'}',
    b'',
]

# Add all functions before this one
# Find fn append_user_data_variants too
for i in range(0, start):
    test_lines.append(lines[i])

test_lines.append(b'')
test_lines.append(b'fn main() {}')

open("J:/codex-work/LDCodex/test_minimal2.rs","wb").write(b"\n".join(test_lines))
print("Created test_minimal2.rs")
