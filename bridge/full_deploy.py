#!/usr/bin/env python3
"""Upload entire codex-bridge project to VPS."""
import paramiko
import os
import stat

LOCAL_DIR = "J:/codex-bridge-main"
REMOTE_DIR = "/root/codex-bridge-main"
HOST = "47.114.75.115"
USER = "root"
PASS = "Lkw-666999"

# Files/dirs to SKIP (don't upload)
SKIP_SUFFIXES = [".pyc", ".git", ".gitignore", "__pycache__", "node_modules", ".env"]

def should_skip(name):
    for s in SKIP_SUFFIXES:
        if name.endswith(s) or name == s:
            return True
    return False

def upload_dir(sftp, local_path, remote_path):
    """Recursively upload a directory."""
    for item in os.listdir(local_path):
        if should_skip(item):
            continue
        local_item = os.path.join(local_path, item).replace("\\", "/")
        remote_item = os.path.join(remote_path, item).replace("\\", "/")
        
        if os.path.isdir(local_item):
            try:
                sftp.stat(remote_item)
            except FileNotFoundError:
                sftp.mkdir(remote_item)
                print(f"  mkdir {remote_item}")
            upload_dir(sftp, local_item, remote_item)
        else:
            sftp.put(local_item, remote_item)
            print(f"  {remote_item}")

print(f"[OK] Connecting to {HOST}...")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=15)
print("[OK] Connected")

sftp = client.open_sftp()

# Ensure remote dir exists
try:
    sftp.stat(REMOTE_DIR)
except FileNotFoundError:
    sftp.mkdir(REMOTE_DIR)
    print(f"[OK] Created {REMOTE_DIR}")

# Upload files
upload_dir(sftp, LOCAL_DIR, REMOTE_DIR)
sftp.close()
print("[OK] Upload complete")

# Install dependencies and start
print("[OK] Installing dependencies...")
stdin, stdout, stderr = client.exec_command(
    "cd /root/codex-bridge-main && npm install 2>&1 | tail -5"
)
print(stdout.read().decode()[:300])

print("[OK] Starting service...")
stdin, stdout, stderr = client.exec_command(
    "cd /root/codex-bridge-main && "
    "pkill -f 'node index.mjs' 2>/dev/null; sleep 1; "
    "nohup node index.mjs > /tmp/luoda.log 2>&1 & echo PID=$!"
)
print("START:", stdout.read().decode()[:200])
import time
time.sleep(4)

# Verify
stdin, stdout, stderr = client.exec_command("ps aux | grep 'node index.mjs' | grep -v grep")
proc = stdout.read().decode().strip()
print("PROC:", proc if proc else "NOT RUNNING")

stdin, stdout, stderr = client.exec_command(
    "ss -tlnp 2>/dev/null | grep 40000 || "
    "netstat -tlnp 2>/dev/null | grep 40000"
)
port = stdout.read().decode().strip()
print("PORT:", port if port else "NOT LISTENING")

if not (proc and port):
    stdin, stdout, stderr = client.exec_command("tail -20 /tmp/luoda.log")
    print("LOGS:", stdout.read().decode()[:500])

client.close()
print("[OK] Done")
