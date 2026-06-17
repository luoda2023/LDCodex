import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'fs';
const db = new DatabaseSync('/root/codex-bridge-main/data/admin.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', JSON.stringify(tables));
if (tables.length) {
  const cnt = db.prepare('SELECT COUNT(*) as cnt FROM provider_tokens').all();
  console.log('Count:', cnt[0].cnt);
  const rows = db.prepare('SELECT * FROM provider_tokens LIMIT 3').all();
  console.log('Rows:', JSON.stringify(rows));
}
db.close();

// Also check tokens.json
const t = JSON.parse(readFileSync('/root/codex-bridge-main/data/tokens.json', 'utf8'));
console.log('tokens.json labels:', t.labels.join(', '));
console.log('tokens.json byProvider:', t.byProvider.length, 'entries');
