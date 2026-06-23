with open("crates/codex-plus-core/src/app_paths.rs","rb") as f:
    d = f.read()
# Find line 480 area
lines = d.split(b"\n")
line = lines[479]  # 0-indexed
print("Line 480 length:", len(line))
print("Line 480 raw:", repr(line))
print("Line 480 hex:", line.hex())
# Column 49 
col49 = line[49] if len(line) > 49 else None
print("Byte at col 49:", col49, hex(col49) if col49 else "N/A")
