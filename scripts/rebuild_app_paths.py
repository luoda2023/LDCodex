import sys

# Read the git source, properly handle UTF-16
import subprocess
r = subprocess.run(["git", "-C", "J:/codex-work/LDCodex", "show", "HEAD:crates/codex-plus-core/src/app_paths.rs"], capture_output=True)
raw = r.stdout

# It's UTF-16 LE
text = raw.decode("utf-16-le")
# Remove BOM if present
if text.startswith("\ufeff"):
    text = text[1:]

# Replace the }#[ one-liner and remove const CODEX_PREFIX
text = text.replace('}#[cfg(target_os = "macos")]', '}\n#[cfg(target_os = "macos")]')

# Remove invalid const line
lines = text.split("\n")
lines = [l for l in lines if not l.strip().startswith("const CODEX_PREFIX")]

text = "\n".join(lines)

# Write as UTF-8 without BOM
with open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs", "w", encoding="utf-8") as f:
    f.write(text)

print("Written clean UTF-8, size:", len(text.encode("utf-8")))
print("Lines:", len(lines))
