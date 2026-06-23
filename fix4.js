const fs = require("fs");
let content = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8");
let lines = content.split("\n");

for(let i=0;i<lines.length;i++){
    let l = lines[i];
    if(l.includes("[\"Codex\", DOT, \"app\"].concat()")){
        lines[i]=l.replace('["Codex", DOT, "app"].concat()', '"Codex".to_owned() + DOT + "app"');
    }
    if(l.includes("[\"OpenAI Codex\", DOT, \"app\"].concat()")){
        lines[i]=l.replace('["OpenAI Codex", DOT, "app"].concat()', '"OpenAI Codex".to_owned() + DOT + "app"');
    }
    if(l.includes("[\"OpenAI\", DOT, \"Codex\", DOT, \"app\"].concat()")){
        lines[i]=l.replace('["OpenAI", DOT, "Codex", DOT, "app"].concat()', '"OpenAI".to_owned() + DOT + "Codex" + DOT + "app"');
    }
}

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", lines.join("\n"), "utf8");
console.log("Done");
