const fs = require("fs");
let buf = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs");
if(buf[0]===0xEF&&buf[1]===0xBB&&buf[2]===0xBF) buf=buf.slice(3);
let content = buf.toString("utf-8").replace(/\r\n/g,"\n");
let lines = content.split("\n");

// Phase 1: Fix fn dot_char body
for(let i=0;i<lines.length;i++){
    if(lines[i].includes("fn dot_char()")){
        lines[i+1] = "    \"..\"[1..2].to_string()";
        break;
    }
}

// Phase 2: Inline all "OpenAI.Codex_" patterns 
// const CODEX_PREFIX
for(let i=0;i<lines.length;i++){
    if(lines[i].includes("const CODEX_PREFIX") && lines[i].includes("vec![")){
        lines[i] = "const CODEX_PREFIX: &str = \"OpenAI.Codex_\";";
        break;
    }
}

// codex_prefix_str
for(let i=0;i<lines.length;i++){
    if(lines[i].includes("fn codex_prefix_str")){
        for(let j=i;j<Math.min(i+5,lines.length);j++){
            if(lines[j].includes("vec![") && lines[j].includes("].concat()")){
                lines[j] = "    \"OpenAI.Codex_\".to_string()";
            }
        }
        break;
    }
}

// Phase 3: Replace ALL vec!["...", &..., "..."].concat() with hardcoded strings
// These are all on Windows so: .exe, .json
// On macos: .app, .plist, and directory names with .

for(let i=0;i<lines.length;i++){
    let l = lines[i];
    if(!l.includes("vec![") || !l.includes("].concat()")) continue;
    if(l.includes("PathBuf")||l.includes("0u8")||l.includes("[")) continue;
    
    // Detect which exact pattern and replace
    let replaced = l;
    
    // .exe patterns
    replaced = replaced.replace(
        'vec!["Codex", &dot_char(), "exe"].concat()',
        '"Codex.exe".to_string()'
    );
    
    // .json patterns
    replaced = replaced.replace(
        'vec!["package", &dot_char(), "json"].concat()',
        '"package.json".to_string()'
    );
    
    // .plist pattern
    replaced = replaced.replace(
        'vec!["Info", &dot_char(), "plist"].concat()',
        '"Info.plist".to_string()'
    );
    
    // macos directory patterns
    replaced = replaced.replace(
        'vec!["OpenAI", &dot_char(), "Codex"].concat()',
        '"OpenAI.Codex".to_string()'
    );
    
    // macos app patterns using &dot
    replaced = replaced.replace(
        'vec!["Codex", &dot, "app"].concat()',
        '["Codex", &dot, "app"].concat()'  // temporarily, will fix below
    );
    replaced = replaced.replace(
        'vec!["OpenAI Codex", &dot, "app"].concat()',
        '["OpenAI Codex", &dot, "app"].concat()'
    );
    replaced = replaced.replace(
        'vec!["OpenAI", &dot, "Codex", &dot, "app"].concat()',
        '["OpenAI", &dot, "Codex", &dot, "app"].concat()'
    );
    
    lines[i] = replaced;
}

// Phase 4: Fix the nix/macos section
// For macos_app_candidates function - use ".to_string()" concatenation
// which should work because it's String + &str + String etc
// Actually let me just rewrite those 3 lines with simple concatenation

for(let i=0;i<lines.length;i++){
    if(lines[i].includes("fn macos_app_candidates")){
        for(let j=i;j<Math.min(i+15,lines.length);j++){
            if(lines[j].includes("let dot = ")){
                lines[j] = "    let dot = dot_char();";
            }
            // These are now ["Codex", &dot, "app"].concat() after phase 3
            // Replace with format! or plain .to_owned() chain
            if(lines[j].includes('["Codex", &dot, "app"].concat()')){
                lines[j] = lines[j].replace(
                    '["Codex", &dot, "app"].concat()',
                    '"Codex".to_owned() + &dot + "app"'
                );
            }
            if(lines[j].includes('["OpenAI Codex", &dot, "app"].concat()')){
                lines[j] = lines[j].replace(
                    '["OpenAI Codex", &dot, "app"].concat()',
                    '"OpenAI Codex".to_owned() + &dot + "app"'
                );
            }
            if(lines[j].includes('["OpenAI", &dot, "Codex", &dot, "app"].concat()')){
                lines[j] = lines[j].replace(
                    '["OpenAI", &dot, "Codex", &dot, "app"].concat()',
                    '"OpenAI".to_owned() + &dot + "Codex" + &dot + "app"'
                );
            }
        }
        break;
    }
}

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", Buffer.from(lines.join("\n"),"utf-8"));
console.log("Done");

// Verify no more vec!["...", &, "..."].concat() patterns remain
for(let i=0;i<lines.length;i++){
    if(lines[i].includes("vec![") && lines[i].includes("].concat()") && lines[i].includes("\"") && !lines[i].includes("PathBuf") && !lines[i].includes("0u8")){
        console.log("REMAINING at L"+(i+1)+": "+lines[i].trim());
    }
}
