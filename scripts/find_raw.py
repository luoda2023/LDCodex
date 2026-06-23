import sys, re
d = open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs","rb").read()
# Look for raw string openings
for m in re.finditer(rb"[^a-zA-Z0-9]r#", d):
    pos = m.start() + 1
    line_num = d[:pos].count(b"\n") + 1
    end = min(pos + 60, len(d))
    print(f"Raw string start at line {line_num}, byte {pos}: {d[pos:end]}")
print("Done")
