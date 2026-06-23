const fs = require('fs');  
const cp = require('child_process');  
const fn = 'J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs';  
let d = cp.spawnSync('git', ['show', 'HEAD:' + fn]).stdout;  
d = d.toString('utf-8');  
d = d.replace(/\r\n/g, '\n');  
d = d.replace(/\x7d/g, '\n');  
fs.writeFileSync(fn, d, 'utf-8');  
console.log('ok'); 
