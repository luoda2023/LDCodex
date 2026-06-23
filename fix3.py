import subprocess

def read_bytes(path):
    gitpath = "HEAD:" + path.replace("\\", "/")
    r = subprocess.run(["git","cat-file","-p",gitpath], capture_output=True)
    d = r.stdout
    if d[:3] == b"\xef\xbb\xbf": d = d[3:]
    return d

SRC = "crates/codex-plus-core/src"

# app_paths.rs - special handling
data = read_bytes(SRC + "/app_paths.rs")
text = data.decode("utf-8").replace("\r\n", "\n")  # normalize to LF

lines = text.split("\n")
# Remove const CODEX_PREFIX
lines = [l for l in lines if "const CODEX_PREFIX" not in l]
# Remove second fn dot_char
result = []
dot_count = 0
skip = False
for line in lines:
    if line.strip().startswith("fn dot_char()"):
        dot_count += 1
        if dot_count > 1:
            skip = True
            continue
    if skip:
        if line.strip() == "}":
            skip = False
            continue
        continue
    result.append(line)
# Fix }#[cfg
result2 = []
for line in result:
    if "}#[cfg" in line:
        idx = line.find("}#[cfg")
        result2.append(line[:idx+1])
        result2.append(line[idx+1:])
    else:
        result2.append(line)
text = "\n".join(result2)
# Balance braces
depth = 0
for ch in text:
    if ch == "{": depth += 1
    if ch == "}": depth -= 1
if depth > 0:
    text += "\n" + "}" * depth + "\n"
elif depth < 0:
    for _ in range(-depth):
        last = text.rfind("}")
        if last >= 0:
            text = text[:last] + text[last+1:]
# Write in BINARY mode to avoid CRLF translation
with open(SRC + "/app_paths.rs", "wb") as f:
    f.write(text.encode("utf-8"))
print("app_paths.rs fixed, depth=" + str(depth))

# Other files: just balance braces
for fname in ["relay_config.rs", "settings.rs", "status.rs"]:
    data = read_bytes(SRC + "/" + fname)
    text = data.decode("utf-8").replace("\r\n", "\n")
    depth = 0
    for ch in text:
        if ch == "{": depth += 1
        if ch == "}": depth -= 1
    if depth > 0:
        text += "\n" + "}" * depth + "\n"
    elif depth < 0:
        for _ in range(-depth):
            last = text.rfind("}")
            if last >= 0:
                text = text[:last] + text[last+1:]
    with open(SRC + "/" + fname, "wb") as f:
        f.write(text.encode("utf-8"))
    print(fname + " fixed, depth=" + str(depth))

print("ALL DONE")
