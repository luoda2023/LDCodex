import subprocess

# Get the git source as raw bytes
r = subprocess.run(["git", "-C", "J:/codex-work/LDCodex", "show", "HEAD:crates/codex-plus-core/src/app_paths.rs"], capture_output=True)
d = r.stdout

# Check if it has BOM
if d[:3] == b"\xef\xbb\xbf":
    d = d[3:]

# It should be UTF-8
text = d.decode("utf-8")

# Remove }#[ one-liner
text = text.replace("}#[cfg(target_os = \"macos\")]", "}\n#[cfg(target_os = \"macos\")]")

# Remove const CODEX_PREFIX line
lines = text.split("\n")
lines = [l for l in lines if not l.strip().startswith("const CODEX_PREFIX")]

# Remove duplicate dot_char function (lines 5-7)
new_lines = []
skip_dot_char_dup = False
for i, line in enumerate(lines):
    if i >= 3 and i <= 5 and line.strip() == "fn dot_char() -> String {":
        skip_dot_char_dup = True
        continue
    if skip_dot_char_dup and i <= 7:
        continue
    new_lines.append(line)

lines = new_lines
text = "\n".join(lines)

with open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs", "w", encoding="utf-8") as f:
    f.write(text)

print("Written clean, size:", len(text.encode("utf-8")))
print("Lines:", len(lines))
