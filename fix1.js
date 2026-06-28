const fs = require('fs');
const p = 'J:\\codex-work\\LDCodex\\apps\\codex-plus-manager\\src\\App.tsx';
let c = fs.readFileSync(p, 'utf-8');

c = c.replace(/供应商配置/g, '模型配置');

c = c.replace(/const SCRIPT_MARKET_REPOSITORY_URL = \"https:\/\/github.com\/luoda2023\/LDCodexScriptMarket\";\n/g, '');

c = c.replace('\"zedRemote\" | \"userScripts\" | \"recommendations\" | ', '');

c = c.replace(/  \{ id: \"zedRemote\", label: \"Zed 远程项目\", icon: ExternalLink \},\n/g, '');
c = c.replace(/  \{ id: \"userScripts\", label: \"脚本市场\", icon: FileCode2 \},\n/g, '');
c = c.replace(/  \{ id: \"recommendations\", label: \"推荐内容\", icon: ExternalLink \},\n/g, '');

c = c.replace(/    zedRemote: \"管理 Codex SSH 项目并加入 Zed workspace\",\n/g, '');
c = c.replace(/    userScripts: \"内置和用户自定义脚本清单\",\n/g, '');
c = c.replace(/    recommendations: \"赞助商推荐与普通推荐\",\n/g, '');

c = c.replace(/    if \(next === \"zedRemote\"\) \{\n      await refreshZedRemoteProjects\(true\);\n      return;\n    \}\n/g, '');
c = c.replace(/    if \(next === \"userScripts\"\) \{\n      await refreshScriptMarket\(true\);\n      return;\n    \}\n/g, '');
c = c.replace(/    if \(next === \"recommendations\"\) await refreshAds\(true\);\n/g, '');

c = c.replace(/          \{route === \"zedRemote\" \? \(\n            <ZedRemoteScreen projects=\{zedRemoteProjects\} form=\{settingsForm\} onFormChange=\{setSettingsForm\} actions=\{actions\} \/>\n          \) : null\}\n/g, '');
c = c.replace(/          \{route === \"userScripts\" \? <UserScriptsScreen settings=\{settings\} market=\{scriptMarket\} actions=\{actions\} \/> : null\}\n/g, '');
c = c.replace(/          \{route === \"recommendations\" \? <RecommendationsScreen ads=\{ads\} actions=\{actions\} \/> : null\}\n/g, '');

console.log('zedRemote left:', (c.match(/zedRemote/g)||[]).length);
console.log('ScriptMarket left:', (c.match(/ScriptMarket/g)||[]).length);
console.log('Supplier left:', (c.match(/供应商/g)||[]).length);

fs.writeFileSync(p, c, 'utf-8');
console.log('Done');
