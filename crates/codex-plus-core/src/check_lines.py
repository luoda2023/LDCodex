import re

with open("app_paths.rs", "r", encoding="utf-8") as f:
    content = f.read()

# Find line 436 and 444 area
lines = content.split("\n")
print(f"Total lines: {len(lines)}")

# Check lines 435-445
for i in range(434, 445):
    if i < len(lines):
        print(f"Line {i+1}: {lines[i]}")

# Check Cargo.toml edition
