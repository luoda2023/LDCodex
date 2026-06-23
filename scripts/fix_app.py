import sys
d = open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs","rb").read()

# Remove BOM
if d[:3] == b"\xef\xbb\xbf":
    d = d[3:]

# CRLF to LF
d = d.replace(b"\r\n", b"\n")

# Split into lines, remove empty trailing, fix }#[ one-liner
lines = d.split(b"\n")
fixed = []
for i, line in enumerate(lines):
    if b"}#[cfg(target_os = " in line:
        fixed.append(b"}")
        fixed.append(line[line.index(b"#[cfg"):])
        print(f"Split line {i+1}")
    else:
        fixed.append(line)

d = b"\n".join(fixed)

# Now re-check for any }#[ patterns
if b"}#[" in d:
    lines2 = d.split(b"\n")
    fixed2 = []
    for line in lines2:
        if b"}#[" in line:
            idx = line.index(b"}#[")
            fixed2.append(line[:idx+1])
            fixed2.append(line[idx+1:])
        else:
            fixed2.append(line)
    d = b"\n".join(fixed2)

open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs","wb").write(d)
print("Done, size:", len(d))
