import sys

d = open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs","rb").read()
print("BOM:", d[:3].hex())
print("Size:", len(d))

# Remove UTF-8 BOM
if d[:3] == b"\xef\xbb\xbf":
    d = d[3:]
    print("BOM removed")

# Fix the }#[ one-liner
target = b"}#[cfg(target_os = \"macos\")]"
replacement = b"}\n#[cfg(target_os = \"macos\")]"
d = d.replace(target, replacement)

# Convert CRLF to LF
d = d.replace(b"\r\n", b"\n").replace(b"\r", b"\n")

# Ensure trailing newline
d = d.rstrip(b"\n") + b"\n"

open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs","wb").write(d)
print("Fixed, new size:", len(d))
