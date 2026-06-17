# 🚀 LuoDaBridge VPS 部署 Skill

## Use When
用户需要修复 bug 后部署到线上 VPS，或需要滚动更新、回滚、健康检查。

## Inputs
- `files_to_upload`: 需要上传的本地文件路径列表（相对于 J:\codex-bridge-main\）
- `host`: VPS 主机地址（默认 47.114.75.115）
- `user`: SSH 用户名（默认 root）
- `remote_dir`: VPS 部署目录（默认 `/opt/1panel/LuoDaBridge`）
- `pm2_name`: PM2 进程名（默认 `luoda-bridge`）
- `backup_first`: 是否在部署前备份（默认 true）

## Procedure

Windows 环境无 sshpass，使用 Python (paramiko) 进行 SSH 操作。

### 模板脚本
每次部署时粘贴以下 Python 脚本，填入要上传的文件路径即可：

```python
import paramiko, time

host, user, password = "47.114.75.115", "root", "Lkw-666999"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(host, username=user, password=password, timeout=10)

sftp = ssh.open_sftp()

# ── Step 1: 备份 ──
backup_name = time.strftime("%Y%m%d_%H%M%S")
ssh.exec_command(f"mkdir -p /opt/1panel/LuoDaBridge_bak_{backup_name}")
ssh.exec_command(f"cp -r /opt/1panel/LuoDaBridge/lib /opt/1panel/LuoDaBridge_bak_{backup_name}/")
ssh.exec_command(f"cp /opt/1panel/LuoDaBridge/index.mjs /opt/1panel/LuoDaBridge_bak_{backup_name}/ 2>/dev/null")
ssh.exec_command(f"cp /opt/1panel/LuoDaBridge/models.json /opt/1panel/LuoDaBridge_bak_{backup_name}/ 2>/dev/null")
ssh.exec_command(f"cp /opt/1panel/LuoDaBridge/config-proxy.json /opt/1panel/LuoDaBridge_bak_{backup_name}/ 2>/dev/null")
print(f"[OK] 备份: LuoDaBridge_bak_{backup_name}")

# ── Step 2: 上传文件 ──
# 要上传的文件列表，格式: (本地路径, VPS路径)
files = [
    (r"J:\codex-bridge-main\lib\protocol\openai-responses.mjs",
     "/opt/1panel/LuoDaBridge/lib/protocol/openai-responses.mjs"),
    # 在此添加更多文件...
]
for local, remote in files:
    sftp.put(local, remote)
    print(f"[OK] 已上传: {local}")

sftp.close()

# ── Step 3: 重启服务 ──
ssh.exec_command("pkill -f 'node index.mjs' 2>/dev/null; sleep 2")
ssh.exec_command("fuser -k 40001/tcp 2>/dev/null; sleep 1")
ssh.exec_command("cd /opt/1panel/LuoDaBridge && setsid node index.mjs < /dev/null > data/luoda.log 2>&1 &")
time.sleep(4)

# ── Step 4: 健康检查 ──
stdin, stdout, stderr = ssh.exec_command("ss -tlnp | grep node")
ports = stdout.read().decode().strip()
print(f"[OK] 端口:\n{ports}")

stdin, stdout, stderr = ssh.exec_command("pgrep -f 'node index.mjs' && echo 'OK' || echo 'ERR'")
alive = stdout.read().decode().strip()
print(f"[OK] 进程: {alive}")

stdin, stdout, stderr = ssh.exec_command("tail -3 /opt/1panel/LuoDaBridge/data/luoda.log")
print(f"[OK] 日志:\n{stdout.read().decode().strip()}")

# ── Step 5: 健康检查失败则回滚 ──
if "ERR" in alive or "40000" not in ports:
    print("[ERR] 健康检查失败，回滚中...")
    ssh.exec_command(f"cp -r /opt/1panel/LuoDaBridge_bak_{backup_name}/lib /opt/1panel/LuoDaBridge/")
    ssh.exec_command(f"cp /opt/1panel/LuoDaBridge_bak_{backup_name}/index.mjs /opt/1panel/LuoDaBridge/ 2>/dev/null")
    ssh.exec_command("cd /opt/1panel/LuoDaBridge && setsid node index.mjs < /dev/null > data/luoda.log 2>&1 &")
    print("[OK] 已回滚")

ssh.close()
```

