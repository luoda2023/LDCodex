const fs = require('fs');
const p = 'J:\\codex-work\\LDCodex\\apps\\codex-plus-manager\\src\\App.tsx';
let c = fs.readFileSync(p, 'utf-8');

c = c.replace(/\u4f9b\u5e94\u5546\u914d\u7f6e/g, '\u6a21\u578b\u914d\u7f6e');

let lines = c.split('\n');
let out = [];
let skipFunc = false;
let braceCount = 0;

for (let i = 0; i < lines.length; i++) {
  let l = lines[i];
  let t = l.trim();
  
  // Skip function definitions for removed features
  if (t.startsWith('function ') && (
    t.includes('ZedRemote') || t.includes('UserScripts') || 
    t.includes('Recommendations') || t.includes('MarketScript') ||
    t.includes('zedRemoteHost') || t.includes('zedRemoteSource')
  )) {
    skipFunc = true;
    braceCount = 0;
    continue;
  }
  
  if (skipFunc) {
    for (let ch of l) {
      if (ch === '{') braceCount++;
      if (ch === '}') braceCount--;
    }
    if (braceCount <= 0 && t === '}') {
      skipFunc = false;
    }
    continue;
  }
  
  // Skip const function definitions
  if (t.startsWith('const ') && t.includes('= async') && (
    t.includes('refreshScriptMarket') || t.includes('installMarketScript') ||
    t.includes('uninstallMarketScript') || t.includes('refreshZedRemoteProjects') ||
    t.includes('openZedRemoteProject') || t.includes('forgetZedRemoteProject')
  )) {
    skipFunc = true;
    braceCount = 0;
    continue;
  }
  
  // Skip specific lines
  if (l.includes('zedRemote') || l.includes('ZedRemote') || 
      l.includes('ScriptMarket') || l.includes('SCRIPT_MARKET') ||
      l.includes('syncMarketInstalledState') ||
      t.includes('脚本市场') || t.includes('推荐内容') || t.includes('Zed 远程项目')) {
    continue;
  }
  
  out.push(l);
}

c = out.join('\n');

// Cleanup: remove empty space
c = c.replace(/\n{4,}/g, '\n\n\n');

fs.writeFileSync(p, c, 'utf-8');
console.log('Done. Length:', c.length);
console.log('zedRemote left:', (c.match(/zedRemote/g)||[]).length);
console.log('ScriptMarket left:', (c.match(/ScriptMarket/g)||[]).length);
