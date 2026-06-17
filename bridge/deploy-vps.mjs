import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';

const conn = new Client();

const localBase = 'J:/luoda-bridge';
const remoteBase = '/root/codex-bridge-main';

const filesToUpload = [
  '/lib/server.mjs',
  '/lib/config-store.mjs',
  '/lib/protocol/openai-chat.mjs',
  '/admin/index.html',
  '/data/tokens.json',
  '/data/token-by-provider.json',
  '/data/token-log.json'
];

conn.on('ready', () => {
  console.log('SSH connected!');
  
  conn.exec('cp /root/codex-bridge-main/data/tokens.json /root/codex-bridge-main/data/tokens.json.bak && cp /root/codex-bridge-main/data/token-by-provider.json /root/codex-bridge-main/data/token-by-provider.json.bak && cp /root/codex-bridge-main/data/token-log.json /root/codex-bridge-main/data/token-log.json.bak && echo backup_done', (err, stream) => {
    let out = '';
    stream.on('data', d => out += d.toString());
    stream.on('close', () => {
      console.log('Backup:', out.trim());
      
      conn.sftp((err, sftp) => {
        if (err) { console.log('SFTP error:', err.message); conn.end(); return; }
        
        const uploadNext = (idx) => {
          if (idx >= filesToUpload.length) {
            console.log('All files uploaded!');
            sftp.end();
            
            console.log('Restarting service...');
            // ★ fix: 用 index\.mjs 匹配，而不是 "node index.mjs"（实际命令行有 --env-file 参数）
            conn.exec('cd /root/codex-bridge-main && pkill -f "index\\.mjs" 2>/dev/null; sleep 2; NODE_OPTIONS="--max-old-space-size=128" nice -n 10 node index.mjs > data/luoda.log 2>&1 & sleep 3 && echo started', (err2, stream2) => {
              let out2 = '';
              stream2.on('data', d => out2 += d.toString());
              stream2.on('close', () => {
                console.log('Restart:', out2.trim());
                
                setTimeout(() => {
                  conn.exec('cat /root/codex-bridge-main/data/tokens.json | head -5', (err3, stream3) => {
                    let out3 = '';
                    stream3.on('data', d => out3 += d.toString());
                    stream3.on('close', () => {
                      console.log('=== Deployed tokens.json ===');
                      console.log(out3);
                      conn.end();
                    });
                  });
                }, 3000);
              });
            });
            return;
          }
          
          const relPath = filesToUpload[idx];
          const localFile = localBase + relPath;
          const remoteFile = remoteBase + relPath.replace(/\\/g, '/');
          
          console.log('Uploading:', path.basename(localFile));
          
          const readStream = fs.createReadStream(localFile);
          const writeStream = sftp.createWriteStream(remoteFile);
          
          writeStream.on('close', () => {
            console.log('  OK:', path.basename(localFile));
            uploadNext(idx + 1);
          });
          
          writeStream.on('error', (e) => {
            console.log('  FAIL:', path.basename(localFile), e.message);
            uploadNext(idx + 1);
          });
          
          readStream.pipe(writeStream);
        };
        
        uploadNext(0);
      });
    });
  });
}).on('error', (err) => {
  console.log('SSH error:', err.message);
}).connect({
  host: '47.114.75.115', port: 22, username: 'root', password: 'Lkw-666999'
});
