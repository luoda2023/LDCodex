import subprocess

r = subprocess.run(["git", "-C", "J:/codex-work/LDCodex", "show", "HEAD:crates/codex-plus-core/src/relay_config.rs"], capture_output=True)
d = r.stdout
if d[:3] == b"\xef\xbb\xbf":
    d = d[3:]
text = d.decode("utf-8")

# Find unbalanced braces by tracking depth
lines = text.split("\n")
depth = 0
max_depth = 0
high_depth_lines = []

for i, line in enumerate(lines):
    for ch in line:
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
    if depth > max_depth:
        max_depth = depth
    if depth >= 5:  # any line at depth 5+
        high_depth_lines.append((i+1, depth, line.strip()[:80]))

print(f"Final depth: {depth}, max depth: {max_depth}")
print(f"Lines at depth 5+: {len(high_depth_lines)}")
print("")
print("Last 10 lines at depth 5+:")
for ln, d, txt in high_depth_lines[-10:]:
    print(f"  L{ln} (depth {d}): {txt}")

print("")
# Where does depth increase from 4 to 5 (the root of the imbalance)?
for ln, d, txt in high_depth_lines:
    if d == 5:
        print(f"Depth 5 first appears at L{ln}: {txt}")
        break
