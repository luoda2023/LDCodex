import sys

d = open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs","rb").read()
lines = d.split(b"\n")

# Print lines 467-502 with special markers for # characters after quotes/parens/brackets
for i in range(466, min(502, len(lines))):
    line = lines[i]
    markers = []
    for j in range(len(line)):
        if line[j] == ord("#") and j > 0:
            prev = chr(line[j-1])
            if prev in ('"', ")", "]"):
                markers.append(f"HASH_AFTER_{prev}_AT_{j}")
    marker_str = "  <== " + ", ".join(markers) if markers else ""
    print(f"L{i+1}: {line}{marker_str}")

# Also find all lines with # that are NOT cfg/serde/repr/derive/doc attributes
for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped.startswith(b"#") and not stripped.startswith(b"#["):
        # Could be an issue - check if it's a raw string delimiter
        pass

# Check for r"# or r## patterns
for i, line in enumerate(lines):
    if b"r#" in line or b"r\"" in line:
        print(f"RAW STRING? L{i+1}: {line}")
