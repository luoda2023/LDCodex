import os
os.chdir("J:/codex-work/LDCodex")
r = __import__("subprocess").run(["git","show","HEAD:crates/codex-plus-core/src/app_paths.rs"], capture_output=True)
d = r.stdout
d = bytes(b for b in d if b < 128)
t = d.decode("ascii")
t = t.replace("\r\n", "\n")
open("crates/codex-plus-core/src/app_paths.rs", "w", newline="\n").write(t)
print("Done, size:", len(t))
