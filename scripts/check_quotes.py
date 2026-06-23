import sys
d = open('J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs','rb').read()
lines = d.split(b'\n')
for i,l in enumerate(lines):
    c = l.count(b'"')
    if c % 2 == 1:
        print(f'Line {i+1}: odd quotes ({c}): {l}')
print('Done')
