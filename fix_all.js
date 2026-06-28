const fs = require('fs');
const p = 'apps/codex-plus-manager/src/App.tsx';
let c = fs.readFileSync(p, 'utf-8');
const lines = c.split('\n');
const removeIndices = new Set();

// Scan again for all remaining zedRemote/ScriptMarket lines
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  if (t.includes('zedRemote') || t.includes('ZedRemote') || 
      t.includes('ScriptMarket') || t.includes('SCRIPT_MARKET') ||
      t.includes('syncMarketInstalledState') ||
      t.includes('Zed 远程') || t.includes('脚本市场') || t.includes('推荐内容')) {
    removeIndices.add(i);
  }
}

console.log('Removing', removeIndices.size, 'lines');

const out = lines.filter((_, idx) => !removeIndices.has(idx));
const result = out.join('\n').replace(/\u4f9b\u5e94\u5546\u914d\u7f6e/g, '\u6a21\u578b\u914d\u7f6e');

fs.writeFileSync(p, result, 'utf-8');
console.log('zedRemote:', (result.match(/zedRemote/g)||[]).length);
console.log('ScriptMarket:', (result.match(/ScriptMarket/g)||[]).length);
console.log('Supplier:', (result.match(/\u4f9b\u5e94\u5546/g)||[]).length);
