import sys
d = open("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs","rb").read()
lines = d.split(b"\n")
print("Lines with # followed by double quote:")
for i, line in enumerate(lines):
    if b'#' in line:
        pos = line.find(b'#')
        if pos + 1 < len(line) and line[pos+1:pos+2] == b'"':
            print(f'  L{i+1}: offset={pos}, context={line[max(0,pos-5):pos+10]}')
print("Done")
