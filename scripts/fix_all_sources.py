import subprocess, os

root = "J:/codex-work/LDCodex/crates/codex-plus-core/src"

all_ok = True

for fname in sorted(os.listdir(root)):
    if not fname.endswith(".rs"):
        continue
    path = os.path.join(root, fname)
    
    r = subprocess.run(["git", "-C", "J:/codex-work/LDCodex", "show", "HEAD:crates/codex-plus-core/src/" + fname], capture_output=True)
    if r.returncode != 0:
        print(f"Cannot get {fname} from git")
        continue
    
    d = r.stdout
    orig = len(d)
    
    # Strip BOM
    if d[:3] == b"\xef\xbb\xbf":
        d = d[3:]
    
    # Strip non-ASCII (damaged UTF-16 conversion artifacts)
    d = bytes([b for b in d if b < 128])
    
    # Fix line endings and }#[ pattern
    d = d.replace(b"\r\n", b"\n")
    
    # Fix }#[cfg together
    target = b"}#" + b"[cfg(target_os = " + b'"' + b"macos" + b'"' + b")]"
    repl = b"}\n#" + b"[cfg(target_os = " + b'"' + b"macos" + b'"' + b")]"
    d = d.replace(target, repl)
    
    # Remove const CODEX_PREFIX line
    lines = d.split(b"\n")
    lines = [l for l in lines if not l.strip().startswith(b"const CODEX_PREFIX")]
    d = b"\n".join(lines).rstrip(b"\n") + b"\n"
    
    # Add 5 closing braces to relay_config.rs
    if fname == "relay_config.rs":
        d = d.rstrip(b"\n") + b"\n" + b"}" * 5 + b"\n"
    
    with open(path, "wb") as f:
        f.write(d)
    
    if len(d) != orig:
        diff = orig - len(d)
        print(f"  {fname}: {orig} -> {len(d)} ({diff} bytes removed)")

print("All sources fixed")
