const fs=require('fs');
const file='crates/codex-plus-core/src/install/windows.rs';
let text=fs.readFileSync(file,'utf8');
text=text.replace('绠＄悊宸ュ叿','管理工具');
fs.writeFileSync(file,text);
console.log('patched windows shortcut name');
