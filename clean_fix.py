d = open('crates/codex-plus-core/src/app_paths.rs','rb').read()
lines = d.split(b'\n')
new_lines = []
for line in lines:
    # Replace vec![\"X\", &var, \"Y\"].concat() -> format!(\"X{0}Y\", var)
    # vec![\"X\", &var, \"Y\", &var2, \"Z\"].concat() -> format!(\"X{0}Y{1}Z\", var, var2)
    s = line.decode('utf-8')
    import re
    
    # 2-variable pattern first
    s = re.sub(
        r'vec!\s*\[\s*"([^"]*)"\s*,\s*&(\w+(?:\(\))?)\s*,\s*"([^"]*)"\s*,\s*&(\w+(?:\(\))?)\s*,\s*"([^"]*)"\s*\]\s*\.concat\(\)',
        r'format!("{0}\1{1}\3{2}\5", \2, \4)',
        s
    )
    
    # 1-variable pattern
    s = re.sub(
        r'vec!\s*\[\s*"([^"]*)"\s*,\s*&(\w+(?:\(\))?)\s*,\s*"([^"]*)"\s*\]\s*\.concat\(\)',
        r'format!("{0}\1{1}\3", \2)',
        s
    )
    
    new_lines.append(s.encode('utf-8'))

d2 = b'\n'.join(new_lines)
open('crates/codex-plus-core/src/app_paths.rs','wb').write(d2)

# Check
for i,line in enumerate(d2.split(b'\n')):
    if line.count(b'"') % 2:
        print('ODD L%d' % (i+1))
print('size:', len(d2))