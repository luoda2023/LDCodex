with open("crates/codex-plus-core/src/app_paths.rs","rb") as f:
    data = f.read()
idx = data.find(b"OpenAI")
print("idx:", idx)
section = data[idx:idx+200]
print("hex:", section.hex())
for j,b in enumerate(section):
    if b > 127:
        print(f"  offset {idx+j}: 0x{b:02x}")
