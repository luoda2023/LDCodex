with open("crates/codex-plus-core/src/app_paths.rs","rb") as f:
    d = f.read()
lines = d.split(b"\n")
# Check if any line has odd number of double quotes
for i,line in enumerate(lines):
    count = line.count(b'"')
    if count % 2 == 1:
        print(f"L{i+1}: odd double quotes ({count}) - {repr(line[:120])}")
print("---done---")
