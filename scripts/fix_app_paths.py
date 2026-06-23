import sys

d = open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs","rb").read()

# Remove BOM if present
if d[:3] == b"\xef\xbb\xbf":
    d = d[3:]

# Fix }#[ on one line
d = d.replace(b"}#[cfg(target_os = \"macos\")]", b"}\n#[cfg(target_os = \"macos\")]")

# Remove line 3: const CODEX_PREFIX: &str = vec!["OpenAI", &dot_char(), "Codex_"].concat();
# This is invalid Rust. The file already has fn dot_char() and fn codex_prefix_str()
lines = d.split(b"\n")
new_lines = []
skip_prefix_removed = False
for i, line in enumerate(lines):
    if i == 2:  # 0-indexed, line 3
        continue  # skip invalid const
    if i == 3 and line.strip() == b"":
        continue  # skip blank line after const
    new_lines.append(line)

d = b"\n".join(new_lines)

# Convert CRLF to LF (already done)
d = d.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
d = d.rstrip(b"\n") + b"\n"

open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs","wb").write(d)
print("Fixed, new size:", len(d))
