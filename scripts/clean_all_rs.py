import os, re

root = "J:/codex-work/LDCodex/crates/codex-plus-core/src"
target_str = b"}#[cfg(target_os = " + b'"' + b"macos" + b'"' + b")]"
repl_str = b"}\n#[cfg(target_os = " + b'"' + b"macos" + b'"' + b")]"

for fname in sorted(os.listdir(root)):
    if not fname.endswith(".rs"):
        continue
    path = os.path.join(root, fname)
    d = open(path, "rb").read()
    orig_size = len(d)

    # Remove BOM
    if d[:3] == b"\xef\xbb\xbf":
        d = d[3:]

    # Remove non-ASCII
    d = bytes([b for b in d if b < 128])

    # CRLF to LF
    d = d.replace(b"\r\n", b"\n")

    # Fix }#[ pattern
    d = d.replace(target_str, repl_str)

    d = d.rstrip(b"\n") + b"\n"

    if len(d) != orig_size:
        diff = orig_size - len(d)
        print(f"  {fname}: {orig_size} -> {len(d)} ({diff} bytes removed)")

    open(path, "wb").write(d)

print("Done cleaning all .rs files")