**关键路径映射：**
| 本地路径 | VPS 路径 |
|---------|---------|
| `J:\codex-bridge-main\lib\server.mjs` | `/opt/1panel/LuoDaBridge/lib/server.mjs` |
| `J:\codex-bridge-main\lib\protocol\openai-responses.mjs` | `/opt/1panel/LuoDaBridge/lib/protocol/openai-responses.mjs` |
| `J:\codex-bridge-main\lib\fallback.mjs` | `/opt/1panel/LuoDaBridge/lib/fallback.mjs` |
| `J:\codex-bridge-main\lib\config-api.mjs` | `/opt/1panel/LuoDaBridge/lib/config-api.mjs` |
| `J:\codex-bridge-main\index.mjs` | `/opt/1panel/LuoDaBridge/index.mjs` |
| `J:\codex-bridge-main\package.json` | `/opt/1panel/LuoDaBridge/package.json` |
| `J:\codex-bridge-main\models.json` | `/opt/1panel/LuoDaBridge/models.json` |
| `J:\codex-bridge-main\config-proxy.json` | `/opt/1panel/LuoDaBridge/config-proxy.json` |
| `J:\codex-bridge-main\admin\index.html` | `/opt/1panel/LuoDaBridge/admin/index.html` |

### Step 4: 同步本地备份（可选）
```bash
# 复制已上传的文件到 vps-backup/ 目录留存
copy "J:\codex-bridge-main\%FILE%" "J:\codex-bridge-main\vps-backup\%FILE%" >nul
```

### Step 5: 重启服务
```bash
# 直接进程管理（VPS 无 PM2/systemctl）
ssh root@47.114.75.115 "cd /opt/1panel/LuoDaBridge && pkill -f 'node index.mjs' && sleep 2 && nohup node index.mjs > /dev/null 2>&1 &"
```

### Step 6: 健康检查
```bash
# 等待服务启动
timeout /t 5 >nul

# 检查 HTTP 状态
curl -s -o nul -w "%%{http_code}" http://47.114.75.115:40001/api/status 2>nul

# 检查进程是否存活
ssh root@47.114.75.115 "pgrep -f 'node index.mjs' && echo '[OK] 进程存活' || echo '[ERR] 进程未运行'"

# 检查日志最后5行是否有错误
ssh root@47.114.75.115 "tail -5 /opt/1panel/LuoDaBridge/data/luoda.log 2>/dev/null || tail -5 /opt/1panel/LuoDaBridge/data/dataluoda.log 2>/dev/null"
```

### Step 7: 健康检查不通过 → 自动回滚
```bash
# 如果健康检查失败：
echo "[ERR] 健康检查失败，正在回滚..."

# 找到最近的备份
LATEST_BACKUP=$(ssh root@47.114.75.115 "ls -d /opt/1panel/LuoDaBridge_bak_* 2>/dev/null | tail -1")

if [ -n "$LATEST_BACKUP" ]; then
  # 恢复备份
  ssh root@47.114.75.115 "cp -r \$LATEST_BACKUP/lib /opt/1panel/LuoDaBridge/ && \
    cp \$LATEST_BACKUP/index.mjs /opt/1panel/LuoDaBridge/ 2>/dev/null; \
    cp \$LATEST_BACKUP/models.json /opt/1panel/LuoDaBridge/ 2>/dev/null; \
    cp \$LATEST_BACKUP/config-proxy.json /opt/1panel/LuoDaBridge/ 2>/dev/null; \
    pm2 restart luoda-bridge"

  echo "[OK] 已回滚到备份: \$LATEST_BACKUP"
else
  echo "[CRITICAL] 无可用备份！请手动登录 VPS 排查"
fi
```

## Output
- 部署成功: 返回健康检查结果 + 备份目录路径
- 部署失败: 触发回滚 + 输出回滚状态
- 回滚也失败: CRITICAL 告警，要求人工介入

## Safety Rules
1. ⛔ 部署前必须备份，没有备份不上传
2. ⛔ 上传后必须做健康检查，不通过就回滚
3. ⛔ 重启失败后最多尝试 2 次，第 3 次停手告警
4. ⛔ 部署操作必须同步备份到 `J:\codex-bridge-main\vps-backup\`
5. ✅ 回滚后立即通知：回滚路径 + 失败原因

## 常见故障速查
| 现象 | 排查命令 |
|------|---------|
| 端口 40001 无响应 | `ssh root@47.114.75.115 "ss -tlnp \| grep 40001"` |
| 进程挂了但端口还在 | `ssh root@47.114.75.115 "ps aux \| grep node"` |
| 模型返回 400 错误 | `ssh root@47.114.75.115 "tail -50 /opt/1panel/LuoDaBridge/data/luoda.log"` |
| 配置不生效 | `ssh root@47.114.75.115 "cat /opt/1panel/LuoDaBridge/config-proxy.json"` |
| 内存不足 | `ssh root@47.114.75.115 "free -m"` |
