d = open('crates/codex-plus-core/src/app_paths.rs','rb').read()
if d[:3]==b'\xef\xbb\xbf': d = d[3:]
d = d.replace(b'\r\n',b'\n')
# Remove const CODEX_PREFIX line
d = d.replace(b'const CODEX_PREFIX: &str = vec![\"OpenAI\", &dot_char(), \"Codex_\"].concat();', b'')
# Remove duplicate fn dot_char and body
import re
# Find second fn dot_char and remove it
lines = d.split(b'\n')
res = []
dc = 0
sk = 0
for line in lines:
    if line.strip().startswith(b'fn dot_char()'):
        dc += 1
        if dc > 1:
            sk = 1
            continue
    if sk:
        if line.strip() == b'}':
            sk = 0
            continue
        continue
    res.append(line)
# Fix }#[cfg -> separate lines
d2 = b'\n'.join(res).replace(b'}#[cfg', b'}\n#[cfg')
# Balance braces
dp = 0
for bv in d2:
    if bv == 123: dp += 1
    elif bv == 125: dp -= 1
if dp > 0:
    d2 += b'\n' + b'}' * dp + b'\n'
elif dp < 0:
    for _ in range(-dp):
        i = d2.rfind(b'}')
        if i >= 0: d2 = d2[:i] + d2[i+1:]
open('crates/codex-plus-core/src/app_paths.rs','wb').write(d2)
print('dp=%d sz=%d' % (dp, len(d2)))
for i,line in enumerate(d2.split(b'\n')):
    if line.count(b'"') % 2:
        print('ODD L%d' % (i+1))
print('OK')