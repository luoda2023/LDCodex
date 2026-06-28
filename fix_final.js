const fs = require('fs');
const p = 'apps/codex-plus-manager/src/App.tsx';
let c = fs.readFileSync(p, 'utf-8');
let lines = c.split('\n');
let out = [];
let skipFunc = false;
let braceCount = 0;

for (let i = 0; i < lines.length; i++) {
  let r = lines[i];
  let t = r.trim();
  
  // Skip entire function definitions for components
  if (t.startsWith('function ') && (
    t.includes('ZedRemote') || t.includes('UserScripts') || 
    t.includes('Recommendations') || t.includes('MarketScript') ||
    t.includes('zedRemoteHost') || t.includes('zedRemoteSource')
  )) {
    skipFunc = true;
    braceCount = 0;
    continue;
  }
  
  // Skip const async function definitions
  if (t.startsWith('const ') && t.includes('= async') && (
    t.includes('refreshScriptMarket') || t.includes('installMarketScript') ||
    t.includes('uninstallMarketScript') || t.includes('refreshZedRemoteProjects') ||
    t.includes('openZedRemoteProject') || t.includes('forgetZedRemoteProject')
  )) {
    skipFunc = true;
    braceCount = 0;
    continue;
  }
  
  if (skipFunc) {
    for (let ch of r) {
      if (ch === '{') braceCount++;
      if (ch === '}') braceCount--;
    }
    if (braceCount <= 0 && t === '}') {
      skipFunc = false;
    }
    continue;
  }
  
  // Skip unwanted lines
  if (t.includes('zedRemote') || t.includes('ZedRemote') || 
      t.includes('ScriptMarket') || t.includes('SCRIPT_MARKET') ||
      t.includes('syncMarketInstalledState') ||
      t.includes('脚本市场') || t.includes('推荐内容') || t.includes('Zed 远程')) {
    continue;
  }
  
  // Replace supplier config with model config
  r = r.replace(/\u4f9b\u5e94\u5546\u914d\u7f6e/g, '\u6a21\u578b\u914d\u7f6e');
  
  out.push(r);
}

c = out.join('\n');
// Clean multiple blank lines
c = c.replace(/\n{4,}/g, '\n\n\n');

fs.writeFileSync(p, c, 'utf-8');
console.log('OK. zedRemote:', (c.match(/zedRemote/g)||[]).length, 'ScriptMarket:', (c.match(/ScriptMarket/g)||[]).length);
