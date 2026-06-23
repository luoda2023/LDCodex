import subprocess, re  
import sys  
fn = 'crates/codex-plus-core/src/app_paths.rs'  
with open(fn, 'rb') as f:  
    d = f.read()  
d = d.replace(b'\r\n', b'\n')  
d = d.replace(bytes([125,35,99,102,103]), bytes([125,10,35,99,102,103]))  
d = bytes(b for b in d if b < 128)  
t = d.decode()  
cfg_str = chr(35) + '[cfg(target_os = \" "macos\)]\n'  
import re  
t = re.sub(cfg_str + cfg_str, cfg_str, t)  
t = t.replace(chr(34) + '.' + 'to_string()', chr(34) + '.to_string()')  
open(fn, 'w', newline='\n').write(t)  
print('done') 
