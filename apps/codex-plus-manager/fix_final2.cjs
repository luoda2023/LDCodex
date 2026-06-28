const fs = require('fs');
let c = fs.readFileSync('src/App.tsx', 'utf-8');
c = c.replace('await checkPluginMarketplacePrompt();', '');
const routeLine = 'type Route = "overview" | "relay" | "sessions" | "context" | "enhance" | "about" | "settings" | "proxy";';
c = c.replace(routeLine, routeLine + String.fromCharCode(10) + 'type RouteItem = { id: Route; label: string; icon: LucideIcon; badge?: string };');
c = c.replace('const navItems: { id: Route; label: string; icon: LucideIcon }[] = [', 'const navItems: RouteItem[] = [');
c = c.replace('  refreshAds: () => Promise<void>;' + String.fromCharCode(10) + '  refreshScriptMarket: () => Promise<void>;' + String.fromCharCode(10) + '  installMarketScript: (id: string) => Promise<void>;', '');
const ae = c.indexOf('};', c.indexOf('type Actions = {'));
const em = String.fromCharCode(10) + '  repairPluginMarketplace: () => Promise<void>;' + String.fromCharCode(10) + '  refreshZedRemoteProjects: () => Promise<void>;' + String.fromCharCode(10) + '  openZedRemoteProject: (project: any) => Promise<void>;' + String.fromCharCode(10) + '  forgetZedRemoteProject: (id: string) => Promise<void>;' + String.fromCharCode(10) + '  setUserScriptEnabled: (id: string, enabled: boolean) => Promise<void>;' + String.fromCharCode(10) + '  deleteUserScript: (id: string) => Promise<void>;';
c = c.slice(0, ae) + em + c.slice(ae);
const js = c.indexOf('          {pluginMarketplacePrompt ? (');
const je = c.indexOf('      ) : null}', js);
if (js >= 0 && je >= 0) c = c.slice(0, js) + c.slice(je + 13);
c = c.replace('    delete settings.mobileControlRelayUrl;' + String.fromCharCode(10) + '    delete settings.mobileControlRoom;' + String.fromCharCode(10) + '    delete settings.mobileControlKey;', '');
// Remove mobileControl switch cases - simpler approach just delete those lines
const mcs = c.indexOf('    const mobileControlKeys:');
if (mcs >= 0) { const mce = c.indexOf('  }', mcs) + 4; c = c.slice(0, mcs) + '    // mobile control fields removed' + c.slice(mce); }
c = c.split('PluginMarketplaceStatusResult').join('any');
c = c.split('AdItem').join('any');
c = c.split('ZedRemoteProject').join('any');
c = c.split('ZedRemoteProjectsResult').join('any');
c = c.split("'zedRemote': 'Zed Remote',").join('');
const bs = 'type BackendSettings = {';
c = c.replace(bs, bs + String.fromCharCode(10) + '  codexAppThreadIdBadge?: boolean;' + String.fromCharCode(10) + '  codexAppZedRemoteOpen?: boolean;' + String.fromCharCode(10) + '  zedRemoteProjectRegistryEnabled?: boolean;' + String.fromCharCode(10) + '  zedRemoteSyncToZedSettings?: boolean;' + String.fromCharCode(10) + '  zedRemoteOpenStrategy?: string;' + String.fromCharCode(10) + '  mobileControlRelayUrl?: string;' + String.fromCharCode(10) + '  mobileControlRoom?: string;' + String.fromCharCode(10) + '  mobileControlKey?: string;');
c = c.replace('const setEnhanceFlag = (flag: keyof BackendSettings, value: boolean) => {', 'const setEnhanceFlag = (flag: string, value: boolean) => {');
c = c.replace(', zedRemoteProjects, ', ', ');
c = c.replace('{item.badge ? <span className="nav-badge">{item.badge}</span> : null}', '');
['function MobileControlScreen(', 'function ZedRemoteProjectSection(', 'function PluginMarketplacePromptDialog('].forEach(f => {
  const idx = c.indexOf(f);
  if (idx >= 0) {
    let d = 0, e = idx;
    for (let i = idx; i < c.length; i++) { if (c[i] === '{') d++; if (c[i] === '}') d--; if (d === 0 && i > idx + 10) { e = i + 1; break; } }
    c = c.slice(0, idx) + c.slice(e); console.log('Removed', f);
  }
});
c = c.replace(/const \[pluginMarketplaceProgress[^\n]*\n/, '');
c = c.replace(/const \[pluginMarketplacePrompt[^\n]*\n/, '');
c = c.replace("'mobile': '手机控制',", '');
// Remove remaining mobileControl switch cases line by line
c = c.split(String.fromCharCode(10)).filter(l => !l.includes('mobileControlRelayUrl') && !l.includes('mobileControlRoom') && !l.includes('mobileControlKey') && !l.includes('mobileControlKeys')).join(String.fromCharCode(10));
fs.writeFileSync('src/App.tsx', c, 'utf-8');
console.log('Fixed. Size:', c.length);
