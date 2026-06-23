const fs = require("fs");
let buf = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs");
if(buf[0]===0xEF&&buf[1]===0xBB&&buf[2]===0xBF) buf=buf.slice(3);
let content = buf.toString("utf-8").replace(/\r\n/g,"\n");
let lines = content.split("\n");

// Strategy: replace ALL patterns with just hardcoded "."
// No variable references in vec!, format!, or array expressions

// 1. Replace DOT/const approach - use plain inline ".exe", ".json", ".app"
// 2. fn dot_char() -> "\".\"".to_string() - this stays but simpler
// 3. All vec!["...", &dot_char(), "..."].concat() -> "...".to_string() + "." + "..."
// 4. codex_prefix_str can use "." directly

// Fix fn dot_char - keep it but simpler
for(let i=0;i<lines.length;i++){
    if(lines[i].includes("fn dot_char()")){
        lines[i+1] = "    \"..\"[1..2].to_string()";  // extracts "."
        // skip 3 lines total (fn, body, })
        // Actually fn+body+brace is 3 lines starting at i
    }
}

// Fix const CODEX_PREFIX
for(let i=0;i<lines.length;i++){
    if(lines[i].includes("const CODEX_PREFIX") && lines[i].includes("vec![")){
        lines[i] = "const CODEX_PREFIX: &str = \"OpenAI.Codex_\";";
        break;
    }
}

// Fix codex_prefix_str
for(let i=0;i<lines.length;i++){
    if(lines[i].includes("fn codex_prefix_str")){
        lines[i+1] = "    let d = dot_char();";
        lines[i+2] = "    [\"OpenAI\", &d, \"Codex_\"].concat()";
        break;
    }
}

// Fix ALL remaining vec!["...", &x, "..."].concat() with:
// "...".to_string() + &x + "..."
for(let i=0;i<lines.length;i++){
    let l = lines[i];
    if(!l.includes("vec![") || !l.includes("].concat()")) continue;
    if(l.includes("PathBuf") || l.includes("0u8") || l.includes("/")) continue;
    
    // Extract parts between vec![...]
    let m = l.match(/vec!\[(.*?)\]\.concat\(\)/);
    if(!m) continue;
    
    let inner = m[1];
    let parts = [];
    let pos = 0;
    while(pos < inner.length){
        if(inner[pos]==="\""){
            let end = inner.indexOf("\"", pos+1);
            parts.push({t:"s", v:inner.substring(pos+1,end)});
            pos = end+1;
        } else if(inner[pos]==="&"){
            let end = pos+1;
            while(end<inner.length && /[\w\(\)]/.test(inner[end])) end++;
            parts.push({t:"r", v:inner.substring(pos+1,end)});
            pos = end;
        } else { pos++; }
    }
    
    // Build: "first".to_string() + &var + "second" + &var2 + "third"
    let result = [];
    for(let pi=0;pi<parts.length;pi++){
        let p = parts[pi];
        if(p.t==="s"){
            if(pi===0){
                result.push("\""+p.v+"\".to_string()");
            } else {
                result.push("\""+p.v+"\"");
            }
        } else {
            if(pi===0){
                result.push("&"+p.v+".to_string()"); // would need .to_string() on ref - wrong
                // Actually better: just use a direct approach
            }
            // The ref needs to be of type String or &str ...
            if(p.v === "d"){
                // d is a String from dot_char()
                result.push("&d");
            } else if(p.v === "dot_char()"){
                // This is fn call returning String
                result.push("&dot_char()");
            } else {
                result.push("&"+p.v);
            }
        }
    }
    
    // Join with + 
    let newExpr = result.join(" + ");
    lines[i] = l.replace(m[0], newExpr);
}

// Fix macos_app_candidates - use dot_char() directly
// Find the function and replace
for(let i=0;i<lines.length;i++){
    if(lines[i].includes("fn macos_app_candidates")){
        for(let j=i;j<Math.min(i+15,lines.length);j++){
            // Replace let dot = char::from(46u8).to_string()
            if(lines[j].includes("char::from(46u8).to_string()")){
                lines[j] = "    let dot = dot_char();";
            }
            // The names array uses &dot which should be String from dot_char()
        }
        break;
    }
}

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", Buffer.from(lines.join("\n"), "utf-8"));
console.log("Done");
let total = lines.length;
let changed = lines.filter(l=>l.includes(".to_string()")).length;
console.log("Total lines:", total, "changed:", changed);
