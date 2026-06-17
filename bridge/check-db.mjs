import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  conn.exec('cd /root/codex-bridge-main && node -e "const{DatabaseSync}=require(\'node:sqlite\');const db=new DatabaseSync(\'data/admin.db\');const tables=db.prepare(\"SELECT name FROM sqlite_master WHERE type=\'table\'\").all();console.log(\'Tables:\',JSON.stringify(tables));if(tables.length){const cnt=db.prepare(\"SELECT COUNT(*) as cnt FROM provider_tokens\").all();console.log(\'Count:\',cnt[0].cnt);const rows=db.prepare(\"SELECT * FROM provider_tokens LIMIT 3\").all();console.log(\'Rows:\',JSON.stringify(rows))}db.close();"', (err, stream) => {
    let o = '';
    stream.on('data', d => o += d.toString());
    stream.on('close', () => {
      console.log(o || '(no output)');
      conn.end();
    });
  });
}).on('error', (err) => { console.log('SSH error:', err.message); }).connect({
  host: '47.114.75.115', port: 22, username: 'root', password: 'Lkw-666999'
});
