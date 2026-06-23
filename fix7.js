const fs = require("fs");
let content = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8");
let lines = content.split("\n");

// Fix codex_prefix_str - remove let d = dot_char(), change return
for(let i=0;i<lines.length;i++){
    if(lines[i].includes("fn codex_prefix_str")){
        // Next line is: let d = dot_char();
        if(lines[i+1].includes("let d") && lines[i+1].includes("dot_char")){
            lines[i+1] = "";
        }
        // The concat line needs .to_string()
        if(lines[i+2].includes("concat!")){
            lines[i+2] = "    concat!(\"OpenAI\", DOT, \"Codex_\").to_string()";
        }
        break;
    }
}

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", lines.join("\n"), "utf8");
console.log("Done");
