const fs = require("fs");
let c = fs.readFileSync("apps/codex-plus-manager/src/App.tsx","utf8");

// 1. Remove checkPluginMarketplacePrompt call
c = c.replace("await checkPluginMarketplacePrompt();", "/* removed */");

// 2. Fix SVG inline style for JSX (remove the hand-written SVG, use text instead)
c = c.replace(
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  '<Rocket className="h-3 w-3" style={{verticalAlign:"middle",marginRight:4}} />'
);

// 3. Fix SVG JSX property names
c = c.replace(/stroke-width=/g, "strokeWidth=");
c = c.replace(/stroke-linecap=/g, "strokeLinecap=");
c = c.replace(/stroke-linejoin=/g, "strokeLinejoin=");

// 4. Add missing fields to Actions interface (only first occurrence)
c = c.replace(
  "export interface Actions {",
  "export interface Actions { refreshAds?: ()=>Promise<void>; refreshScriptMarket?: ()=>Promise<void>; installMarketScript?: (id:string)=>Promise<void>; repairPluginMarketplace?: ()=>Promise<void>;"
);

// 5. Add missing fields to BackendSettings interface
c = c.replace(
  "export interface BackendSettings {",
  "export interface BackendSettings { mobileControlRelayUrl?: string; mobileControlRoom?: string; mobileControlKey?: string; codexAppPluginMarketplaceUnlock?: boolean; codexAppPasteFix?: boolean; codexAppThreadIdBadge?: boolean;"
);

// 6. Fix .badge on routes (remove it)
c = c.replace(/\.badge/g, "");

fs.writeFileSync("apps/codex-plus-manager/src/App.tsx", c, "utf8");
console.log("All fixes applied successfully");
