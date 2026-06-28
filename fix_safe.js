const fs = require('fs');
const p = 'J:\\codex-work\\LDCodex\\apps\\codex-plus-manager\\src\\App.tsx';
let c = fs.readFileSync(p, 'utf-8');

c = c.replace(/\u4f9b\u5e94\u5546\u914d\u7f6e/g, '\u6a21\u578b\u914d\u7f6e');

c = c.replace('  { id: "zedRemote", label: "Zed 远程项目", icon: ExternalLink },\n', '');
c = c.replace('  { id: "userScripts", label: "脚本市场", icon: FileCode2 },\n', '');
c = c.replace('  { id: "recommendations", label: "推荐内容", icon: ExternalLink },\n', '');

c = c.replace('"zedRemote" | "userScripts" | "recommendations" | ', '');

c = c.replace('    zedRemote: "管理 Codex SSH 项目并加入 Zed workspace",\n', '');
c = c.replace('    userScripts: "内置和用户自定义脚本清单",\n', '');
c = c.replace('    recommendations: "赞助商推荐与普通推荐",\n', '');

c = c.replace('    if (next === "zedRemote") {\n      await refreshZedRemoteProjects(true);\n      return;\n    }\n', '');
c = c.replace('    if (next === "userScripts") {\n      await refreshScriptMarket(true);\n      return;\n    }\n', '');
c = c.replace('    if (next === "recommendations") await refreshAds(true);\n', '');

c = c.replace('          {route === "zedRemote" ? (\n            <ZedRemoteScreen projects={zedRemoteProjects} form={settingsForm} onFormChange={setSettingsForm} actions={actions} />\n          ) : null}\n', '');
c = c.replace('          {route === "userScripts" ? <UserScriptsScreen settings={settings} market={scriptMarket} actions={actions} /> : null}\n', '');
c = c.replace('          {route === "recommendations" ? <RecommendationsScreen ads={ads} actions={actions} /> : null}\n', '');

c = c.replace('const SCRIPT_MARKET_REPOSITORY_URL = "https://github.com/luoda2023/LDCodexScriptMarket";\n', '');

console.log('zedRemote:', (c.match(/zedRemote/g)||[]).length);
console.log('ScriptMarket:', (c.match(/ScriptMarket/g)||[]).length);
console.log('Supplier:', (c.match(/\u4f9b\u5e94\u5546/g)||[]).length);
console.log('File length:', c.length);

fs.writeFileSync(p, c, 'utf-8');
console.log('Saved');
