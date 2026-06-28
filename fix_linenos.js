const fs = require('fs');
const p = 'apps/codex-plus-manager/src/App.tsx';
const lines = fs.readFileSync(p, 'utf-8').split('\n');
const removeIndices = new Set();

// Single line indices to remove (0-based)
[136,137,138,139,242,317,333,334,337,524,539,545,572,601,611,640,641,642,643,714,721,
 792,793,795,802,804,814,826,928,929,931,937,938,939,942,948,954,958,959,961,
 1090,1092,1102,1817,1824,1825,1826,
 1984,1985,2080,2087,2088,2089,2743,2744,2745,2763,2764].forEach(n => removeIndices.add(n));

// Remove route description lines
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  if (t === 'zedRemote: "管理 Codex SSH 项目并加入 Zed workspace",' ||
      t === 'userScripts: "内置和用户自定义脚本清单",' ||
      t === 'recommendations: "赞助商推荐与普通推荐",') {
    removeIndices.add(i);
  }
}

const out = lines.filter((_, idx) => !removeIndices.has(idx));
const result = out.join('\n').replace(/\u4f9b\u5e94\u5546\u914d\u7f6e/g, '\u6a21\u578b\u914d\u7f6e');

fs.writeFileSync(p, result, 'utf-8');
console.log('Length:', result.length);
console.log('zedRemote:', (result.match(/zedRemote/g)||[]).length);
console.log('ScriptMarket:', (result.match(/ScriptMarket/g)||[]).length);
console.log('Supplier:', (result.match(/\u4f9b\u5e94\u5546/g)||[]).length);
