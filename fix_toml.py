import os; os.chdir('J:/codex-work/LDCodex2')
toml = open('Cargo.toml', 'r', encoding='utf-8').read()
# Restore to 2021
toml = toml.replace('edition = "2024"', 'edition = "2021"')
open('Cargo.toml', 'w', encoding='utf-8').write(toml)
open('Cargo.toml', 'r', encoding='utf-8').read().split('\n')[11]
