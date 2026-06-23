const fs = require('fs');

// proxy.rs: simpler fix - just use as_str
let proxy = fs.readFileSync('crates/codex-plus-core/src/proxy.rs', 'utf8');
// The fix: env.get(&*name) -> env.get(name.as_str()) as that was the original intent
proxy = proxy.replace('env.get(&*name)', 'env.get(name.as_str())');
fs.writeFileSync('crates/codex-plus-core/src/proxy.rs', proxy);

// relay_switch.rs: fix the iterator chain
let rs = fs.readFileSync('crates/codex-plus-core/src/relay_switch.rs', 'utf8');
rs = rs.replace(
  '.into_iter()\n    .filter(|section| !section.is_empty())\n    .collect::<Vec<_>>()',
  '.into_iter()\n    .filter(|section| !section.is_empty())\n    .collect::<Vec<&str>>()'
);
rs = rs.replace(
  '.iter().map(|s| *s).collect::<Vec<&str>>().join(\"\\n\\n\")',
  '.join(\"\\n\\n\")'
);
fs.writeFileSync('crates/codex-plus-core/src/relay_switch.rs', rs);

console.log('Fixed');
