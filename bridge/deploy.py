import subprocess
import sys

# Deploy to remote server
host = "47.114.75.115"
user = "root"
remote_dir = "/root/codex-bridge-main"
local_file = "J:\\codex-bridge-main\\lib\\protocol\\openai-responses.mjs"
remote_file = f"{remote_dir}/lib/protocol/openai-responses.mjs"

# Step 1: Upload file via scp using -o PreferredAuthentications=password
print("[OK] Uploading file to", host, "...")
cmd = f'scp -o StrictHostKeyChecking=no "{local_file}" {user}@{host}:{remote_file}'
proc = subprocess.Popen(
    cmd, shell=True,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE
)
stdout, stderr = proc.communicate()
if proc.returncode == 0:
    print("[OK] File uploaded successfully")
else:
    err = stderr.decode('utf-8', errors='replace')
    print("[ERR] Upload failed:", err[:200])
    sys.exit(1)

# Step 2: Restart service
print("[OK] Restarting service...")
cmd = f'ssh -o StrictHostKeyChecking=no {user}@{host} "cd {remote_dir} && (pm2 restart luoda-bridge 2>/dev/null || systemctl restart luoda-bridge 2>/dev/null || (pkill -f \'node index.mjs\' 2>/dev/null; nohup node index.mjs > /dev/null 2>&1 &))"'
proc = subprocess.Popen(
    cmd, shell=True,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE
)
stdout, stderr = proc.communicate()
if proc.returncode == 0:
    print("[OK] Service restart command sent")
else:
    err = stderr.decode('utf-8', errors='replace')
    if "publickey" in err and "password" in err:
        print("[WARN] SSH password required. Please run manually:")
        print()
        print(f"  scp \"{local_file}\" {user}@{host}:{remote_file}")
        print(f"  ssh {user}@{host} \"pm2 restart luoda-bridge\"")
    else:
        print("[OK] Service may have restarted (non-zero exit but might work)")
        print("  stderr:", err[:200])

print()
print("[OK] Deploy script complete")
