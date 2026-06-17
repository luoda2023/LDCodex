import os; os.chdir('J:/codex-work/LDCodex2')
content = open('crates/codex-plus-core/src/app_paths.rs', 'r', encoding='utf-8').read()
# Fix both calls - add missing &
# Replace first occurrence (without &)
old = 'file_name.eq_ignore_ascii_case(vec!["Codex", &dot_char(), "exe"].concat()) || file_name.eq_ignore_ascii_case(&vec!["Codex", &dot_char(), "exe"].concat())'
new = 'file_name.eq_ignore_ascii_case(&vec!["Codex", &dot_char(), "exe"].concat()) || file_name.eq_ignore_ascii_case(&vec!["Codex", &dot_char(), "exe"].concat())'
content = content.replace(old, new)
open('crates/codex-plus-core/src/app_paths.rs', 'w', encoding='utf-8').write(content)
print('Fixed both calls')
