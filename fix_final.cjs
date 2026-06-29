const fs = require("fs");
const c = fs.readFileSync("apps/codex-plus-manager/src/App.tsx", "utf8");
let r = c;
const log = [];

// Helper
function rmBlock(t, m) {
  let i = t.indexOf(m); if (i < 0) return t;
  let b = 0, f = false, e = i;
  for (let j = i; j < t.length; j++) {
    if (t[j] === "{") { b++; f = true; }
    else if (t[j] === "}") { b--; }
    if (f && b === 0) { e = j + 1; break; }
  }
  let before = t.substring(0, i);
  let p = Math.max(before.lastIndexOf(";\n"), before.lastIndexOf("}\n"));
  if (p < 0) p = i; else p += 2;
  return t.substring(0, p) + t.substring(e);
}

// Loop 10 times to clear all
for (let iter = 0; iter < 10; iter++) {
  let prev = r;
  
  // Type definitions
  r = r.replace(/type ZedOpenStrategy[\s\S]*?"default";/g, "");
  r = r.replace(/type ZedRemoteProject = \{[^}]+\};/g, "");
  r = r.replace(/type ZedRemoteProjectsResult[\s\S]*?\};/g, "");
  r = r.replace(/type ZedRemoteOpenResult[\s\S]*?\};/g, "");
  
  // Fields
  r = r.replace(/  codexAppZedRemoteOpen: boolean;\n/g, "");
  r = r.replace(/  zedRemoteOpenStrategy: ZedOpenStrategy;\n/g, "");
  r = r.replace(/  zedRemoteProjectRegistryEnabled: boolean;\n/g, "");
  r = r.replace(/  zedRemoteSyncToZedSettings: boolean;\n/g, "");
  r = r.replace(/  contextSelectionInitialized: boolean;\n/g, "");
  
  // Defaults
  r = r.replace(/  codexAppZedRemoteOpen: true,\n/g, "");
  r = r.replace(/  zedRemoteOpenStrategy: "addToFocusedWorkspace",\n/g, "");
  r = r.replace(/  zedRemoteProjectRegistryEnabled: true,\n/g, "");
  r = r.replace(/  zedRemoteSyncToZedSettings: false,\n/g, "");
  r = r.replace(/  contextSelectionInitialized: true,\n/g, "");
  
  // State
  r = r.replace(/const \[zedRemoteProjects, setZedRemoteProjects\][^;]+;\n/g, "");
  
  // Route type
  r = r.replace(
    'type Route = "overview" | "relay" | "mobileControl" | "sessions" | "context" | "enhance" | "zedRemote" | "userScripts" | "recommendations" | "maintenance" | "about" | "settings"',
    'type Route = "overview" | "relay" | "mobileControl" | "sessions" | "context" | "enhance" | "maintenance" | "about" | "settings"'
  );
  
  // Sidebar
  r = r.replace(
    /  \{ id: "zedRemote", label: "[^"]*", icon: ExternalLink \},\n  \{ id: "userScripts", label: "[^"]*", icon: FileCode2 \},\n  \{ id: "recommendations", label: "[^"]*", icon: ExternalLink \},/g,
    ""
  );
  
  // Actions type refs
  r = r.replace(/  refreshZedRemoteProjects: \(\) => Promise<ZedRemoteProjectsResult \| null>;\n/g, "");
  r = r.replace(/  openZedRemoteProject: \(project: ZedRemoteProject, strategy\?: ZedOpenStrategy\) => Promise<void>;\n/g, "");
  r = r.replace(/  forgetZedRemoteProject: \(project: ZedRemoteProject\) => Promise<void>;\n/g, "");
  
  // Descriptions
  r = r.replace(/zedRemote: "[^"]*",\s*userScripts: "[^"]*",\s*recommendations: "[^"]*",/g, "");
  
  // Route handlers
  r = r.replace(/if \(next === "zedRemote"\) \{[\s\S]*?\}\n?/g, "");
  r = r.replace(/if \(next === "userScripts"\) \{[\s\S]*?\}\n?/g, "");
  r = r.replace(/if \(next === "recommendations"\) [^;]+;\n?/g, "");
  
  // Branding
  r = r.replaceAll("\u4f9b\u5e94\u5546\u914d\u7f6e", "\u6a21\u578b\u914d\u7f6e");
  r = r.replaceAll("\u542f\u52a8 LDCodex", "\u542f\u52a8\u4ee3\u7406");
  r = r.replaceAll("\u542f\u52a8Codex", "\u542f\u52a8\u4ee3\u7406");
  r = r.replaceAll("\u6253\u5f00\u7ba1\u7406\u9762\u677f", "\u6253\u5f00\u4ee3\u7406\u4fe1\u606f\u9875");
  r = r.replaceAll("github.com/BigPizzaV3/CodexPlusPlus", "github.com/luoda2023/LDCodex");
  
  // Debug/Helper
  r = r.replace(
    '<Metric label="Debug" value={String(status.debug_port ?? "-")} />',
    '<Metric label="\u8c03\u8bd5\u7aef\u53e3" value={String(status.debug_port ?? "-")} />'
  );
  r = r.replace(
    '<Metric label="Helper" value={String(status.helper_port ?? "-")} />',
    '<Metric label="\u8f85\u52a9\u7aef\u53e3" value={String(status.helper_port ?? "-")} />'
  );
  
  // Version
  r = r.replace(/"version": "\d+\.\d+\.\d+"/g, '"version": "3.0.2"');
  
  // Refs cleanup
  r = r.replace(/,\s*refreshZedRemoteProjects/g, "");
  r = r.replace(/,\s*openZedRemoteProject/g, "");
  r = r.replace(/,\s*forgetZedRemoteProject/g, "");
  r = r.replace(/,\s*zedRemoteProjects/g, "");
  
  // Function blocks
  ["const openZedRemoteProject", "const forgetZedRemoteProject", "const refreshZedRemoteProjects",
   "function ZedRemoteScreen", "function UserScriptsScreen", "function RecommendationsScreen",
   "function ZedRemoteProjectSection", "function zedRemoteHostLabel", "function zedRemoteSourceLabel",
   "function syncMarketInstalledState"].forEach(fn => {
    while (r.includes(fn)) { r = rmBlock(r, fn); }
  });
  
  // Page rendering blocks
  ["zedRemote", "userScripts", "recommendations"].forEach(route => {
    ['{activeRoute === "', '{route === "'].forEach(m => {
      let marker = m + route + '"';
      while (r.includes(marker)) { r = rmBlock(r, marker); }
    });
  });
  
  // FeatureToggle
  r = r.replace(/<FeatureToggle title="Zed[^"]*"[^<]*<\/FeatureToggle>\n?/g, "");
  
  // Zed select elements
  r = r.replace(/<select[^>]*zedRemoteOpenStrategy[^>]*>[\s\S]*?<\/select>\n?/g, "");
  
  if (r === prev) break;
  if (iter === 0) log.push("Iteration started");
}

// Clean up empty lines
r = r.replace(/\n{3,}/g, "\n\n");

fs.writeFileSync("apps/codex-plus-manager/src/App.tsx", r, "utf8");
console.log("zedRemote:", (r.match(/zedRemote/g) || []).length);
console.log("userScripts:", (r.match(/userScripts/g) || []).length);
console.log("recommendations:", (r.match(/recommendations/g) || []).length);
console.log("BigPizza:", r.includes("BigPizza"));
console.log("supplier:", r.includes("\u4f9b\u5e94\u5546"));
console.log("File size:", r.length);
