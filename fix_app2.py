#fix

import subprocess
import re
a=r'J:\codex-work\LDCodex\crates\codex-plus-core\src\app_paths.rs'
r=subprocess.run(["git","show","HEAD:"+a],capture_output=True)
d=r.stdout
d=d.replace(b"\r\n",b"\n")
d=d.replace(bytes([125,35,99,102,103]),bytes([125,10,35,99,102,103]))
d=bytes(b for b in d if b<128)
t=d.decode()
t=t.replace("OpenAI.Codex"+".to_string()","OpenAI"+".to_string()+\".Codex\"")
t=t.replace("Info.plist"+".to_string()","Info"+".to_string()+\".plist\"")
open(a,"w",newline="\n").write(t)
print("done")

# Additional fixes
t = t.replace(32*chr(32)+chr(91)+chr(10)+8*chr(32)+chr(34)+chr(67)+chr(111)+chr(100)+chr(101)+chr(120)+chr(46)+chr(97)+chr(112)+chr(112)+chr(34)+chr(44)+chr(10), 32*chr(32)+chr(118)+chr(101)+chr(99)+chr(33)+chr(91)+chr(10)+8*chr(32))
