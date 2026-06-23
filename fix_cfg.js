const fs = require("fs");
let content = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8");
let lines = content.split("\n");
let newLines = [];
for(let i=0;i<lines.length;i++){
    if(lines[i].trim()==="#[cfg(target_os = \"macos\")]"){
        if(newLines.length>0 && newLines[newLines.length-1].trim()==="#[cfg(target_os = \"macos\")]"){
            continue;
        }
    }
    newLines.push(lines[i]);
}
fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", newLines.join("\n"), "utf8");
console.log("Done");
