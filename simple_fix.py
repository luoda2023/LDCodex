import re
with open('crates/codex-plus-core/src/app_paths.rs','rb') as f:
    d = f.read()
if d[:3]==b'\xef\xbb\xbf': d = d[3:]
d = d.replace(b'\r\n',b'\n')
s = d.decode('utf-8', errors='replace')

# Step 1: Remove non-ASCII
s = ''.join(c if ord(c)==10 or 32<=ord(c)<=126 else ' ' for c in s)
s = re.sub(r' +', ' ', s)

# Step 2: Remove const CODEX_PREFIX line
s = re.sub(r'const CODEX_PREFIX.*\n', '', s)

# Step 3: Remove duplicate fn dot_char
# Find second occurrence
idx = s.find('fn dot_char()')
if idx >= 0:
    idx2 = s.find('fn dot_char()', idx+1)
    if idx2 >= 0:
        # Remove from second fn dot_char to the matching }
        body_start = idx2
        brace_count = 0
        i = idx2
        while i < len(s):
            if s[i] == '{': brace_count += 1
            elif s[i] == '}': 
                brace_count -= 1
                if brace_count == 0:
                    s = s[:idx2] + s[i+1:]
                    break
            i += 1

# Step 4: Split }#[cfg
s = s.replace('}#[cfg', '}\n#[cfg')

# Step 5: Replace all vec!["str", &var, "str"].concat() with simple addition
# Use a simple approach: just find these patterns and do literal replacement
# Pattern 1: vec!["A", &x, "B"].concat() -> ("A".to_string() + &x + "B")
# Pattern 2: vec!["A", &x, "B", &y, "C"].concat() -> ("A".to_string() + &x + "B" + &y + "C")

# Do replacements iteratively until no more vec! patterns remain
max_iter = 100
for _ in range(max_iter):
    # Try 2-var pattern first
    m = re.search(r'vec!\s*\[\s*"([^"]+)"\s*,\s*&(\w+(?:\(\))?)\s*,\s*"([^"]+)"\s*,\s*&(\w+(?:\(\))?)\s*,\s*"([^"]+)"\s*\]\s*\.concat\(\)', s)
    if m:
        replacement = '"' + m.group(1) + '".to_string() + &' + m.group(2) + ' + "' + m.group(3) + '" + &' + m.group(4) + ' + "' + m.group(5) + '"'
        s = s[:m.start()] + replacement + s[m.end():]
        continue
    # Try 1-var pattern
    m = re.search(r'vec!\s*\[\s*"([^"]+)"\s*,\s*&(\w+(?:\(\))?)\s*,\s*"([^"]+)"\s*\]\s*\.concat\(\)', s)
    if m:
        replacement = '"' + m.group(1) + '".to_string() + &' + m.group(2) + ' + "' + m.group(3) + '"'
        s = s[:m.start()] + replacement + s[m.end():]
        continue
    break

# Step 6: Balance braces
dp = 0
for c in s:
    if c == '{': dp += 1
    if c == '}': dp -= 1
if dp > 0:
    s += '\n' + '}' * dp + '\n'
elif dp < 0:
    for _ in range(-dp):
        i = s.rfind('}')
        if i >= 0: s = s[:i] + s[i+1:]

# Write
with open('crates/codex-plus-core/src/app_paths.rs','w',encoding='utf-8') as f:
    f.write(s)
print('dp=%d sz=%d' % (dp, len(s)))
# Check quotes
for i,line in enumerate(s.split('\n')):
    if line.count('"') % 2:
        print('ODD L%d: %s' % (i+1, line[:60]))
print('DONE')