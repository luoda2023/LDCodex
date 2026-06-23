import subprocess

r = subprocess.run(["git", "-C", "J:/codex-work/LDCodex", "show", "HEAD:crates/codex-plus-core/src/app_paths.rs"], capture_output=True)
raw = r.stdout
text = raw.decode("utf-8")

# Fix }#[ one-liner
target = "}#[cfg(target_os = " + '"' + "macos" + '"' + ")]"
replacement = "}\n#[cfg(target_os = " + '"' + "macos" + '"' + ")]"
text = text.replace(target, replacement)

lines = text.split("\n")
# Remove const line
lines = [l for l in lines if not l.strip().startswith("const CODEX_PREFIX")]

# Remove first duplicate dot_char function
# Strategy: find the first occurrence and skip 3 lines
result = []
skip_count = 0
for i, line in enumerate(lines):
    if skip_count > 0:
        skip_count -= 1
        continue
    stripped = line.strip()
    if stripped == "fn dot_char() -> String {" and result and "use std" not in result[-2] and "use std" not in result[-1]:
        # First occurrence - check if next line is also dot_char body
        if i + 2 < len(lines) and lines[i+2].strip() == "}":
            skip_count = 3  # skip fn, body, }
            continue
    result.append(line)

text = "\n".join(result)

with open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs", "wb") as f:
    f.write(text.encode("ascii", errors="replace"))

print("Written, size:", len(text.encode("utf-8")))
print("Lines:", text.count("\n"))
