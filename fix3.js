const fs = require("fs");
let content = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8");
let lines = content.split("\n");

// Manually fix the 3 problematic format! lines with dot variable
let changed = 0;
for(let i=0;i<lines.length;i++){
    let l = lines[i];
    if(l.includes("format!") && l.includes("dot")){
        // Case: format!("Codex{}app", dot)
        if(l.includes('"Codex{}app"') && l.includes("dot)")){
            lines[i]=l.replace('format!("Codex{}app", dot)','["Codex", DOT, "app"].concat()');
            changed++;
        }
        // Case: format!("OpenAI Codex{}app", dot)
        else if(l.includes('"OpenAI Codex{}app"') && l.includes("dot)")){
            lines[i]=l.replace('format!("OpenAI Codex{}app", dot)','["OpenAI Codex", DOT, "app"].concat()');
            changed++;
        }
        // Case: format!("OpenAI{}Codex{}app", dot, dot)
        else if(l.includes('"OpenAI{}Codex{}app"') && l.includes("dot, dot)")){
            lines[i]=l.replace('format!("OpenAI{}Codex{}app", dot, dot)','["OpenAI", DOT, "Codex", DOT, "app"].concat()');
            changed++;
        }
    }
}
console.log("Fixed format lines:",changed);

// Now for all the other format! lines that use DOT or dot_char
// format!("Codex{}exe", DOT) -> ["Codex", DOT, "exe"].concat()
for(let i=0;i<lines.length;i++){
    let l = lines[i];
    if(l.includes("format!") && (l.includes("DOT")||l.includes("dot_char()"))){
        // Try: format!("X{}Y", VAR)
        let m = l.match(/format!\("([^{}]*)\{}([^{}]*)"\s*,\s*(DOT|dot_char\(\))\)/);
        if(m){
            let before = m[1];
            let after = m[2];
            let varName = m[3];
            lines[i] = l.replace(m[0], '["'+before+'", '+varName+', "'+after+'"].concat()');
            changed++;
            console.log("Fixed L"+(i+1)+": "+l.trim());
        }
    }
}

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", lines.join("\n"), "utf8");
console.log("Done. Total changes:",changed);
