import subprocess

# Get source from git
r = subprocess.run(["git", "-C", "J:/codex-work/LDCodex", "show", "HEAD:crates/codex-plus-core/src/app_paths.rs"], capture_output=True)
d = r.stdout

# Convert to clean UTF-8
# The git object should be UTF-8 with possible BOM
if d[:3] == b"\xef\xbb\xbf":
    d = d[3:]
text = d.decode("utf-8")

# Apply fixes
text = text.replace("}#[cfg(target_os = \"macos\")]", "}\n#[cfg(target_os = \"macos\")]")

lines = text.split("\n")
new_lines = []
for line in lines:
    stripped = line.strip()
    # Remove invalid const line
    if stripped.startswith("const CODEX_PREFIX"):
        continue
    # Remove empty lines after removed const
    if not stripped:
        if new_lines and new_lines[-1].strip() == "":
            continue
    new_lines.append(line)

text = "\n".join(new_lines)

# Verify encoding - write as bytes
d = text.encode("ascii", errors="replace")
with open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs", "wb") as f:
    f.write(d)

print("Written, size:", len(d))
print("Lines:", text.count("\n"))
