const fs = require("fs");
let c = fs.readFileSync("apps/codex-plus-manager/src/App.tsx", "utf8");
let log = [];

function rmBlock(t, m) {
  let i = t.indexOf(m);
  if (i < 0) return t;
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

// 1. Remove type definitions
let typeDefs = [
  ["type ZedOpenStrategy", '"default";'],
  ["type ZedRemoteProject", "};"],
  ["type ZedRemoteProjectsResult", "};"],
  ["type ZedRemoteOpenResult", "};"],
];
typeDefs.forEach(([s, e]) => {
  let i = c.indexOf(s);
  if (i >= 0) {
    let end = c.indexOf(e, i) + e.length;
    c = c.substring(0, i) + c.substring(end);
    log.push("type:" + s);
  }
});

// 2. Remove fields
["  codexAppZedRemoteOpen: boolean;\n", "  zedRemoteOpenStrategy: ZedOpenStrategy;\n",
 "  zedRemoteProjectRegistryEnabled: boolean;\n", "  zedRemoteSyncToZedSettings: boolean;\n",
 "  contextSelectionInitialized: boolean;\n"].forEach(f => {
  if (c.includes(f)) { c = c.replaceAll(f, ""); log.push("field:" + f.trim().split(":")[0]); }
});

// 3. Remove defaults
["  codexAppZedRemoteOpen: true,\n", '  zedRemoteOpenStrategy: "addToFocusedWorkspace",\n',
 "  zedRemoteProjectRegistryEnabled: true,\n", "  zedRemoteSyncToZedSettings: false,\n",
 "  contextSelectionInitialized: true,\n"].forEach(d => {
  if (c.includes(d)) { c = c.replaceAll(d, ""); log.push("default:" + d.trim().split(":")[0]); }
});

// 4. Remove state
c = c.replaceAll("const [zedRemoteProjects, setZedRemoteProjects] = useState<ZedRemoteProjectsResult | null>(null);\n", "");
log.push("state");

// 5. Route type
let oldR = 'type Route = "overview" | "relay" | "mobileControl" | "sessions" | "context" | "enhance" | "zedRemote" | "userScripts" | "recommendations" | "maintenance" | "about" | "settings"';
let newR = 'type Route = "overview" | "relay" | "mobileControl" | "sessions" | "context" | "enhance" | "maintenance" | "about" | "settings"';
if (c.includes(oldR)) { c = c.replace(oldR, newR); log.push("route type"); }

// 6. Sidebar
c = c.replace(/  \{ id: "zedRemote", label: "[^"]*", icon: ExternalLink \},\n  \{ id: "userScripts", label: "[^"]*", icon: FileCode2 \},\n  \{ id: "recommendations", label: "[^"]*", icon: ExternalLink \},/g, "");
log.push("sidebar");

// 7. Actions type refs
["  refreshZedRemoteProjects: () => Promise<ZedRemoteProjectsResult | null>;\n",
 "  openZedRemoteProject: (project: ZedRemoteProject, strategy?: ZedOpenStrategy) => Promise<void>;\n",
 "  forgetZedRemoteProject: (project: ZedRemoteProject) => Promise<void>;\n"].forEach(r => {
  if (c.includes(r)) { c = c.replaceAll(r, ""); log.push("action:" + r.trim().split(":")[0]); }
});

// 8. Route descriptions
c = c.replace(/zedRemote: "[^"]*",\s*userScripts: "[^"]*",\s*recommendations: "[^"]*",/g, "");
log.push("desc");

// 9. Route handlers
c = c.replace(/if \(next === "zedRemote"\) \{[\s\S]*?\}\n?/g, "");
c = c.replace(/if \(next === "userScripts"\) \{[\s\S]*?\}\n?/g, "");
c = c.replace(/if \(next === "recommendations"\) [^;]+;\n?/g, "");

// 10. Branding
c = c.replaceAll("\u4f9b\u5e94\u5546\u914d\u7f6e", "\u6a21\u578b\u914d\u7f6e");
c = c.replaceAll("\u542f\u52a8 LDCodex", "\u542f\u52a8\u4ee3\u7406");
c = c.replaceAll("\u542f\u52a8Codex", "\u542f\u52a8\u4ee3\u7406");
c = c.replaceAll("\u6253\u5f00\u7ba1\u7406\u9762\u677f", "\u6253\u5f00\u4ee3\u7406\u4fe1\u606f\u9875");
c = c.replaceAll("github.com/BigPizzaV3/CodexPlusPlus", "github.com/luoda2023/LDCodex");
log.push("branding");

// 11. Debug/Helper
c = c.replace('<Metric label="Debug" value={String(status.debug_port ?? "-")} />', '<Metric label="\u8c03\u8bd5\u7aef\u53e3" value={String(status.debug_port ?? "-")} />');
c = c.replace('<Metric label="Helper" value={String(status.helper_port ?? "-")} />', '<Metric label="\u8f85\u52a9\u7aef\u53e3" value={String(status.helper_port ?? "-")} />');

// 12. Version
c = c.replace(/"version": "\d+\.\d+\.\d+"/g, '"version": "3.0.2"');

// 13. Remove refs
c = c.replace(/,\s*refreshZedRemoteProjects/g, "");
c = c.replace(/,\s*openZedRemoteProject/g, "");
c = c.replace(/,\s*forgetZedRemoteProject/g, "");
c = c.replace(/,\s*zedRemoteProjects/g, "");

// 14. Remove function blocks
["const openZedRemoteProject", "const forgetZedRemoteProject", "const refreshZedRemoteProjects",
 "function ZedRemoteScreen", "function UserScriptsScreen", "function RecommendationsScreen"].forEach(fn => {
  let cnt = 0;
  while (c.includes(fn)) { let o = c.length; c = rmBlock(c, fn); if (c.length !== o) cnt++; else break; }
  if (cnt > 0) log.push("fn:" + fn.substring(6));
});

// 15. Remove page rendering blocks
["zedRemote", "userScripts", "recommendations"].forEach(route => {
  let m1 = '{activeRoute === "' + route + '"';
  let m2 = '{route === "' + route + '"';
  let cnt = 0;
  while (c.includes(m1)) { let o = c.length; c = rmBlock(c, m1); if (c.length !== o) cnt++; else break; }
  while (c.includes(m2)) { let o = c.length; c = rmBlock(c, m2); if (c.length !== o) cnt++; else break; }
  if (cnt > 0) log.push("page:" + route);
});

// 16. Zed FeatureToggle
c = c.replace(/<FeatureToggle title="Zed Remote open"[^<]*<\/FeatureToggle>\n?/g, "");

// Clean up
c = c.replace(/\n{3,}/g, "\n\n");

fs.writeFileSync("apps/codex-plus-manager/src/App.tsx", c, "utf8");
console.log("Done!");
log.forEach(l => console.log("  " + l));
console.log("Remaining zedRemote:", (c.match(/zedRemote/g) || []).length);
console.log("Remaining userScripts:", (c.match(/userScripts/g) || []).length);
console.log("Remaining recommendations:", (c.match(/recommendations/g) || []).length);
console.log("Remaining BigPizza:", c.includes("BigPizza"));
