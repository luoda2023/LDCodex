#!/usr/bin/env python3
"""Restart bridge service on VPS."""
import paramiko
import time

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("47.114.75.115", username="root", password="Lkw-666999", timeout=15)
print("[OK] Connected")

# Kill any existing process
client.exec_command("pkill -f 'node index.mjs' 2>/dev/null; sleep 1")
time.sleep(1)

# Start fresh
stdin, stdout, stderr = client.exec_command(
    "cd /root/codex-bridge-main && nohup node index.mjs > /tmp/luoda.log 2>&1 & echo PID=$!"
)
print("START:", stdout.read().decode()[:100])
err = stderr.read().decode()
if err:
    print("ERR:", err[:200])
time.sleep(4)

# Verify
stdin, stdout, stderr = client.exec_command(
    "ps aux | grep 'node index.mjs' | grep -v grep"
)
proc = stdout.read().decode().strip()
print("PROC:", proc if proc else "NOT RUNNING")

stdin, stdout, stderr = client.exec_command(
    "ss -tlnp 2>/dev/null | grep 40000 || netstat -tlnp 2>/dev/null | grep 40000"
)
port = stdout.read().decode().strip()
print("PORT:", port if port else "NOT LISTENING")

if proc and port:
    print("[OK] Service running on port 40000")
else:
    # Check logs
    stdin, stdout, stderr = client.exec_command("tail -20 /tmp/luoda.log")
    print("LOGS:", stdout.read().decode()[:500])

client.close()
