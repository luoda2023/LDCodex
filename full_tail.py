with open("crates/codex-plus-core/src/app_paths.rs","rb") as f:
    data = f.read()
lines = data.split(b"\n")
for i in range(472, len(lines)):
    print(f"L{i+1}: {repr(lines[i])}")
