import { DatabaseSync } from "node:sqlite";
import { existsSync } from "fs";

const dbPath = process.argv[2] || "data/admin.db";
console.log("DB path:", dbPath);

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode=WAL");

// Ensure provider_tokens table exists with correct schema
db.exec(`CREATE TABLE IF NOT EXISTS provider_tokens (
  provider_name TEXT PRIMARY KEY,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
)`);
console.log("Table ensured");

// Check for bad entries
let before = db.prepare("SELECT provider_name, total_tokens FROM provider_tokens WHERE provider_name IN ('1','2','3')").all();
console.log("Bad entries before:", JSON.stringify(before));

// Delete them
const info = db.prepare("DELETE FROM provider_tokens WHERE provider_name IN ('1','2','3')").run();
console.log("Deleted", info.changes, "rows");

// Verify
let after = db.prepare("SELECT provider_name, total_tokens FROM provider_tokens WHERE provider_name IN ('1','2','3')").all();
console.log("Bad entries after:", JSON.stringify(after));

// Show remaining
let all = db.prepare("SELECT provider_name, total_tokens FROM provider_tokens ORDER BY total_tokens DESC").all();
console.log("Remaining providers:", all.map(r => r.provider_name + ":" + r.total_tokens));
