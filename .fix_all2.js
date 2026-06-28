const fs=require('fs');
let c=fs.readFileSync('apps/codex-plus-manager/src/App.tsx','utf8');

// 精确修复：BackendSettings 接口只加一次字段
// 找到 export interface BackendSettings 并替换，只替换第一个
let idx=c.indexOf('export interface BackendSettings {');
if(idx>=0) {
  // 找到最近的 }
  let endIdx=c.indexOf('}', idx);
  let block=c.substring(idx, endIdx+1);
  // 检查是否已有这些字段
  if(!block.includes('mobileControlRelayUrl')) {
    let newBlock=block.replace('{', '{ mobileControlRelayUrl?: string; mobileControlRoom?: string; mobileControlKey?: string;');
    c=c.substring(0,idx)+newBlock+c.substring(endIdx+1);
  }
  if(!c.includes('codexAppPluginMarketplaceUnlock')) {
    let idx2=c.indexOf('export interface BackendSettings {');
    if(idx2>=0) {
      let endIdx2=c.indexOf('}', idx2);
      c=c.substring(0,endIdx2)+'codexAppPluginMarketplaceUnlock?: boolean; codexAppPasteFix?: boolean; codexAppThreadIdBadge?: boolean; '+c.substring(endIdx2);
    }
  }
}

// 删除pluginMarketplace相关dialog
c=c.replace(/const PluginMarketplacePromptDialog[\s\S]*?return \([\s\S]*?\);[^}]*\}/g,'const PluginMarketplacePromptDialog = ()=>null;');

// badge routes
c=c.replace(/\.badge/g,'/*badge removed*/');

fs.writeFileSync('apps/codex-plus-manager/src/App.tsx',c,'utf8');
console.log('Pass 2 done');
