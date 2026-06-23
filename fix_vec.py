with open('crates/codex-plus-core/src/app_paths.rs','r',encoding='utf-8') as f:
    s = f.read()

import re

# vec![\"str1\", &var, \"str2\"].concat() -> format!(\"str1{0}str2\", var)
# vec![\"str1\", &var, \"str2\", &var2, \"str3\"].concat() -> format!(\"str1{0}str2{1}str3\", var, var2)

# First, handle 2-var pattern: vec![\"A\", &x, \"B\", &y, \"C\"].concat()
s = re.sub(r'vec!\s*\[\s*\"([^\"' + chr(10) + ']*)\"\s*,\s*&(\w+(?:\(\))?)\s*,\s*\"([^\"' + chr(10) + ']*)\"\s*,\s*&(\w+(?:\(\))?)\s*,\s*\"([^\"' + chr(10) + ']*)\"\s*\]\s*\.concat\(\)', 
           r'format!(\"\1{0}\3{1}\5\", \2, \4)', s)

# Then handle 1-var pattern: vec![\"A\", &x, \"B\"].concat()
s = re.sub(r'vec!\s*\[\s*\"([^\"' + chr(10) + ']*)\"\s*,\s*&(\w+(?:\(\))?)\s*,\s*\"([^\"' + chr(10) + ']*)\"\s*\]\s*\.concat\(\)',
           r'format!(\"\1{0}\3\", \2)', s)

with open('crates/codex-plus-core/src/app_paths.rs','w',encoding='utf-8') as f:
    f.write(s)
print('DONE')