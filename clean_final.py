import subprocess

# Get original file
data = subprocess.check_output(["git", "show", "434b582:crates/codex-plus-core/src/app_paths.rs"])
if data[:3] == b"\xef\xbb\xbf":
    data = data[3:]

text = data.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")
text = text.lstrip("\ufeff")

lines = text.split("\n")

# Remove empty lines at end
while lines and not lines[-1].strip():
    lines.pop()

# Apply fixes...
# ... (all the fixes from before)

result = "\n".join(lines) + "\n"

with open("crates/codex-plus-core/src/app_paths.rs", "w", encoding="utf-8") as f:
    f.write(result)

# Verify
with open("crates/codex-plus-core/src/app_paths.rs", "rb") as f:
    data = f.read()
print(f"Has BOM: {data[:3]==b'\xef\xbb\xbf'}")
print(f"Has CRLF: {b'\r\n' in data}")
print(f"Has isolated CR: {b'\\r' in data and b'\\r\\n' not in data}")
print(f"Size: {len(data)} bytes")
