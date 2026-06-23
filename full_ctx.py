with open("crates/codex-plus-core/src/app_paths.rs","rb") as f:
    d = f.read()
lines = d.split(b"\n")
# Show lines 436-490 (surrounding the #[cfg split area and line 480)
for i in range(435, min(491, len(lines))):
    print(f"L{i+1}: {repr(lines[i][:120])}")
