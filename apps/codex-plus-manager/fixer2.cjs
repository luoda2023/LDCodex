const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Remove MobileControlScreen function (lines 1734-1937)
const mcStart = content.indexOf('function MobileControlScreen(');
if(mcStart >= 0) {
  let rest = content.substring(mcStart);
  let braceCount = 0;
  let endIdx = 0;
  for(let i = 0; i < rest.length; i++) {
    if(rest[i] === '{') braceCount++;
    if(rest[i] === '}') braceCount--;
    if(braceCount === 0 && i > 10) { endIdx = i; break; }
  }
  if(endIdx > 0) {
    content = content.substring(0, mcStart) + content.substring(mcStart + endIdx + 1);
    console.log('Removed MobileControlScreen');
  }
}

// 2. Remove route === mobile render block
const mobileBlockStart = content.indexOf('{route === \"mobile\"');
if(mobileBlockStart >= 0) {
  let rest = content.substring(mobileBlockStart);
  let braceCount = 0;
  let endIdx = 0;
  for(let i = 0; i < rest.length; i++) {
    if(rest[i] === '{') braceCount++;
    if(rest[i] === '}') braceCount--;
    if(braceCount === 0 && i > 5) { endIdx = i; break; }
  }
  if(endIdx > 0) {
    content = content.substring(0, mobileBlockStart) + content.substring(mobileBlockStart + endIdx + 1);
    console.log('Removed mobile route block');
  }
}

// 3. Remove PluginMarketplacePromptDialog function
const ppStart = content.indexOf('function PluginMarketplacePromptDialog(');
if(ppStart >= 0) {
  let rest = content.substring(ppStart);
  let braceCount = 0;
  let endIdx = 0;
  for(let i = 0; i < rest.length; i++) {
    if(rest[i] === '{') braceCount++;
    if(rest[i] === '}') braceCount--;
    if(braceCount === 0 && i > 10) { endIdx = i; break; }
  }
  if(endIdx > 0) {
    content = content.substring(0, ppStart) + content.substring(ppStart + endIdx + 1);
    console.log('Removed PluginMarketplacePromptDialog');
  }
}

// 4. Remove ZedRemoteProjectSection function
const zrStart = content.indexOf('function ZedRemoteProjectSection(');
if(zrStart >= 0) {
  let rest = content.substring(zrStart);
  let braceCount = 0;
  let endIdx = 0;
  for(let i = 0; i < rest.length; i++) {
    if(rest[i] === '{') braceCount++;
    if(rest[i] === '}') braceCount--;
    if(braceCount === 0 && i > 10) { endIdx = i; break; }
  }
  if(endIdx > 0) {
    content = content.substring(0, zrStart) + content.substring(zrStart + endIdx + 1);
    console.log('Removed ZedRemoteProjectSection');
  }
}

// 5. Remove type/interface definitions for removed features
const removePatterns = [
  'MobileRelayServerResult',
  'MobileRelayServerStatusResult',
  'PluginMarketplacePromptResult',
  'ZedRemoteProject',
  'ZedRemoteProjectsResult',
  'PluginMarketplaceStatusResult',
  'PluginMarketplaceProgress',
  'MobileRelayServer',
  'MobileRelayServerStatus',
];
for(const p of removePatterns) {
  const idx = content.indexOf(p);
  if(idx >= 0) {
    // Find the line and remove it
    const lineStart = content.lastIndexOf('\n', idx);
    const lineEnd = content.indexOf('\n', idx);
    if(lineStart >= 0 && lineEnd > lineStart) {
      content = content.substring(0, lineStart) + content.substring(lineEnd);
      console.log('Removed type/interface', p);
    }
  }
}

// 6. Remove mobileControl related form fields 
const fieldMap = [
  'mobileControlRelayUrl',
  'mobileControlRoom', 
  'mobileControlKey',
  'codexAppPluginMarketplaceUnlock',
  'zedRemoteProjectRegistryEnabled',
  'zedRemoteOpenStrategy',
  'zedRemoteSyncToZedSettings',
  'codexAppZedRemoteOpen',
];
for(const key of fieldMap) {
  // Remove lines that reference these keys (including default value lines)
  // But be careful not to remove lines that are just 'keyof BackendSettings' checks
  const regex = new RegExp('^.*\\b' + key + '\\b.*$', 'gm');
  const matches = content.match(regex);
  if(matches) {
    for(const m of matches) {
      if(!m.includes('keyof BackendSettings') && !m.includes('as const')) {
        content = content.replace(m + '\n', '');
        console.log('Removed line containing', key);
      }
    }
  }
}

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log('Done');
