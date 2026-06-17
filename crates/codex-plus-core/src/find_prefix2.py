import re

with open("app_paths.rs", "r", encoding="utf-8") as f:
    content = f.read()

# Find all string literals that look like "xxx.yyy" or "xxx.yyy.zzz" which Rust 2024 parses as prefix identifiers
# Pattern: a string starting with a capitalized word, then dots
lines = content.split("\n")
for i, line in enumerate(lines):
    if i < 1: continue
    # Find strings that contain dots and look like identifiers
    matches = re.findall(r'"([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\.?[A-Za-z0-9_]*)"', line)
    if matches:
        for m in matches:
            if " " not in m and m != "Info.plist":
                print(f"  Line {i+1}: Found '{m}' in: {line.strip()[:100]}")
