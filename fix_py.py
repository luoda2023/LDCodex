import subprocess
import sys
sys.stdout.reconfigure(encoding="utf-8")

data = subprocess.check_output(["git", "show", "434b582:crates/codex-plus-core/src/app_paths.rs"])
if data[:3] == b"\xef\xbb\xbf":
    data = data[3:]
text = data.decode("utf-8").replace("\r\n", "\n")
if text.startswith("\ufeff"):
    text = text[1:]

lines = text.split("\n")

first_dot = -1
second_dot = -1
for i, l in enumerate(lines):
    if "fn dot_char()" in l:
        if first_dot == -1:
            first_dot = i
        else:
            second_dot = i
            break

if second_dot > 0:
    lines = lines[:second_dot] + lines[second_dot+3:]

for i, l in enumerate(lines):
    if "const CODEX_PREFIX" in l and "vec![" in l:
        lines[i] = 'const CODEX_PREFIX: &str = "OpenAI.Codex_";'

for i, l in enumerate(lines):
    if "fn codex_prefix_str" in l:
        for j in range(i, min(i+5, len(lines))):
            if "vec![" in lines[j] and "].concat()" in lines[j]:
                lines[j] = '    "OpenAI.Codex_".to_string()'

reps = {
    'vec!["Codex", &dot_char(), "exe"].concat()': '"Codex.exe".to_string()',
    'vec!["package", &dot_char(), "json"].concat()': '"package.json".to_string()',
    'vec!["Info", &dot_char(), "plist"].concat()': '"Info.plist".to_string()',
    'vec!["OpenAI", &dot_char(), "Codex"].concat()': '"OpenAI.Codex".to_string()',
    'vec!["Codex", &dot, "app"].concat()': '"Codex.app".to_string()',
    'vec!["OpenAI Codex", &dot, "app"].concat()': '"OpenAI Codex.app".to_string()',
    'vec!["OpenAI", &dot, "Codex", &dot, "app"].concat()': '"OpenAI.Codex.app".to_string()',
    'vec!["OpenAI", &d, "Codex_"].concat()': '"OpenAI.Codex_".to_string()',
}

for i in range(len(lines)):
    for old, new in reps.items():
        lines[i] = lines[i].replace(old, new)

# Fix format! patterns
for i in range(len(lines)):
    lines[i] = lines[i].replace('format!("Codex{}exe", dot_char())', '"Codex.exe".to_string()')
    lines[i] = lines[i].replace('format!("package{}json", dot_char())', '"package.json".to_string()')
    lines[i] = lines[i].replace('format!("Info{}plist", dot_char())', '"Info.plist".to_string()')
    lines[i] = lines[i].replace('format!("OpenAI{}Codex", dot_char())', '"OpenAI.Codex".to_string()')
    lines[i] = lines[i].replace('format!("Codex{}app", dot)', '"Codex.app".to_string()')
    lines[i] = lines[i].replace('format!("OpenAI Codex{}app", dot)', '"OpenAI Codex.app".to_string()')
    lines[i] = lines[i].replace('format!("OpenAI{}Codex{}app", dot, dot)', '"OpenAI.Codex.app".to_string()')

# Fix macos_app_candidates
for i, l in enumerate(lines):
    if "fn macos_app_candidates" in l:
        found = False
        for j in range(i+1, min(i+15, len(lines))):
            if "let names =" in lines[j] or "format!" in lines[j] or "[".strip() == lines[j].strip() or "Codex.app" in lines[j]:
                indent = "    "
                lines[j] = indent + 'let mut v = Vec::new();'
                lines[j+1] = indent + 'v.push(root.join("Codex.app"));'
                lines[j+2] = indent + 'v.push(root.join("OpenAI Codex.app"));'
                lines[j+3] = indent + 'v.push(root.join("OpenAI.Codex.app"));'
                lines[j+4] = indent + 'v'
                lines[j+5] = "}"
                for k in range(j+5, min(j+10, len(lines))):
                    lines[k] = ""
                found = True
                break
        break

# Fix the eq_ignore_ascii_case line
for i in range(len(lines)):
    lines[i] = lines[i].replace(
        'if file_name.eq_ignore_ascii_case("Codex.exe") || file_name.eq_ignore_ascii_case("Codex.exe".to_string())',
        'if file_name.eq_ignore_ascii_case("Codex.exe")'
    )

text = "\n".join(lines)
with open("crates/codex-plus-core/src/app_paths.rs", "w", encoding="utf-8") as f:
    f.write(text)
print("Done, lines:", len(lines))
