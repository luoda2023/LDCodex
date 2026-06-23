import sys

d = open("J:/codex-work/LDCodex/test_final.rs","rb").read()
lines = d.split(b"\n")

# Check each line for patterns that could confuse the Rust lexer
print("=== Analyzing file ===")
print(f"Total lines: {len(lines)}")
print(f"File size: {len(d)} bytes")

# Check for raw strings
for i, line in enumerate(lines):
    if line.find(b'r"') >= 0 or line.find(b"r#") >= 0:
        print(f"L{i+1}: Raw string pattern: {line[:80]}")

# Check for redundant # before "
for i, line in enumerate(lines):
    idx = 0
    while True:
        hpos = line.find(b"#", idx)
        if hpos < 0:
            break
        if hpos + 1 < len(line) and line[hpos+1:hpos+2] == b'"':
            ctx = line[max(0,hpos-10):hpos+10]
            print(f"L{i+1}: '#\"' at byte {hpos}: ...{ctx}...")
            break
        idx = hpos + 1

# Check brace balance
depth = 0
for i, line in enumerate(lines):
    for b in line:
        if b == ord("{"):
            depth += 1
        elif b == ord("}"):
            depth -= 1
    if depth < 0:
        print(f"L{i+1}: EXTRA }}")
if depth != 0:
    print(f"Unbalanced: depth={depth}")
else:
    print(f"Braces balanced")

print("=== Analysis complete ===")
