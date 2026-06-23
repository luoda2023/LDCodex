#fix
import re
import subprocess
fn=r"J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs"
r=subprocess.run(["git","show","HEAD:crates/codex-plus-core/src/app_paths.rs"],capture_output=True,cwd=r"J:/codex-work/LDCodex")
d=r.stdout
d=d.replace(b"\r\n",b"\n")
d=d.replace(bytes([125,35,99,102,103]),bytes([125,10,35,99,102,103]))
d=bytes(b for b in d if b<128)
t=d.decode()
t=re.sub(chr(35)+chr(91)+chr(99)+chr(102)+chr(103)+chr(40)+chr(116)+chr(97)+chr(114)+chr(103)+chr(101)+chr(116)+chr(95)+chr(111)+chr(115)+chr(32)+chr(61)+chr(32)+chr(34)+chr(109)+chr(97)+chr(99)+chr(111)+chr(115)+chr(34)+chr(41)+chr(93)+chr(10)+chr(35)+chr(91)+chr(99)+chr(102)+chr(103)+chr(40)+chr(116)+chr(97)+chr(114)+chr(103)+chr(101)+chr(116)+chr(95)+chr(111)+chr(115)+chr(32)+chr(61)+chr(32)+chr(34)+chr(109)+chr(97)+chr(99)+chr(111)+chr(115)+chr(34)+chr(41)+chr(93)+chr(10),chr(35)+chr(91)+chr(99)+chr(102)+chr(103)+chr(40)+chr(116)+chr(97)+chr(114)+chr(103)+chr(101)+chr(116)+chr(95)+chr(111)+chr(115)+chr(32)+chr(61)+chr(32)+chr(34)+chr(109)+chr(97)+chr(99)+chr(111)+chr(115)+chr(34)+chr(41)+chr(93)+chr(10),t)
open(fn," w\,newline=\\n\).write(t)
