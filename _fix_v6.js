const fs = require('fs');
let c = fs.readFileSync('apps/codex-plus-manager/src-tauri/src/commands.rs', 'utf8');
// Fix: request.profile_id -> requested_profile_id (already cloned)
c = c.replace('profile.id == request.profile_id', 'profile.id == requested_profile_id');
fs.writeFileSync('apps/codex-plus-manager/src-tauri/src/commands.rs', c);
console.log('commands fixed');

// Fix Tauri frontendDist - create directory
const mkdirSync = require('fs').mkdirSync;
try { mkdirSync('apps/codex-plus-manager/dist', {recursive:true}); } catch(e) {}
console.log('dist dir created');
