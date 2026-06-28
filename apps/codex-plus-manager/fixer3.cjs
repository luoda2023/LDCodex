const fs = require('fs');
let lines = fs.readFileSync('src/App.tsx', 'utf8').split('\n');
let log = [];

// 1. Remove await checkPluginMarketplacePrompt() line
for(let i = 0; i < lines.length; i++) {
  if(lines[i].includes('checkPluginMarketplacePrompt()')) {
    lines.splice(i, 1); log.push('Removed checkPluginMarketplacePrompt at L'+(i+1)); break;
  }
}

// 2. Remove zedRemoteProjects from dependency array
for(let i = 0; i < lines.length; i++) {
  if(lines[i].includes('zedRemoteProjects')) {
    lines[i] = lines[i].replace(', zedRemoteProjects', ''); log.push('Fixed zedRemoteProjects at L'+(i+1)); break;
  }
}

// 3. Remove item.badge line
for(let i = 0; i < lines.length; i++) {
  if(lines[i].includes('item.badge')) {
    lines.splice(i, 1); log.push('Removed item.badge at L'+(i+1)); break;
  }
}

// 4. Remove refreshAds, refreshScriptMarket, installMarketScript from Actions interface
const delKeys = ['refreshAds', 'refreshScriptMarket', 'installMarketScript'];
for(let key of delKeys) {
  for(let i = 0; i < lines.length; i++) {
    if(lines[i].includes(key) && lines[i].includes('Promise<void>')) {
      lines.splice(i, 1); log.push('Removed '+key+' at L'+(i+1)); break;
    }
  }
}

// 5. Remove PluginMarketplacePromptDialog block from render
let start = -1, end = -1;
for(let i = 0; i < lines.length; i++) {
  if(lines[i].includes('pluginMarketplacePrompt') && lines[i].trim().startsWith('{')) start = i;
  if(start >= 0 && lines[i].trim() === ')' && i > start + 1) { end = i; break; }
}
// Find the actual end - look for the closing ')' : null} 
let foundEnd = false;
for(let i = 0; i < lines.length; i++) {
  if(lines[i].includes('pluginMarketplacePrompt')) {
    // Find the opening level
    let openLevel = 0;
    for(let j = i; j < lines.length; j++) {
      openLevel += (lines[j].match(/{/g)||[]).length;
      openLevel -= (lines[j].match(/}/g)||[]).length;
      if(openLevel <= 0 && j > i + 1) { 
        // Also check if next line has ) : null}
        lines.splice(i, j - i + 1);
        log.push('Removed PluginMarketplacePromptDialog block at L'+(i+1));
        foundEnd = true; break;
      }
    }
    if(foundEnd) break;
  }
}

// 6. Remove pluginMarketplaceProgress state declaration
for(let i = 0; i < lines.length; i++) {
  if(lines[i].includes('pluginMarketplaceProgress') && lines[i].includes('useState')) {
    lines.splice(i, 1); log.push('Removed pluginMarketplaceProgress state at L'+(i+1)); break;
  }
}

fs.writeFileSync('src/App.tsx', lines.join('\n'), 'utf8');
console.log(log.join('\n'));
