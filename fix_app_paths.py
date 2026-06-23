import re

with open('crates/codex-plus-core/src/app_paths.rs', 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.split('\n')

# 1. Remove duplicate dot_char function
first_found = False
result = []
for i, line in enumerate(lines):
    if 'fn dot_char()' in line:
        if not first_found:
            first_found = True
            result.append(line)
        else:
            continue
    else:
        result.append(line)

lines = result

# 2. Fix const CODEX_PREFIX
for i, line in enumerate(lines):
    if 'const CODEX_PREFIX' in line and 'vec![' in line:
        lines[i] = 'const CODEX_PREFIX: &str = "OpenAI.Codex_";'

# 3. Fix all vec![...].concat() -> format!(...)
for i in range(len(lines)):
    line = lines[i]
    if 'vec![' not in line or '].concat()' not in line:
        continue
    
    import re as re2
    m = re2.search(r'vec!\[(.*?)\]\.concat\(\)', line)
    if not m:
        continue
    
    vec_content = m.group(1)
    parts = re2.findall(r'("[^"]*"|&\w+(?:\(.*?\))?)', vec_content)
    
    format_parts = []
    args = []
    for p in parts:
        if p.startswith('"'):
            format_parts.append(p[1:-1])
        elif p.startswith('&'):
            args.append(p[1:])
            format_parts.append('{}')
    
    format_str = ''.join(format_parts)
    if args:
        new_expr = 'format!("{}", {})'.format(format_str, ', '.join(args))
    else:
        new_expr = 'format!("{}")'.format(format_str)
    
    lines[i] = line.replace(m.group(0), new_expr)

with open('crates/codex-plus-core/src/app_paths.rs', 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print('Done')
