#fix

import os, subprocess, re

os.chdir("J:/codex-work/LDCodex")

r = subprocess.run(["git", "show", "HEAD:crates/codex-plus-core/src/app_paths.rs"], capture_output=True)
d = r.stdout
d = d.replace(b"\r\n", b"\n")
d = bytes(b for b in d if b < 128)
t = d.decode()
t = t.replace(chr(125)+chr(35)+chr(91)+chr(99)+chr(102)+chr(103),chr(125)+chr(10)+chr(35)+chr(91)+chr(99)+chr(102)+chr(103))
import re
cl = chr(35)+chr(91)+chr(99)+chr(102)+chr(103)+chr(40)+chr(116)+chr(97)+chr(114)+chr(103)+chr(101)+chr(116)+chr(95)+chr(111)+chr(115)+chr(32)+chr(61)+chr(32)+chr(34)+chr(109)+chr(97)+chr(99)+chr(111)+chr(115)+chr(34)+chr(41)+chr(93)+chr(10)
t = re.sub(cl+cl, cl, t)
oq = chr(34)+OpenAI.Codex+chr(34)+.to_string()
nq = chr(34)+OpenAI+chr(34)+.to_string()+++chr(34)+.Codex+chr(34)
t = t.replace(oq, nq)
ip = chr(34)+Info.plist+chr(34)+.to_string()
np = chr(34)+Info+chr(34)+.to_string()+++chr(34)+.plist+chr(34)
t = t.replace(ip, np)
open("crates/codex-plus-core/src/app_paths.rs", "w", newline="\n").write(t)
print("done", len(t))
