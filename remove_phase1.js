const fs = require('fs');
const p = 'apps/codex-plus-manager/src/App.tsx';
let c = fs.readFileSync(p, 'utf-8');

// Remove Route type entries
c = c.replace('"zedRemote" | "userScripts" | "recommendations" | ', '');

// Remove nav items
c = c.replace('  { id: "zedRemote", label: "Zed 远程项目", icon: ExternalLink },\n', '');
c = c.replace('  { id: "userScripts", label: "脚本市场", icon: FileCode2 },\n', '');
c = c.replace('  { id: "recommendations", label: "推荐内容", icon: ExternalLink },\n', '');

// Remove nav jump handlers
c = c.replace('    if (next === "zedRemote") {\n      await refreshZedRemoteProjects(true);\n      return;\n    }\n', '');
c = c.replace('    if (next === "userScripts") {\n      await refreshScriptMarket(true);\n      return;\n    }\n', '');
c = c.replace('    if (next === "recommendations") await refreshAds(true);\n', '');

// Remove route renders
c = c.replace('          {route === "zedRemote" ? (\n            <ZedRemoteScreen projects={zedRemoteProjects} form={settingsForm} onFormChange={setSettingsForm} actions={actions} />\n          ) : null}\n', '');
c = c.replace('          {route === "userScripts" ? <UserScriptsScreen settings={settings} market={scriptMarket} actions={actions} /> : null}\n', '');
c = c.replace('          {route === "recommendations" ? <RecommendationsScreen ads={ads} actions={actions} /> : null}\n', '');

// Remove route descriptions
c = c.replace('    zedRemote: "管理 Codex SSH 项目并加入 Zed workspace",\n', '');
c = c.replace('    userScripts: "内置和用户自定义脚本清单",\n', '');
c = c.replace('    recommendations: "赞助商推荐与普通推荐",\n', '');

fs.writeFileSync(p, c, 'utf-8');
console.log('Phase 1 done - core removals');
