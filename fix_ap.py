import sys, re, subprocess

fn = r'J:\codex-work\LDCodex\crates\codex-plus-core\src\app_paths.rs'

result = subprocess.run(['git', 'show', 'HEAD:crates/codex-plus-core/src/app_paths.rs'], capture_output=True, cwd=r'J:\codex-work\LDCodex')
data = result.stdout
print(f'From git: {len(data)} bytes')

# CRLF -> LF
data = data.replace(b'\r\n', b'\n')
text = data.decode('utf-8')

# Fix 1: collapse duplicate #[cfg] lines to one
text = re.sub(r'(#\[cfg\(target_os = " macos\\)\]\n){2,}', '#[cfg(target_os = macos)]\n', text)

# Fix 2: replace bare [...] array with vec![...]
text = text.replace(
 ' [\n root.join(\Codex.app\),\n root.join(\OpenAI Codex.app\),\n root.join(\OpenAI.Codex.app\),\n ]',
 ' vec![\n root.join(\Codex.app\),\n root.join(\OpenAI Codex.app\),\n root.join(\OpenAI.Codex.app\),\n ]'
)

with open(fn, 'w', encoding='utf-8', newline='\n') as f:
 f.write(text)

print(f'Written: {len(text)} bytes')
print('Done')
