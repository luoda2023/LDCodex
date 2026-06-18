with open('apps/codex-plus-manager/src/App.tsx', 'r', encoding='utf-8-sig') as f:
    lines = f.readlines()

# Print full ProxyScreen function
for i in range(2163, 2323):
    print(str(i+1) + ': ' + lines[i], end='')
