const fs = require("fs");
let c = fs.readFileSync("apps/codex-plus-manager/src/App.tsx", "utf8");
let n = 0;

// Overview: insert 打开管理面板 before 打开关于
const p1 = "启动代理\n            </Button>\n            <Button variant=\"secondary\" onClick={() => void actions.goLogs()}>\n              打开关于\n            </Button>";
const r1 = "启动代理\n            </Button>\n            <Button variant=\"secondary\" onClick={() => void actions.openExternalUrl(\"http://127.0.0.1:36002\")}>\n              <ExternalLink className=\"h-4 w-4\" />\n              打开管理面板\n            </Button>\n            <Button variant=\"secondary\" onClick={() => void actions.goLogs()}>\n              打开关于\n            </Button>";
if (c.indexOf(p1) >= 0) { c = c.split(p1).join(r1); n++; console.log("Overview done"); }

// ProxyScreen: insert 打开管理面板 after 启动代理 button
const p2 = "               启动代理\n            </Button>\n          </Toolbar>";
const r2 = "               启动代理\n            </Button>\n            <Button variant=\"secondary\" onClick={() => void actions.openExternalUrl(\"http://127.0.0.1:36002\")}>\n              <ExternalLink className=\"h-4 w-4\" />\n               打开管理面板\n            </Button>\n          </Toolbar>";
if (c.indexOf(p2) >= 0) { c = c.split(p2).join(r2); n++; console.log("ProxyScreen done"); }

fs.writeFileSync("apps/codex-plus-manager/src/App.tsx", c, "utf8");
console.log("Total: " + n);
