import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';

const conn = new Client();
conn.on('ready', () => {
  // ★ 杀掉所有 index.mjs 进程，逐一 kill -15 → 等待 → kill -9
  conn.exec(`pids=$(pgrep -f "node.*index\\\\.mjs"); if [ -n "$pids" ]; then
    for pid in $pids; do
      kill -15 $pid 2>/dev/null
    done
    sleep 2
    for pid in $pids; do
      kill -9 $pid 2>/dev/null
    done
    # 等待端口释放（最多等10秒）
    for i in $(seq 1 10); do
      if ! ss -tlnp | grep -qE ":4000[0-2]"; then break; fi
      sleep 1
    done
  fi; echo "killed and ports released"', () => {
    conn.sftp((err, sftp) => {
      if (err) { console.log('SFTP error:', err.message); conn.end(); return; }
      
      // local path -> remote path mapping
      const files = [
        { local: 'J:/luoda-bridge/admin/index.html', remote: '/root/codex-bridge-main/admin/index.html' },
        { local: 'J:/luoda-bridge/admin/shared/sidebar.js', remote: '/root/codex-bridge-main/admin/shared/sidebar.js' },
        { local: 'J:/luoda-bridge/admin/shared/state.js', remote: '/root/codex-bridge-main/admin/shared/state.js' },
        { local: 'J:/luoda-bridge/admin/shared/auth.js', remote: '/root/codex-bridge-main/admin/shared/auth.js' },
        { local: 'J:/luoda-bridge/lib/server.mjs', remote: '/root/codex-bridge-main/lib/server.mjs' },
        { local: 'J:/luoda-bridge/lib/fallback.mjs', remote: '/root/codex-bridge-main/lib/fallback.mjs' },
        { local: 'J:/luoda-bridge/lib/protocol/openai-chat.mjs', remote: '/root/codex-bridge-main/lib/protocol/openai-chat.mjs' },
        { local: 'J:/luoda-bridge/lib/protocol/openai-responses.mjs', remote: '/root/codex-bridge-main/lib/protocol/openai-responses.mjs' },
        { local: 'J:/luoda-bridge/lib/config.mjs', remote: '/root/codex-bridge-main/lib/config.mjs' },
        { local: 'J:/luoda-bridge/lib/concurrency.mjs', remote: '/root/codex-bridge-main/lib/concurrency.mjs' },
      ];
      
      let i = 0;
      const next = () => {
        if (i >= files.length) {
          console.log('All files uploaded');
          sftp.end();
          
          conn.exec('cd /root/codex-bridge-main && NODE_OPTIONS="--max-old-space-size=128" nohup node --env-file=.env index.mjs > data/luoda.log 2>&1 & sleep 3; curl -s -o /dev/null -w "%{http_code}" http://localhost:40001/api/fallback 2>/dev/null || echo "check_failed"', (err, stream) => {
            let output = '';
            stream.on('data', (d) => { output += d.toString(); });
            stream.on('close', () => {
              console.log('Service started (HTTP ' + output.trim() + ')');
              setTimeout(() => { conn.end(); }, 2000);
            });
          });
          return;
        }
        const f = files[i];
        console.log('Upload:', path.basename(f.local));
        const rs = fs.createReadStream(f.local);
        const ws = sftp.createWriteStream(f.remote);
        ws.on('close', () => { console.log('  OK'); i++; next(); });
        ws.on('error', (e) => { console.log('  FAIL:', e.message); i++; next(); });
        rs.pipe(ws);
      };
      next();
    });
  });
}).on('error', (err) => { console.log('SSH error:', err.message); }).connect({
  host: '47.114.75.115', port: 22, username: 'root', password: 'Lkw-666999'
});
