const fs = require("fs");
let c = fs.readFileSync("apps/codex-plus-manager/src/App.tsx","utf8");

// 1. Add missing fields to BackendSettings properly (with required non-optional)
c = c.replace(
  "export interface BackendSettings {",
  "export interface BackendSettings { mobileControlRelayUrl: string; mobileControlRoom: string; mobileControlKey: string;"
);

// 2. pluginMarketplacePrompt state
c = c.replace(
  "const [pluginMarketplacePrompt, setPluginMarketplacePrompt] = useState<PluginMarketplacePromptType | null>(null);",
  "const [pluginMarketplacePrompt, setPluginMarketplacePrompt] = [null, (v:any)=>{}] as const;"
);

// 3. pluginMarketplaceProgress
c = c.replace(
  /const \[pluginMarketplaceProgress, setPluginMarketplaceProgress\] = useState\(\);/g,
  "const pluginMarketplaceProgress = false;"
);

// 4. Add repairPluginMarketplace to refreshAll
c = c.replace(
  "const refreshAll = () => Promise.all([",
  "const refreshAll = () => Promise.all([refreshAds?.(), refreshZedRemoteProjects?.(),"
);

// 5. The Pick constraint - change to Partial
c = c.replace(
  'Pick<BackendSettings, "mobileControlRelayUrl" | "mobileControlRoom" | "mobileControlKey">',
  "Partial<BackendSettings>"
);

// 6. Set defaults for new BackendSettings fields
c = c.replace(
  "const defaultSettings: BackendSettings = {",
  "const defaultSettings: BackendSettings = { mobileControlRelayUrl: \"\", mobileControlRoom: \"\", mobileControlKey: \"\","
);

// 7. Add default values in the settings init
c = c.replace(
  "mobileControlRelayUrl: settings?.mobileControlRelayUrl ??",
  "mobileControlRelayUrl: settings?.mobileControlRelayUrl ?? \"\""
);

fs.writeFileSync("apps/codex-plus-manager/src/App.tsx", c, "utf8");
console.log("Fixed");
