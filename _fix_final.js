const { execSync } = require("child_process");
const fs = require("fs");
const buf = execSync("git show HEAD:crates/codex-plus-core/src/app_paths.rs", {encoding:"buffer"});
let clean = Buffer.alloc(buf.length);
let j = 0;
for(let i=0; i<buf.length; i++) if(buf[i]<128) clean[j++] = buf[i];
clean = clean.slice(0,j);
let text = clean.toString("ascii");
text = text.replace(/\}#\[cfg/g, "}\n#[cfg");
text = text.replace(/(#\[cfg\(target_os = \"macos\"\)\])(\n\1)+/g, "");
text = text.replace(
  "    [\n        root.join(\"Codex.app\"),\n        root.join(\"OpenAI Codex.app\"),\n        root.join(\"OpenAI.Codex.app\"),\n    ]",
  "    vec![\n        root.join(\"Codex.app\"),\n        root.join(\"OpenAI Codex.app\"),\n        root.join(\"OpenAI.Codex.app\"),\n    ]"
);
fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", text, "utf8");
console.log("Done, size: " + text.length);
