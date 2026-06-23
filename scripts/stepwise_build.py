import subprocess

# Step 1: Get the raw git source properly
r = subprocess.run(["git", "-C", "J:/codex-work/LDCodex", "show", "HEAD:crates/codex-plus-core/src/app_paths.rs"], capture_output=True)
raw = r.stdout
text = raw.decode("utf-8")

# Apply basic fixes
target = "}#[cfg(target_os = " + '"' + "macos" + '"' + ")]"
replacement = "}\n#[cfg(target_os = " + '"' + "macos" + '"' + ")]"
text = text.replace(target, replacement)

# Step 2: Parse into lines, remove const and duplicate
lines = text.split("\n")
filtered = []
const_found = False
first_dot_char = True
for line in lines:
    stripped = line.strip()
    if stripped.startswith("const CODEX_PREFIX"):
        const_found = True
        continue
    if const_found and not stripped:
        const_found = False
        continue
    if first_dot_char and stripped == "fn dot_char() -> String {":
        first_dot_char = False
        skip = 0
        filtered.append(line)
        continue
    if not first_dot_char and stripped == "fn dot_char() -> String {":
        # This is the second one, keep it
        filtered.append(line)
        continue
    filtered.append(line)

text = "\n".join(filtered)

# Step 3: Write as clean binary - No Set-Content BOM!
# First verify it compiles as a standalone crate
with open("J:/codex-work/LDCodex/test_final.rs", "wb") as f:
    f.write(text.encode("utf-8"))

print(f"Written {len(text.encode('utf-8'))} bytes, {text.count(chr(10))} lines")

# Now compile it standalone
r2 = subprocess.run(["rustc", "--edition", "2018", "--crate-type", "lib", "J:/codex-work/LDCodex/test_final.rs"], capture_output=True, text=True)
print("rustc stdout:", r2.stdout[-200:] if r2.stdout else "(empty)")
print("rustc stderr:", r2.stderr[-500:] if r2.stderr else "(empty)")
