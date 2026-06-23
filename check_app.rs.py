import sys
with open("crates/codex-plus-core/src/app_paths.rs","rb") as f:
    data = f.read()
print("size:",len(data))
print("BOM:",data[:3]==b"\xef\xbb\xbf")
lines = data.split(b"\n")
for i in range(474, min(500,len(lines))):
    line = lines[i]
    non_ascii = [(j,b) for j,b in enumerate(line) if b>127]
    if non_ascii:
        print(f"L{i+1}: non-ASCII at {non_ascii}")
    print(f"L{i+1}: {repr(line[:120])}")
