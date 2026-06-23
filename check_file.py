with open("crates/codex-plus-core/src/app_paths.rs","rb") as f:
    d = f.read()
crlf = d.count(b"\r\n")
lf = d.count(b"\n") - crlf
print(f"CRLF: {crlf}, LF: {lf}")
print(f"First bytes hex: {d[:10].hex()}")
lines = d.split(b"\n")
print(f"Total lines: {len(lines)}")
print(f"Line 480: {lines[479][:80]}")
print(f"Line 480 ends with CR: {lines[479].endswith(b'\\r')}")
