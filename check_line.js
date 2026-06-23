const fs = require("fs");
let content = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8");
let lines = content.split("\n");
let target = lines[478];
console.log("Line content:", JSON.stringify(target));
console.log("Length:", target.length);
for(let i=0;i<target.length;i++){
    console.log("char " + i + " code " + target.charCodeAt(i) + " hex " + target.charCodeAt(i).toString(16));
}
