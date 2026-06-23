import sys
d = open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs","rb").read()

# Remove all non-ASCII bytes
cleaned = bytearray()
for b in d:
    if b < 128:
        cleaned.append(b)
d = bytes(cleaned)

# Convert CRLF to LF
d = d.replace(b"\r\n", b"\n")

# Fix the }#[ one-liner
lines = d.split(b"\n")
fixed = []
for i, line in enumerate(lines):
    if b"}#[cfg(target_os" in line:
        fixed.append(b"}")
        fixed.append(line[line.index(b"#[cfg"):])
    else:
        fixed.append(line)

d = b"\n".join(fixed)
d = d.rstrip(b"\n") + b"\n"

# Remove const CODEX_PREFIX line
lines = d.split(b"\n")
new_lines = [line for line in lines if not line.strip().startswith(b"const CODEX_PREFIX")]
d = b"\n".join(new_lines)
d = d.rstrip(b"\n") + b"\n"

open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs","wb").write(d)
print("Done. Size:", len(d))
