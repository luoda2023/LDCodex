const fs = require('fs');
// FIX 1: protocol_proxy.rs - inner doc comment issue
let pp = fs.readFileSync('crates/codex-plus-core/src/protocol_proxy.rs', 'utf8');
pp = pp.replace(/^\/\/\!/gm, '//');
fs.writeFileSync('crates/codex-plus-core/src/protocol_proxy.rs', pp);
console.log('protocol_proxy.rs fixed');
// FIX 2: proxy.rs - str_as_str unstable
let proxy = fs.readFileSync('crates/codex-plus-core/src/proxy.rs', 'utf8');
proxy = proxy.replace('name.as_str()', 'name.as_ref()');
fs.writeFileSync('crates/codex-plus-core/src/proxy.rs', proxy);
console.log('proxy.rs fixed');
// FIX 3: relay_switch.rs - Vec<&&str> join
let rs = fs.readFileSync('crates/codex-plus-core/src/relay_switch.rs', 'utf8');
rs = rs.replace('sections.iter().map(|s| *s).collect::<Vec<_>>().join(\"\\n\\n\")', 'sections.iter().map(|s| *s).collect::<Vec<&str>>().join(\"\\n\\n\")');
fs.writeFileSync('crates/codex-plus-core/src/relay_switch.rs', rs);
console.log('relay_switch.rs fixed');
// FIX 4: app_paths.rs - unused variable
let ap = fs.readFileSync('crates/codex-plus-core/src/app_paths.rs', 'utf8');
ap = ap.replace('let d = dot_char();', 'let _d = dot_char();');
fs.writeFileSync('crates/codex-plus-core/src/app_paths.rs', ap);
console.log('app_paths.rs fixed');
console.log('ALL DONE');
