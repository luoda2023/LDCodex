d = open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs","rb").read()
target = b"}#[cfg(target_os = " + b'"' + b"macos" + b'"' + b")]"
replacement = b"}\n#[cfg(target_os = " + b'"' + b"macos" + b'"' + b")]"
d = d.replace(target, replacement)
d = d.replace(b"\r\n", b"\n")
d = d.rstrip(b"\n") + b"\n"
open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs","wb").write(d)
print("Fixed, size:", len(d))
