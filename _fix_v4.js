const fs = require('fs');
let content = fs.readFileSync('crates/codex-plus-data/src/provider_sync.rs', 'utf8');
let old = '    Ok(stmt\n        .query_map([], |row| row.get::<_, String>(1))?\n        .collect::<rusqlite::Result<HashSet<_>>>()?)\n}';
let newText = '    let result = stmt\n        .query_map([], |row| row.get::<_, String>(1))?\n        .collect::<rusqlite::Result<HashSet<_>>>()?;\n    Ok(result)\n}';
content = content.replace(old, newText);
fs.writeFileSync('crates/codex-plus-data/src/provider_sync.rs', content);
console.log('fixed');
