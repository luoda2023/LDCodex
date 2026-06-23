with open("crates/codex-plus-core/src/app_paths.rs","rb") as f:
    s = f.read()
lines = s.split(b"\n")
print("Total lines:", len(lines))
print("CR:", b"\r" in s)
print("Only LF:", s.count(b"\n"), "CR count:", s.count(b"\r"))
# Show last 10 lines
for i in range(max(0,len(lines)-10), len(lines)):
    print(f"L{i+1}: {repr(lines[i][:80])}")
