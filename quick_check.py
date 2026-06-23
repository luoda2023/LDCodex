with open("crates/codex-plus-core/src/app_paths.rs","rb") as f:
    d = f.read()
idx = d.find(b'vec!["OpenAI",')
print("idx:", idx)
seg = d[idx:idx+80]
print("hex:", seg.hex())
for j,b in enumerate(seg):
    c = chr(b) if 32<=b<127 else "."
    print(f"  {j}: 0x{b:02x} {c}")
