const fs = require('fs');
let c = fs.readFileSync('apps/codex-plus-manager/src/App.tsx', 'utf-8');

let before = '<Button onClick={() => void actions.launch()}>';
let after = '<Button onClick={() => void actions.launchBridge()}>';
let count = 0;
let idx = c.indexOf(before);
while (idx >= 0) {
    let chunk = c.substring(idx, idx + 80);
    if (chunk.includes('\u542F\u52A8\u4EE3\u7406')) {
        c = c.substring(0, idx) + after + c.substring(idx + before.length);
        count++;
    }
    idx = c.indexOf(before, idx + 1);
    if (count > 5) break;
}
console.log('Replaced', count, 'buttons');
fs.writeFileSync('apps/codex-plus-manager/src/App.tsx', c, 'utf-8');
