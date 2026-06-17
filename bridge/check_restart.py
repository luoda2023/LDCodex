#!/usr/bin/env python3
"""Check service status and restart if needed."""
import paramiko
import time
import sys

HOST = "47.114.75.115"
USER = "root"
PASSWORD = "Lkw-666999"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASSWORD, timeout=15)
print("[OK] Connected")

# Check the remote file for the fix
stdin, stdout, stderr = client.exec_command(
    "grep -n 'CRITICAL FIX\\|fix_reasoning\\|reasoning' /root/codex-bridge-main/lib/protocol/openai-responses.mjs | head -20"
)
print("FIX CHECK:")
print(stdout.read().decode()[:500])

# Restart
print("\n[OK] Attempting restart...")
stdin, stdout, stderr = client.exec_command(
    "cd /root/codex-bridge-main && "
    "pm2 restart luoda-bridge 2>/dev/null && echo pm2-ok || "
    "(pkill -f 'node index.mjs' 2>/dev/null; sleep 1; "
    " nohup node index.mjs > /tmp/luoda.log 2>&1 & sleep 2; echo 'started-direct')"
)
print("RESTART:", stdout.read().decode()[:500])

time.sleep(3)

# Check process
stdin, stdout, stderr = client.exec_command("ps aux | grep 'node index.mjs' | grep -v grep")
proc_list = stdout.read().decode().strip()
if proc_list:
    print("NODE PROC:", proc_list[:300])
else:
    print("NODE PROC: NOT RUNNING")

# Check log
stdin, stdout, stderr = client.exec_command("tail -15 /tmp/luoda.log 2>/dev/null || echo 'no log'")
print("\nLOGS:", stdout.read().decode()[:500])

# Check port
stdin, stdout, stderr = client.exec_command(
    "ss -tlnp | grep 40000 || netstat -tlnp 2>/dev/null | grep 40000 || echo 'PORT 40000 NOT LISTENING'"
)
print("PORT:", stdout.read().decode()[:300])

client.close()
