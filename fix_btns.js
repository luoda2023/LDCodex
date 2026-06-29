const fs = require('fs');
const p = 'apps/codex-plus-manager/src/App.tsx';
let buf = fs.readFileSync(p);
let c = buf.toString('latin1');

c = c.replace('>启动 LDCodex<', '>启动代理<');
c = c.replace('>重启 LDCodex<', '>重启代理<');
c = c.replace('title="重启 LDCodex"', 'title="重启代理"');
c = c.replace('label: "Codex增强"', 'label: "增强设置"');
c = c.replace('title="Codex 启动参数"', 'title="启动参数"');
c = c.replace('"Codex 应用路径"', '"应用路径"');
c = c.replace('CODEXX开发', 'LDCodex');

console.log('launch text:', (c.match(/>启动 LDCodex</g)||[]).length);
console.log('restart text:', (c.match(/>重启 LDCodex</g)||[]).length);

fs.writeFileSync(p, c, 'latin1');
