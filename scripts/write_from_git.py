import subprocess

# Get the raw git object
r = subprocess.run(["git", "-C", "J:/codex-work/LDCodex", "show", "HEAD:crates/codex-plus-core/src/app_paths.rs"], capture_output=True)
raw = r.stdout

# Decode as UTF-8 (it is UTF-8 based on earlier checks)
# But first check if UTF-16
if raw[:2] == b"\xff\xfe":
    print("UTF-16 LE detected, size before:", len(raw))
    text = raw.decode("utf-16-le")
elif raw[:2] == b"\xfe\xff":
    print("UTF-16 BE detected")
    text = raw.decode("utf-16-be")
else:
    print("UTF-8/ASCII detected")
    if raw[:3] == b"\xef\xbb\xbf":
        raw = raw[3:]
    text = raw.decode("utf-8")

print("Text length:", len(text))

# Apply fixes
text = text.replace("}#[cfg(target_os = \"macos\")]", "}\n#[cfg(target_os = \"macos\")]")

lines = text.split("\n")
new_lines = []
for i, line in enumerate(lines):
    stripped = line.strip()
    # Remove const CODEX_PREFIX
    if stripped.startswith("const CODEX_PREFIX"):
        continue
    new_lines.append(line)

text = "\n".join(new_lines)

# Write as raw bytes - use Python file API
with open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs", "wb") as f:
    f.write(text.encode("utf-8"))

print("Written, size:", len(text.encode("utf-8")))
