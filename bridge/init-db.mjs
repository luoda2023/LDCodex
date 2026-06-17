import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'fs';

const db = new DatabaseSync('/root/codex-bridge-main/data/admin.db');
db.prepare("DROP TABLE IF EXISTS provider_tokens").run();
db.prepare("CREATE TABLE IF NOT EXISTS provider_tokens (provider_name TEXT PRIMARY KEY, total_tokens INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0)").run();

const t = JSON.parse(readFileSync('/root/codex-bridge-main/data/tokens.json', 'utf8'));
console.log('tokens.json byProvider:', t.byProvider.length);

const ins = db.prepare("INSERT INTO provider_tokens (provider_name, total_tokens, updated_at) VALUES (?, ?, ?)");
const now = Date.now();
let count = 0;
t.byProvider.forEach(p => {
  ins.run(p.name, p.tokens, now);
  count++;
});
console.log('DB init: ' + count + ' providers inserted');

const rows = db.prepare("SELECT provider_name, total_tokens FROM provider_tokens ORDER BY total_tokens DESC LIMIT 5").all();
rows.forEach(r => console.log(r.provider_name, (r.total_tokens/1000000).toFixed(1) + 'M'));
db.close();
