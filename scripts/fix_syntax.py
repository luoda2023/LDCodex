d = open('J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs','rb').read()
lines = d.split(b'\n')
# Fix line 432: split '}#[cfg(' into two lines
for i, line in enumerate(lines):
    stripped = line.rstrip(b'\r')
    if b'}#[cfg(target_os' in stripped:
        print(f'Fixing line {i+1}: {line}')
        lines[i] = b'}\n' + line[line.index(b'#['):]
        break

d = b'\n'.join(lines)
open('J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs','wb').write(d)
print('Done')
