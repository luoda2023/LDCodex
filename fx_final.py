import subprocess
r = subprocess.run(["git","cat-file","-p","132b540:crates/codex-plus-core/src/app_paths.rs"],capture_output=True)
d = r.stdout
if d[:3] == b"\xef\xbb\xbf": d = d[3:]
d = d.replace(b"\r\n", b"\n")
lines = d.split(b"\n")
lines = [l for l in lines if b"const CODEX_PREFIX" not in l]
res = []
dc = 0
sk = False
for line in lines:
    if line.strip().startswith(b"fn dot_char()"):
        dc += 1
        if dc > 1:
            sk = True
            continue
    if sk:
        if line.strip() == b"}":
            sk = False
            continue
        continue
    res.append(line)
res2 = []
for line in res:
    idx = line.find(b"}#[cfg")
    if idx >= 0:
        res2.append(line[:idx+1])
        res2.append(line[idx+1:])
    else:
        res2.append(line)
text = b"\n".join(res2)
dp = 0
for bv in text:
    if bv == 123: dp += 1
    elif bv == 125: dp -= 1
if dp > 0:
    text += b"\n" + b"}" * dp + b"\n"
elif dp < 0:
    for _ in range(-dp):
        lst = text.rfind(b"}")
        if lst >= 0:
            text = text[:lst] + text[lst+1:]
open("crates/codex-plus-core/src/app_paths.rs","wb").write(text)
print("dp=%d sz=%d" % (dp, len(text)))
for i,line in enumerate(text.split(b"\n")):
    if line.count(b"\"") % 2:
        print("ODD L%d" % (i+1))
print("OK")