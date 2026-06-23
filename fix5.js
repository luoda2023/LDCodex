const fs = require("fs");
let buf = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs");
if(buf[0]===0xEF && buf[1]===0xBB && buf[2]===0xBF){
    buf = buf.slice(3);
}
let content = buf.toString("utf-8").replace(/\r\n/g,"\n");
let lines = content.split("\n");

// 1. Replace fn dot_char() with const DOT
// Find first fn dot_char
let dotIdx = -1;
for(let i=0;i<lines.length;i++){
    if(lines[i].includes("fn dot_char()")){
        dotIdx = i;
        break;
    }
}
// Replace the 3 lines of fn dot_char with const DOT
lines[dotIdx] = "const DOT: &str = \".\";";
lines.splice(dotIdx+1, 2);

// 2. Find and remove second fn dot_char (shifted -2)
for(let i=dotIdx+1;i<lines.length;i++){
    if(lines[i].includes("fn dot_char()")){
        lines.splice(i, 3);
        break;
    }
}

// 3. Fix const CODEX_PREFIX
for(let i=0;i<lines.length;i++){
    if(lines[i].includes("const CODEX_PREFIX") && lines[i].includes("vec![")){
        lines[i] = 'const CODEX_PREFIX: &str = concat!("OpenAI", DOT, "Codex_");';
        break;
    }
}

// 4. Fix codex_prefix_str
for(let i=0;i<lines.length;i++){
    if(lines[i].includes("fn codex_prefix_str")){
        for(let j=i;j<Math.min(i+5,lines.length);j++){
            if(lines[j].includes("vec![") && lines[j].includes("].concat()")){
                lines[j] = "    concat!(\"OpenAI\", DOT, \"Codex_\")";
            }
        }
        break;
    }
}

// 5. Replace all &dot_char() with DOT
for(let i=0;i<lines.length;i++){
    lines[i] = lines[i].replace(/&dot_char\(\)/g, "DOT");
}

// 6. Replace char::from(46u8).to_string() with DOT.to_string()
for(let i=0;i<lines.length;i++){
    lines[i] = lines[i].replace("char::from(46u8).to_string()", "DOT.to_string()");
}

// 7. Fix ALL remaining vec!["...", &var, "..."].concat() to ["...", VAR, "..."].concat()
// Where VAR is now DOT (a &str), so ["Codex", DOT, "exe"].concat() will work
for(let i=0;i<lines.length;i++){
    let l = lines[i];
    if(!l.includes("vec![") || !l.includes("].concat()")) continue;
    
    // Skip non-string vec patterns like vec![PathBuf::from(...)] or vec![0u8;...]
    if(!l.includes("\"")) continue;
    
    // Replace vec! with [] - vec!["A", VAR, "B"].concat() -> ["A", VAR, "B"].concat()
    // The key change: [] instead of vec![] won't trigger the parser bug
    lines[i] = l.replace("vec![", "[").replace("].concat()", "].concat()");
    
    // Also check: if any argument is &something (now DOT which is &str, so fine)
    // But just to be safe, remove any remaining & before variable names
    // Actually DOT is already &str, and ["Codex", DOT, "exe"].concat() should work
}

// 8. If macos_app_candidates still has let dot = DOT.to_string(), remove that and use DOT
for(let i=0;i<lines.length;i++){
    if(lines[i].includes("let dot = DOT.to_string()")){
        // Replace the function to not use String at all
        // Find the names array and replace
        for(let j=i;j<Math.min(i+10,lines.length);j++){
            if(lines[j].includes("DOT.to_string()")){
                // Remove this line - we don't need it anymore
                lines[j] = "";
                // Now fix the names array to use DOT directly
            }
        }
        // Remove the dot variable line
        lines[i] = "";
    }
}

// 9. The macos_app_candidates function now has let dot = DOT.to_string() removed
//    The names array should just use DOT directly as &str - no & needed

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", Buffer.from(lines.join("\n"), "utf-8"));
console.log("Done, lines:", lines.length);

// Print what's in the macos section
for(let i=460;i<490;i++){
    if(lines[i] !== undefined){
        console.log("L"+(i+1)+": "+lines[i]);
    }
}
