import sys
d = open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs","rb").read()
# Remove BOM
if d[:3] == b"\xef\xbb\xbf":
    d = d[3:]
# Convert all CRLF to LF, then fix }#[ 
d = d.replace(b"\r\n", b"\n")
d = d.replace(b"}\x23[cfg(target_os = \"macos\")]", b"}\n#cfg_target_placeholder]")
print("Cleaned BOM+CRLF, size:", len(d))
open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs","wb").write(d)
