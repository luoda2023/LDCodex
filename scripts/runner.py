import subprocess, os
SRC = 'J:/codex-work/LDCodex/crates/codex-plus-core/src'

# Fix app_paths.rs in one shot
r = subprocess.run(['git','cat-file','-p','HEAD:crates/codex-plus-core/src/app_paths.rs'],capture_output=True)
d = r.stdout
if d[:3] == b'\xef\xbb\xbf': d = d[3:]
s = d.decode('utf-8')
s = ''.join(c for c in s if ord(c) < 128)
s = s.replace('\r\n','\n')
lines = s.split('\n')

# Remove const CODEX_PREFIX, remove duplicate dot_char, fix }#[
result = []
dot_count = 0
for line in lines:
    if 'const CODEX_PREFIX' in line: continue
    if line.strip() == 'fn dot_char() -> String {':
        dot_count += 1
        if dot_count > 1: continue
    result.append(line)

# Fix }#[
result2 = []
for l in result:
    if l.find('}#[cfg') >= 0 and 'macos' in l:
        result2.append('}')
        result2.append(l[l.find('#['):])
    else:
        result2.append(l)

text = '\n'.join(result2)
depth = 0
for ch in text:
    if ch == '{': depth += 1
    if ch == '}': depth -= 1
if depth != 0:
    text = text.rstrip('\n') + '\n' + '}'*depth + '\n'

with open(os.path.join(SRC,'app_paths.rs'),'w',encoding='utf-8') as f:
    f.write(text)
print('app_paths.rs fixed, depth=' + str(depth))

# Fix relay_config.rs braces
r = subprocess.run(['git','cat-file','-p','HEAD:crates/codex-plus-core/src/relay_config.rs'],capture_output=True)
d = r.stdout
if d[:3] == b'\xef\xbb\xbf': d = d[3:]
s = d.decode('utf-8')
s = ''.join(c for c in s if ord(c) < 128)
s = s.replace('\r\n','\n')
depth = 0
for ch in s:
    if ch == '{': depth += 1
    if ch == '}': depth -= 1
if depth != 0:
    s = s.rstrip('\n') + '\n' + '}'*depth + '\n'
with open(os.path.join(SRC,'relay_config.rs'),'w',encoding='utf-8') as f:
    f.write(s)
print('relay_config.rs fixed, depth=' + str(depth))

# Fix settings.rs braces
r = subprocess.run(['git','cat-file','-p','HEAD:crates/codex-plus-core/src/settings.rs'],capture_output=True)
d = r.stdout
if d[:3] == b'\xef\xbb\xbf': d = d[3:]
s = d.decode('utf-8')
s = ''.join(c for c in s if ord(c) < 128)
s = s.replace('\r\n','\n')
depth = 0
for ch in s:
    if ch == '{': depth += 1
    if ch == '}': depth -= 1
if depth != 0:
    s = s.rstrip('\n') + '\n' + '}'*depth + '\n'
with open(os.path.join(SRC,'settings.rs'),'w',encoding='utf-8') as f:
    f.write(s)
print('settings.rs fixed, depth=' + str(depth))

# Fix status.rs braces
r = subprocess.run(['git','cat-file','-p','HEAD:crates/codex-plus-core/src/status.rs'],capture_output=True)
d = r.stdout
if d[:3] == b'\xef\xbb\xbf': d = d[3:]
s = d.decode('utf-8')
s = ''.join(c for c in s if ord(c) < 128)
s = s.replace('\r\n','\n')
depth = 0
for ch in s:
    if ch == '{': depth += 1
    if ch == '}': depth -= 1
if depth != 0:
    s = s.rstrip('\n') + '\n' + '}'*depth + '\n'
with open(os.path.join(SRC,'status.rs'),'w',encoding='utf-8') as f:
    f.write(s)
print('status.rs fixed, depth=' + str(depth))

print('ALL DONE')
