import subprocess
r = subprocess.run(["git","cat-file","-p","HEAD:crates/codex-plus-core/src/app_paths.rs"],capture_output=True)
d = r.stdout
# Show non-ASCII area around offset 7849-8000
for i in range(7849, 8000):
    if i < len(d):
        b = d[i]
        if b > 127:
            c = chr(b) if b < 256 else "?"
            if b >= 0xc0:
                # Start of multi-byte UTF-8 sequence
                seq = d[i:i+4]
                try:
                    decoded = seq.decode("utf-8")
                    print(f"  offset {i}: utf8 seq {seq.hex()} = {repr(decoded)}")
                except:
                    print(f"  offset {i}: invalid utf8 byte 0x{b:02x}")
        else:
            if b == 10:
                print()
            else:
                print(chr(b), end="")
