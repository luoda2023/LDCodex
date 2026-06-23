import sys

# Extract just the problematic function from the file
d = open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs","rb").read()
lines = d.split(b"\n")

# Find the macos_app_candidates function
start = None
end = None
for i, line in enumerate(lines):
    if b"fn macos_app_candidates" in line:
        start = i
    if start is not None and line.strip() == b"}":
        end = i
        break

print(f"Function from line {start+1} to {end+1}")

# Create minimal test file with all dependencies
test_lines = []
test_lines.append(b'#![allow(unused_imports)]')
test_lines.append(b'use std::ffi::OsStr;')
test_lines.append(b'use std::path::{Path, PathBuf};')
test_lines.append(b'fn dot_char() -> String { char::from(46u8).to_string() }')
test_lines.append(b'')
# Also add codex_prefix_str
test_lines.append(b'fn codex_prefix_str() -> String {')
test_lines.append(b'    let d = dot_char();')
test_lines.append(b'    vec!["OpenAI", &d, "Codex_"].concat()')
test_lines.append(b'}')
test_lines.append(b'')

# Add all functions from the original that are needed
for i in range(start, end+1):
    test_lines.append(lines[i])

test_lines.append(b'')
test_lines.append(b'fn main() {}')

open("J:/codex-work/LDCodex/test_minimal.rs","wb").write(b"\n".join(test_lines))
print("Created test_minimal.rs")
