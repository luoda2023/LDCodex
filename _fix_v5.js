const fs = require('fs');
let content = fs.readFileSync('crates/codex-plus-data/src/provider_sync.rs', 'utf8');
content = content.replace(
  '    Ok(stmt\n        .query_map([], |row| row.get::<_, String>(1))?\n        .collect::<rusqlite::Result<HashSet<_>>>()?)\n}',
  '    let result = Ok(stmt\n        .query_map([], |row| row.get::<_, String>(1))?\n        .collect::<rusqlite::Result<HashSet<_>>>()?);\n    result\n}'
);
fs.writeFileSync('crates/codex-plus-data/src/provider_sync.rs', content);
console.log('fixed');
