s = open("crates/codex-plus-core/src/relay_config.rs","rb").read()
if s[:3] == b"\xef\xbb\xbf": s = s[3:]
s = s.replace(b"\r\n", b"\n")
dp = 0
for bv in s:
    if bv == 123: dp += 1
    elif bv == 125: dp -= 1
print("relay_config.rs depth:", dp)
if dp > 0:
    s += b"\n" + b"}" * dp + b"\n"
    open("crates/codex-plus-core/src/relay_config.rs","wb").write(s)
    print("Added", dp, "closing braces")
elif dp < 0:
    for _ in range(-dp):
        i = s.rfind(b"}")
        if i >= 0: s = s[:i] + s[i+1:]
    open("crates/codex-plus-core/src/relay_config.rs","wb").write(s)
    print("Removed", -dp, "extra braces")
