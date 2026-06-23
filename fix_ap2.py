import subprocess, sys

fn = r'J:\codex-work\LDCodex\crates\codex-plus-core\src\app_paths.rs'

result = subprocess.run(['git', 'show', 'HEAD:crates/codex-plus-core/src/app_paths.rs'], capture_output=True, cwd=r'J:\codex-work\LDCodex')
data = result.stdout
print(f'From git: {len(data)} bytes')

data = data.replace(b'\r\n', b'\n')
text = data.decode('utf-8')

# Fix: collapse multiple #[cfg] lines
lines = text.split('\n')
new_lines = []
skip = False
for i, line in enumerate(lines):
    if skip:
        skip = False
        continue
    if '#[cfg(target_os = " macos\)]' in line and i+1 < len(lines) and '#[cfg(target_os = \macos\)]' in lines[i+1]:
 new_lines.append(line)
 skip = True
 else:
 new_lines.append(line)
text = '\n'.join(new_lines)

# Fix: bare [...] -> vec![...]
text = text.replace(
 ' [\n root.join(\Codex.app\),\n root.join(\OpenAI Codex.app\),\n root.join(\OpenAI.Codex.app\),\n ]',
 ' vec![\n root.join(\Codex.app\),\n root.join(\OpenAI Codex.app\),\n root.join(\OpenAI.Codex.app\),\n ]'
)

# Also need to add 'use std::ffi::OsStr;' if missing
if 'use std::ffi::OsStr;' not in text:
 text = text.replace('use std::path::{Path, PathBuf};', 'use std::ffi::OsStr;\nuse std::path::{Path, PathBuf};')

with open(fn, 'w', encoding='utf-8', newline='\n') as f:
 f.write(text)

print(f'Written: {len(text)} bytes, lines: {len(text.split(chr(10)))}')
print('Done')
