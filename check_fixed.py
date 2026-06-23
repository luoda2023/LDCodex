# Check fixed settings.rs
with open("crates/codex-plus-core/src/settings.rs","rb") as f:
    data = f.read()
print("settings.rs size:", len(data))
print("BOM present:", data[:3] == b"\xef\xbb\xbf")
# Decode and check key types
text = data.decode("utf-8")
for kw in ["BackendSettings","SettingsStore","normalize_codex","RelayProfile","RelayProtocol","LaunchMode","RelayMode"]:
    count = text.count(kw)
    print(f"  {kw}: {count} occurrences")
    
# Check fixed status.rs
with open("crates/codex-plus-core/src/status.rs","rb") as f:
    data = f.read()
text = data.decode("utf-8")
print()
print("status.rs size:", len(data))
for kw in ["LaunchStatus","StatusStore"]:
    print(f"  {kw}: {text.count(kw)} occurrences")

# Check depth again
for name in ["settings.rs","status.rs","relay_config.rs"]:
    with open(f"crates/codex-plus-core/src/{name}","r",encoding="utf-8") as f:
        s = f.read()
    depth = 0
    for ch in s:
        if ch == "{": depth += 1
        if ch == "}": depth -= 1
    print(f"{name} depth: {depth}")
