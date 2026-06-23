import subprocess, os

SRC = "crates/codex-plus-core/src"

def read_git(path):
    r = subprocess.run(["git","cat-file","-p","HEAD:"+path],capture_output=True)
    d = r.stdout
    if d[:3]==b"\xef\xbb\xbf": d = d[3:]
    return d.decode("utf-8").replace("\r\n","\n")

def fix_app_paths():
    lines = read_git(os.path.join(SRC,"app_paths.rs")).split("\n")
    lines = [l for l in lines if "const CODEX_PREFIX" not in l]
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
    result2 = []
    for line in result:
        if "}#[cfg" in line:
            idx = line.find("}#[cfg")
            result2.append(line[:idx+1])
            result2.append(line[idx+1:])
        else:
            result2.append(line)
    text = "\n".join(result2)
    depth = 0
    for ch in text:
        if ch == "{": depth += 1
        if ch == "}": depth -= 1
    if depth > 0:
        text += "\n" + "}"*depth + "\n"
    elif depth < 0:
        for _ in range(-depth):
            last_close = text.rfind("}")
            if last_close >= 0:
                text = text[:last_close] + text[last_close+1:]
    with open(os.path.join(SRC,"app_paths.rs"),"w",encoding="utf-8") as f:
        f.write(text)
    print("app_paths.rs fixed, depth=" + str(depth))

def fix_braces(name):
    s = read_git(os.path.join(SRC,name))
    depth = 0
    for ch in s:
        if ch == "{": depth += 1
        if ch == "}": depth -= 1
    if depth > 0:
        s += "\n" + "}"*depth + "\n"
    with open(os.path.join(SRC,name),"w",encoding="utf-8") as f:
        f.write(s)
    print(name + " fixed, depth=" + str(depth))

fix_app_paths()
for f in ["relay_config.rs","settings.rs","status.rs"]:
    fix_braces(f)
print("ALL DONE")
