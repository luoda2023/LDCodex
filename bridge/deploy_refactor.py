"""
Deploy refactored files to VPS - Three independent fallback chains
"""
import paramiko, os, sys, getpass

HOST = "47.114.75.115"
USER = "root"
REMOTE_DIR = "/root/codex-bridge-main"
LOCAL_DIR = "J:/codex-bridge-main"

FILES = [
    "lib/fallback.mjs",
    "lib/server.mjs",
    "lib/config-api.mjs",
    "config-proxy.json",
]

def deploy(password):
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=password, timeout=10)
    sftp = ssh.open_sftp()

    print("[OK] Connected to VPS")
    for rel_path in FILES:
        local = os.path.join(LOCAL_DIR, rel_path)
        remote = os.path.join(REMOTE_DIR, rel_path)
        sftp.put(local, remote)
        print(f"[OK] Uploaded {rel_path}")

    sftp.close()

    # Restart service
    stdin, stdout, stderr = ssh.exec_command(
        f"cd {REMOTE_DIR} && "
        f"(pm2 restart luoda-bridge 2>/dev/null || "
        f"systemctl restart luoda-bridge 2>/dev/null || "
        f"(pkill -f 'node index.mjs' 2>/dev/null; nohup node index.mjs > /dev/null 2>&1 &))"
    )
    exit_code = stdout.channel.recv_exit_status()
    print(f"[OK] Restart command sent (exit={exit_code})")

    ssh.close()
    print("\n[OK] Deploy complete!")

if __name__ == "__main__":
    pwd = os.environ.get("VPS_PASSWORD") or getpass.getpass("VPS root password: ")
    deploy(pwd)
