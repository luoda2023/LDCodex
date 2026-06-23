with open("crates/codex-plus-core/src/app_paths.rs","rb") as f:
    data = f.read()
# Check last 200 bytes
print("Last 200 bytes hex:", data[-200:].hex())
print("Last 200 bytes:", repr(data[-200:]))
# Check all lines from 470 to end
lines = data.split(b"\n")
for i in range(469, len(lines)):
    line = lines[i]
    # Find any " that aren't properly matched
    dq_count = line.count(b'"')
    sq_count = line.count(b"'")
    print(f"L{i+1}: dq={dq_count} sq={sq_count} | {repr(line[:100])}")
