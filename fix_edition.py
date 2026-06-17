import os; os.chdir('J:/codex-work/LDCodex2')
toml = open('Cargo.toml', 'r', encoding='utf-8').read()
toml = toml.replace('edition = "2024"', 'edition = "2021"')
open('Cargo.toml', 'w', encoding='utf-8').write(toml)
print('restored to 2021')

# Fix let chains in relay_config.rs
content = open('crates/codex-plus-core/src/relay_config.rs', 'r', encoding='utf-8').read()

# Pattern: && let Some((key, _)) = trimmed.split_once('=')
# Replace with: .and_then(|s| s.split_once('='))
# Actually the pattern is like:
# if trimmed.contains('=') && let Some((key, _)) = trimmed.split_once('=') {
# We need to rewrite these

# Line 1232
old = """    if !line.starts_with('#') && !line.starts_with(';')
        && let Some((key, _)) = trimmed.split_once('=')
    {"""
new = """    if !line.starts_with('#') && !line.starts_with(';') {
        let eq_pos = trimmed.find('=');
        if let Some(key) = eq_pos.map(|p| &trimmed[..p]) {"""
content = content.replace(old, new)
# Fix corresponding closing braces - need to match
# Actually this is complex. Let me check the context
open('crates/codex-plus-core/src/relay_config.rs', 'w', encoding='utf-8').write(content)
print('relay_config.rs partially fixed')
