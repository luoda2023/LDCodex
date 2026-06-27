const fs = require("fs");
let c = fs.readFileSync("apps/codex-plus-manager/src/App.tsx", "utf-8");
let replaced = 0;
let idx = 0;
while ((idx = c.indexOf("void actions.launch()", idx)) >= 0) {
  let chunk = c.substring(idx, idx + 30);
  if (chunk.includes("\u542F\u52A8\u4EE3\u7406")) {
    let before = c.substring(0, idx);
    let after = c.substring(idx + "void actions.launch()".length);
    c = before + "void actions.launchBridge()" + after;
    replaced++;
  }
  idx++;
}
console.log("Replaced", replaced, "buttons");
fs.writeFileSync("apps/codex-plus-manager/src/App.tsx", c, "utf-8");
