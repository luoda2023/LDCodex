import sys

d = open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs","rb").read()
lines = d.split(b"\n")

# Build minimal file with only lines 1-60 and 460-500
test_lines = lines[:2]  # use, use
test_lines.append(b"fn dot_char() -> String { char::from(46u8).to_string() }")
test_lines.append(b"fn codex_prefix_str() -> String { let d = dot_char(); vec![\"OpenAI\", &d, \"Codex_\"].concat() }")
test_lines.append(b"")

# Add lines 60-70 from the original
for i in range(59, 71):
    test_lines.append(lines[i])

# Add the macos function
for i in range(468, 489):
    test_lines.append(lines[i])

test_lines.append(b"fn main() {}")

data = b"\n".join(test_lines)
open("J:/codex-work/LDCodex/test_bisect.rs","wb").write(data)
print(f"Created test_bisect.rs with {len(data)} bytes, {len(test_lines)} lines")
