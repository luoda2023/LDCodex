const fs=require('fs');
const file='crates/codex-plus-core/src/install/windows.rs';
let text=fs.readFileSync(file,'utf8');
text=text.replace('LDCodex 绠＄悊宸ュ叿.lnk','LDCodex 管理工具.lnk');
fs.writeFileSync(file,text,'utf8');
console.log('patched shortcut name with node utf8');
