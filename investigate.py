import subprocess
r = subprocess.run(["git","cat-file","-p","HEAD:crates/codex-plus-core/src/protocol_proxy.rs"],capture_output=True)
d = r.stdout
if d[:3] == b"\xef\xbb\xbf":
    d = d[3:]
s = d.decode("utf-8")
lines = s.split("\n")
print("Total lines:", len(lines))
line = lines[1205]
print("Line 1206:", repr(line))
for j,c in enumerate(line):
    if ord(c) > 127:
        print("  Col", j, "U+%04X" % ord(c))
