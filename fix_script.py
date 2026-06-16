import os
content = open("apps/codex-plus-manager/src/App.tsx","rb").read()
content = content.replace(b"LDCodex ????",b"LDCodex")
print("Fix 1 done")
s = b"    try { getCurrentWindow().setTheme("
e = b"  }, [theme]);"
si = content.find(s)
ei = content.find(e, si)
if si >= 0 and ei >= 0:
    ei += len(e)
    nf = b"    try { getCurrentWindow().setTheme(theme == \"dark\" ? \"dark\" : \"light\"); } catch (_) {}\n  }, [theme]);\n\nconst minimize = () => {\n  try { getCurrentWindow().minimize(); } catch (_) {}\n};\nconst maximize = () => {\n  try { getCurrentWindow().toggleMaximize(); } catch (_) {}\n};\nconst closeWindow = () => {\n  try { getCurrentWindow().close(); } catch (_) {}\n};"
    content = content[:si] + nf + content[ei:]
    print("Fix 2 done")
else:
    print("Pattern not found, si=%d ei=%d" % (si, ei))
open("apps/codex-plus-manager/src/App.tsx","wb").write(content)
print("Saved")
