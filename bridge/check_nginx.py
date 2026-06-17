#!/usr/bin/env python3
"""Check nginx config and restart if needed."""
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("47.114.75.115", username="root", password="Lkw-666999", timeout=15)

# Check nginx
stdin, stdout, stderr = client.exec_command("ps aux | grep nginx | head -5")
print("NGINX PROCS:")
print(stdout.read().decode()[:300])

# Find nginx configs
stdin, stdout, stderr = client.exec_command(
    "find /etc/nginx -name '*.conf' -o -name '*.lua' 2>/dev/null | "
    "find /usr/local/openresty -name '*.conf' -o -name '*.lua' 2>/dev/null | "
    "ls /usr/local/openresty/nginx/conf/ 2>/dev/null | "
    "cat /usr/local/openresty/nginx/conf/nginx.conf 2>/dev/null | head -80"
)
print("\nNGINX CONF:")
print(stdout.read().decode()[:1000])

client.close()
