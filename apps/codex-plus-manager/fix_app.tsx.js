const fs = require('fs');
let c = fs.readFileSync('src/App.tsx', 'utf-8');

// 1. Remove checkPluginMarketplacePrompt call  
c = c.replace('await checkPluginMarketplacePrompt();', '');

// 2. Route type  
const routeLine = 'type Route = "overview" | "relay" | "sessions" | "context" | "enhance" | "about" | "settings" | "proxy";';
const routeItemLine = 'type RouteItem = { id: Route; label: string; icon: LucideIcon; badge?: string };';
c = c.replace(routeLine, routeLine + '\n' + routeItemLine);

// 3. navItems type
c = c.replace(
  'const navItems: { id: Route; label: string; icon: LucideIcon }[] = [',
  'const navItems: RouteItem[] = ['
);

// 4. Actions type - remove refreshAds etc
c = c.replace(
  '  refreshAds: () => Promise<void>;\n  refreshScriptMarket: () => Promise<void>;\n  installMarketScript: (id: string) => Promise<void>;',
  ''
);

// 5. Add missing Actions methods  
const actionsEnd = c.indexOf('};', c.indexOf('type Actions = {'));
const extraMethods = \n  repairPluginMarketplace: () => Promise<void>;\n  refreshZedRemoteProjects: () => Promise<void>;\n  openZedRemoteProject: (project: any) => Promise<void>;\n  forgetZedRemoteProject: (id: string) => Promise<void>;\n  setUserScriptEnabled: (id: string, enabled: boolean) => Promise<void>;\n  deleteUserScript: (id: string) => Promise<void>;;
c = c.slice(0, actionsEnd) + extraMethods + c.slice(actionsEnd);

// 6. Remove PluginMarketplaceDialog JSX block  
const jsxStart = c.indexOf('          {pluginMarketplacePrompt ? (');
const jsxEnd = c.indexOf('      ) : null}', jsxStart);
if (jsxStart >= 0 && jsxEnd >= 0) {
  c = c.slice(0, jsxStart) + c.slice(jsxEnd + 13);
}

// 7. Remove mobileControl delete
c = c.replace(
  '    delete settings.mobileControlRelayUrl;\n    delete settings.mobileControlRoom;\n    delete settings.mobileControlKey;',
  ''
);

// 8. Remove mobileControl switch cases
c = c.replace(
  "      case 'mobileControlRelayUrl':\n        settings.mobileControlRelayUrl = encodeURIComponent(value);\n        break;\n      case 'mobileControlRoom':\n        settings.mobileControlRoom = value;\n        break;\n      case 'mobileControlKey':\n        settings.mobileControlKey = value;\n        break;",
  ''
);

// 9. Remove mobileControlKeys block
const mcStart = c.indexOf('    const mobileControlKeys:');
const mcEnd = c.indexOf('  }', mcStart) + 4;
if (mcStart >= 0) {
  c = c.slice(0, mcStart) + '    // mobile control fields removed' + c.slice(mcEnd);
}

// 10. PluginMarketplaceStatusResult -> any  
c = c.replaceAll('PluginMarketplaceStatusResult', 'any');

// 11. Remove zedRemote from route name mapping
c = c.replace("'zedRemote': 'Zed Remote',", '');

// 12. AdItem -> any, ZedRemoteProject -> any
c = c.replaceAll('AdItem', 'any');
c = c.replaceAll('ZedRemoteProject', 'any');
c = c.replaceAll('ZedRemoteProjectsResult', 'any');

// 13. Add missing fields to BackendSettings
const bsLine = 'type BackendSettings = {';
c = c.replace(bsLine, bsLine + '\n  codexAppThreadIdBadge?: boolean;\n  codexAppZedRemoteOpen?: boolean;\n  zedRemoteProjectRegistryEnabled?: boolean;\n  zedRemoteSyncToZedSettings?: boolean;\n  zedRemoteOpenStrategy?: string;\n  mobileControlRelayUrl?: string;\n  mobileControlRoom?: string;\n  mobileControlKey?: string;');

// 14. setEnhanceFlag type
c = c.replace(
  'const setEnhanceFlag = (flag: keyof BackendSettings, value: boolean) => {',
  'const setEnhanceFlag = (flag: string, value: boolean) => {'
);

// 15. Remove zedRemoteProjects from dependency array
c = c.replace(', zedRemoteProjects, ', ', ');

fs.writeFileSync('src/App.tsx', c);
console.log('Fixed App.tsx');
