const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');
const lines = content.split('\n');
let changes = 0;

// 1. Remove checkPluginMarketplacePrompt call
for(let i = 0; i < lines.length; i++) {
  if(lines[i].includes('checkPluginMarketplacePrompt()')) { lines.splice(i, 1); changes++; break; }
}

// 2. Remove zedRemoteProjects from deps
for(let i = 0; i < lines.length; i++) {
  if(lines[i].includes('zedRemoteProjects')) { lines[i] = lines[i].replace(', zedRemoteProjects', ''); changes++; break; }
}

// 3. Remove item.badge line
for(let i = 0; i < lines.length; i++) {
  if(lines[i].includes('item.badge')) { lines.splice(i, 1); changes++; break; }
}

// 4. Remove Actions interface entries
const actionKeys = ['refreshAds', 'refreshScriptMarket', 'installMarketScript'];
for(let key of actionKeys) {
  for(let i = 0; i < lines.length; i++) {
    if(lines[i].includes(key) && lines[i].includes('Promise<void>')) { lines.splice(i, 1); changes++; break; }
  }
}

// 5. Fix navigate
for(let i = 0; i < lines.length; i++) {
  if(lines[i].includes('navigate') && lines[i].includes('about')) {
    lines[i] = lines[i].split('navigate').join('setRoute');
    changes++;
  }
}

// 6. Remove lines with removed field keys
const removeKeys = ['codexAppPluginMarketplaceUnlock', 'zedRemoteProjectRegistryEnabled', 'zedRemoteOpenStrategy', 'zedRemoteSyncToZedSettings', 'mobileControlRelayUrl', 'mobileControlRoom', 'mobileControlKey', 'codexAppZedRemoteOpen', 'setPluginMarketplacePrompt'];
for(let key of removeKeys) {
  for(let i = lines.length-1; i >= 0; i--) {
    if(lines[i].includes(key)) { lines.splice(i, 1); changes++; }
  }
}

// 7. Remove mobile route
for(let i = 0; i < lines.length; i++) {
  if(lines[i].includes('mobile') && lines[i].includes('Route')) {
    lines[i] = lines[i].split('|').filter(x => !x.includes('mobile')).join('|');
    changes++;
  }
}

fs.writeFileSync('src/App.tsx', lines.join('\n'), 'utf8');
console.log('Changes:', changes, 'Lines:', lines.length);
