const fs = require('fs');
let c = fs.readFileSync('src/App.tsx', 'utf-8');

// Helper
const NL = String.fromCharCode(10);

c = c
  .replace('await checkPluginMarketplacePrompt();', '')
  .replace(
    'type Route = "overview" | "relay" | "sessions" | "context" | "enhance" | "about" | "settings" | "proxy";',
    'type Route = "overview" | "relay" | "sessions" | "context" | "enhance" | "about" | "settings" | "proxy";' + NL + 'type RouteItem = { id: Route; label: string; icon: LucideIcon; badge?: string };'
  )
  .replace(
    'const navItems: { id: Route; label: string; icon: LucideIcon }[] = [',
    'const navItems: RouteItem[] = ['
  )
  .replace('{item.badge ? <span className="nav-badge">{item.badge}</span> : null}', '')
  .replace('  refreshAds: () => Promise<void>;' + NL + '  refreshScriptMarket: () => Promise<void>;' + NL + '  installMarketScript: (id: string) => Promise<void>;' + NL, '')
  .replace(', zedRemoteProjects, ', ', ')
  .replace("'zedRemote': 'Zed Remote'," + NL, '')
  .replace("'mobile': '手机控制'," + NL, '')
  .replace('    delete settings.mobileControlRelayUrl;' + NL + '    delete settings.mobileControlRoom;' + NL + '    delete settings.mobileControlKey;' + NL, '')
  .replace(/PluginMarketplaceStatusResult/g, 'any')
  .replace(/AdItem/g, 'any')
  .replace(/ZedRemoteProject/g, 'any')
  .replace(/ZedRemoteProjectsResult/g, 'any')
  .replace(
    'type BackendSettings = {',
    'type BackendSettings = {' + NL + '  codexAppThreadIdBadge?: boolean;' + NL + '  codexAppZedRemoteOpen?: boolean;' + NL + '  zedRemoteProjectRegistryEnabled?: boolean;' + NL + '  zedRemoteSyncToZedSettings?: boolean;' + NL + '  zedRemoteOpenStrategy?: string;' + NL + '  mobileControlRelayUrl?: string;' + NL + '  mobileControlRoom?: string;' + NL + '  mobileControlKey?: string;'
  )
  .replace(
    'const setEnhanceFlag = (flag: keyof BackendSettings, value: boolean) => {',
    'const setEnhanceFlag = (flag: string, value: boolean) => {'
  );

// Remove PluginMarketplace JSX block
const jsxStart = c.indexOf('          {pluginMarketplacePrompt ? (');
const jsxEnd = c.indexOf('      ) : null}', jsxStart);
if (jsxStart >= 0 && jsxEnd >= 0) c = c.slice(0, jsxStart) + c.slice(jsxEnd + 13);

// Remove mobileControlKeys block
const mcStart = c.indexOf('    const mobileControlKeys:');
if (mcStart >= 0) {
  const mcEnd = c.indexOf('  };', mcStart) + 4;
  c = c.slice(0, mcStart) + c.slice(mcEnd);
}

// Add extra Actions methods
const actionsEnd = c.indexOf('};', c.indexOf('type Actions = {'));
const extraMethods = NL + '  repairPluginMarketplace: () => Promise<void>;' + NL + '  refreshZedRemoteProjects: () => Promise<void>;' + NL + '  openZedRemoteProject: (project: any) => Promise<void>;' + NL + '  forgetZedRemoteProject: (id: string) => Promise<void>;' + NL + '  setUserScriptEnabled: (id: string, enabled: boolean) => Promise<void>;' + NL + '  deleteUserScript: (id: string) => Promise<void>;';
c = c.slice(0, actionsEnd) + extraMethods + c.slice(actionsEnd);

// Remove mobileControl from switch cases - remove lines containing these references
let lines = c.split(NL);
lines = lines.filter(l => {
  if (l.includes('mobileControlRelayUrl') && l.includes('case')) return false;
  if (l.includes('mobileControlRoom') && l.includes('case')) return false;
  if (l.includes('mobileControlKey') && l.includes('case')) return false;
  if (l.includes('mobileControlRelayUrl') && l.includes('encodeURIComponent')) return false;
  if (l.includes('mobileControlRoom') && l.includes('= value')) return false;
  if (l.includes('mobileControlKey') && l.includes('= value')) return false;
  if (l.includes('break;') && lines.indexOf(l) > 0 && lines[lines.indexOf(l)-1].includes('mobileControl')) return false;
  return true;
});
c = lines.join(NL);

// Remove function blocks
['function MobileControlScreen(', 'function PluginMarketplacePromptDialog(', 'function ZedRemoteProjectSection('].forEach(f => {
  const idx = c.indexOf(f);
  if (idx >= 0) {
    let d = 0, e = idx;
    for (let i = idx; i < c.length; i++) {
      if (c[i] === '{') d++;
      if (c[i] === '}') d--;
      if (d === 0 && i > idx + 10) { e = i + 1; break; }
    }
    c = c.slice(0, idx) + c.slice(e);
  }
});

// Remove state declarations
c = c.replace(/const \[pluginMarketplaceProgress[^\n]*\n/, '');
c = c.replace(/const \[pluginMarketplacePrompt[^\n]*\n/, '');

fs.writeFileSync('src/App.tsx', c, 'utf-8');
console.log('Done. Size:', c.length);
