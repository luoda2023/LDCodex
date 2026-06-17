#!/usr/bin/env python3
"""Deploy fix to VPS via paramiko SCP."""
import os
import sys

try:
    import paramiko
except ImportError:
    print("[ERR] paramiko not installed. Install with: pip install paramiko")
    sys.exit(1)

HOST = "47.114.75.115"
USER = "root"
PASSWORD = "Lkw-666999"
REMOTE_DIR = "/root/codex-bridge-main"
LOCAL_FILE = "J:\\codex-bridge-main\\lib\\protocol\\openai-responses.mjs"
REMOTE_FILE = f"{REMOTE_DIR}/lib/protocol/openai-responses.mjs"

print(f"[OK] Connecting to {HOST}...")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    client.connect(HOST, username=USER, password=PASSWORD, timeout=15)
    print("[OK] Connected")

    # Upload file via SFTP
    sftp = client.open_sftp()
    remote_dir = os.path.dirname(REMOTE_FILE)
    try:
        sftp.stat(remote_dir)
    except FileNotFoundError:
        print(f"[WARN] Remote dir {remote_dir} not found, creating...")
        client.exec_command(f"mkdir -p {remote_dir}")
    sftp.put(LOCAL_FILE, REMOTE_FILE)
    sftp.close()
    print(f"[OK] File uploaded to {REMOTE_FILE}")

    # Restart service
    print("[OK] Restarting luoda-bridge...")
    stdin, stdout, stderr = client.exec_command(
        "cd /root/codex-bridge-main && "
        "pm2 restart luoda-bridge 2>/dev/null || "
        "systemctl restart luoda-bridge 2>/dev/null || "
        "(pkill -f 'node index.mjs' 2>/dev/null; "
        " nohup node index.mjs > /dev/null 2>&1 &)"
    )
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    print("[OK] Restart response:", out[:200] if out else "empty")
    if err:
        print("[WARN] stderr:", err[:200])

    print("[OK] Deploy complete!")

except Exception as e:
    print(f"[ERR] Failed: {e}")
    sys.exit(1)
finally:
    client.close()
