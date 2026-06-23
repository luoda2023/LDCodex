import subprocess

def read_git(path):
    r = subprocess.run(["git","cat-file","-p","HEAD:"+path],capture_output=True)
    d = r.stdout
    if d[:3]==b"\xef\xbb\xbf": d = d[3:]
    return d.decode("utf-8")

# Check settings.rs for key types
s = read_git("crates/codex-plus-core/src/settings.rs")
lines = s.split("\n")
print("=== settings.rs ===")
print("Total lines:", len(lines))
# Search for key definitions
for i,line in enumerate(lines):
    for kw in ["BackendSettings","SettingsStore","normalize_codex","RelayProfile","RelayProtocol","LaunchMode","RelayMode","pub struct","pub enum","pub fn","pub mod"]:
        if kw in line:
            print(f"  L{i+1}: {repr(line[:100])}")
            break

print()
print("=== status.rs ===")
s2 = read_git("crates/codex-plus-core/src/status.rs")
lines2 = s2.split("\n")
print("Total lines:", len(lines2))
for i,line in enumerate(lines2):
    for kw in ["LaunchStatus","StatusStore","pub struct","pub enum","pub fn"]:
        if kw in line:
            print(f"  L{i+1}: {repr(line[:80])}")
            break

print()
print("=== relay_config.rs ===")
s3 = read_git("crates/codex-plus-core/src/relay_config.rs")
lines3 = s3.split("\n")
print("Total lines:", len(lines3))
for i,line in enumerate(lines3):
    for kw in ["backfill_relay","relay_config_status","pub fn"]:
        if kw in line:
            print(f"  L{i+1}: {repr(line[:100])}")
            break

print()
print("=== protocol_proxy.rs line 1206 ===")
s4 = read_git("crates/codex-plus-core/src/protocol_proxy.rs")
lines4 = s4.split("\n")
if len(lines4) > 1205:
    print(f"  L1206: {repr(lines4[1205][:80])}")
    for j,c in enumerate(lines4[1205]):
        if ord(c) > 127:
            print(f"    Col {j}: U+{ord(c):04X} ({c})")
