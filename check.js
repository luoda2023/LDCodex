const fs = require("fs");
let content = fs.readFileSync("apps/codex-plus-manager/src/App.tsx", "utf8");
const checks = {
  supplier: content.includes("供应商配置"),
  startProxy: content.includes("启动代理"),
  startLD: content.includes("启动 LDCodex"),
  startCodex: content.includes("启动Codex"),
  openPanel: content.includes("打开管理面板"),
  openProxyInfo: content.includes("打开代理信息页"),
  debugLabel: content.includes('Metric label="Debug"'),
  helperLabel: content.includes('Metric label="Helper"'),
  zedRemote: content.includes("zedRemote"),
  userScripts: content.includes("userScripts"),
  recommendations: content.includes("recommendations"),
  zedType: content.includes("ZedOpenStrategy"),
  bigPizza: content.includes("BigPizzaV3"),
  luoda: content.includes("luoda2023/LDCodex"),
};
console.log(JSON.stringify(checks, null, 2));
