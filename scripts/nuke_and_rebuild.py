import subprocess

# Get raw source from git
r = subprocess.run(["git", "-C", "J:/codex-work/LDCodex", "show", "HEAD:crates/codex-plus-core/src/app_paths.rs"], capture_output=True)
d = r.stdout

# Decode properly - git stores it as UTF-8 in the object database
if d[:3] == b"\xef\xbb\xbf":
    d = d[3:]
text = d.decode("utf-8")

# Apply fixes
text = text.replace("}#[cfg(target_os = \"macos\")]", "}\n#[cfg(target_os = \"macos\")]")

# Remove const CODEX_PREFIX and fix duplicate functions
lines = text.split("\n")
filtered = []
for i, line in enumerate(lines):
    s = line.strip()
    if s.startswith("const CODEX_PREFIX"):
        continue
    # Remove first occurrence of dot_char (keep second)
    if i == 4 and s == "fn dot_char() -> String {":
        continue  # skip first
    if i == 5 and s.startswith("char::from"):
        continue  # skip first body
    if i == 6 and s == "}":
        continue  # skip first closing
    filtered.append(line)

text = "\n".join(filtered)

# Write using binary mode to avoid any BOM
with open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs", "wb") as f:
    f.write(text.encode("utf-8"))

print("Written", len(text.encode("utf-8")), "bytes")
