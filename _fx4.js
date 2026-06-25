const fs = require("fs");
let c = fs.readFileSync("apps/codex-plus-manager/src/App.tsx", "utf8");
let n = 0;

// Overview
const p1 = "启动代理\r\n            </Button>\r\n            <Button variant=\"secondary\" onClick={() => void actions.goLogs()}>\r\n              打开关于\r\n            </Button>";
const r1 = "启动代理\r\n            </Button>\r\n            <Button variant=\"secondary\" onClick={() => void actions.openExternalUrl(\"http://127.0.0.1:36002\")}>\r\n              <ExternalLink className=\"h-4 w-4\" />\r\n              打开管理面板\r\n            </Button>\r\n            <Button variant=\"secondary\" onClick={() => void actions.goLogs()}>\r\n              打开关于\r\n            </Button>";
if (c.indexOf(p1) >= 0) { c = c.split(p1).join(r1); n++; }

// ProxyScreen
const p2 = "               启动代理\r\n            </Button>\r\n          </Toolbar>";
const r2 = "               启动代理\r\n            </Button>\r\n            <Button variant=\"secondary\" onClick={() => void actions.openExternalUrl(\"http://127.0.0.1:36002\")}>\r\n              <ExternalLink className=\"h-4 w-4\" />\r\n               打开管理面板\r\n            </Button>\r\n          </Toolbar>";
if (c.indexOf(p2) >= 0) { c = c.split(p2).join(r2); n++; }

fs.writeFileSync("apps/codex-plus-manager/src/App.tsx", c, "utf8");
console.log("Changes: " + n);
