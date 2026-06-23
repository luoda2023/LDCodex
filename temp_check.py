import subprocess, os
path = "crates/codex-plus-core/src/settings.rs"
r = subprocess.run(["git","cat-file","-p","HEAD:"+path],capture_output=True)
print("len:", len(r.stdout))
d = r.stdout
if d[:3] == b"\xef\xbb\xbf": d = d[3:]
text = d.decode("utf-8")
print("text len:", len(text))
print("BackendSettings:", "BackendSettings" in text)
print("first 100:", repr(text[:100]))
