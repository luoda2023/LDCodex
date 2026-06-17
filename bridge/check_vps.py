#!/usr/bin/env python3
"""Find project location on VPS."""
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("47.114.75.115", username="root", password="Lkw-666999", timeout=15)

# Check what's in /root/codex-bridge-main (it should have more than just lib)
stdin, stdout, stderr = client.exec_command("ls -la /root/codex-bridge-main/")
print("CURRENT DIR:")
print(stdout.read().decode()[:1000])

# Check if there's an old service running elsewhere
stdin, stdout, stderr = client.exec_command("pm2 list 2>/dev/null || ls /root/.pm2/ 2>/dev/null || echo no-pm2")
print("PM2:", stdout.read().decode()[:300])

# Check for other node processes
stdin, stdout, stderr = client.exec_command("ps aux | grep node | grep -v grep | head -10")
print("NODE PROCS:")
print(stdout.read().decode()[:500])

client.close()
