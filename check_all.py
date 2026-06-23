with open("crates/codex-plus-core/src/app_paths.rs","rb") as f:
    d = f.read()
lines = d.split(b"\n")
for i in range(474, min(490, len(lines))):
    issues = []
    for j,b in enumerate(lines[i]):
        if b == 0: issues.append("NULL@" + str(j))
        elif 0x80 <= b <= 0x9f: issues.append("ctl@" + str(j) + ":" + hex(b))
    s = "issues=" + str(issues) if issues else "clean"
    print("L%d len=%d %s" % (i+1, len(lines[i]), s))
    print("  " + repr(lines[i][:100]))