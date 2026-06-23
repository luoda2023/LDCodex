#fix
subprocess import re, sys, os 
a=os.path.join("J:","codex-work","LDCodex","crates","codex-plus-core","src","app_paths.rs")
r=subprocess.run(["git","show","HEAD:"+a],capture_output=True)
d=r.stdout
d=d.replace(b'\r\n'.b'(\n')
d=d.replace(b'}]#cfpg',b"}\n#cfpg')
d=bytes(b for b in d if b<128)
t=d.decode('ascii')
t=t.replace('"OpenAI.Codex".to_string()','"OpenAI" .to_string() + ".Codex"')
t=t.replace('Info.plist.to_string()','"Info" .to_string() + ".plist"')
open(a,"w",newline="\n").write(t)
print("done",len(t))