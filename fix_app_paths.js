const fs = require("fs");
let buf = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs");
if(buf[0]===0xEF && buf[1]===0xBB && buf[2]===0xBF){
    buf=buf.slice(3);
}
let content=buf.toString("utf-8");
content=content.replace(/\r\n/g,"\n");
let lines=content.split("\n");

// 1. Replace fn dot_char with const
lines[4]='const DOT: &str = ".";';
// Remove body and closing brace (lines 5-6)
lines.splice(5,2);
// Now second dot_char at index 7, remove it (3 lines)
lines.splice(7,3);

// 2. Fix const CODEX_PREFIX
for(let i=0;i<lines.length;i++){
    if(lines[i].includes("const CODEX_PREFIX") && lines[i].includes("vec![")){
        lines[i]='const CODEX_PREFIX: &str = concat!("OpenAI", DOT, "Codex_");';
        break;
    }
}

// 3. Fix codex_prefix_str
for(let i=0;i<lines.length;i++){
    if(lines[i].includes("fn codex_prefix_str")){
        for(let j=i;j<Math.min(i+5,lines.length);j++){
            if(lines[j].includes("vec![")){
                lines[j]='    concat!("OpenAI", DOT, "Codex_")';
            }
        }
        break;
    }
}

// 4. Replace &dot_char() with DOT
for(let i=0;i<lines.length;i++){
    lines[i]=lines[i].replace(/&dot_char\(\)/g,"DOT");
}

// 5. Replace char::from(46u8).to_string()
for(let i=0;i<lines.length;i++){
    lines[i]=lines[i].replace("char::from(46u8).to_string()","DOT.to_string()");
}

// 6. Fix remaining vec!["...", &var, "..."].concat()
for(let i=0;i<lines.length;i++){
    let l=lines[i];
    if(!l.includes("vec![") || !l.includes("].concat()")) continue;
    let m=l.match(/vec!\[(.*?)\]\.concat\(\)/);
    if(!m) continue;
    let ps=m[1];
    let parts=[];
    let pos=0;
    while(pos<ps.length){
        if(ps[pos]==='\"'){
            let end=ps.indexOf("\"",pos+1);
            parts.push({t:"s",v:ps.substring(pos+1,end)});
            pos=end+1;
        } else if(ps[pos]==="&"){
            let end=pos+1;
            while(end<ps.length && /[\w\(\)]/.test(ps[end])) end++;
            parts.push({t:"r",v:ps.substring(pos+1,end)});
            pos=end;
        } else { pos++; }
    }
    let fmt=[],args=[];
    for(let p of parts){
        if(p.t==="s") fmt.push(p.v);
        else {args.push(p.v); fmt.push("{}");}
    }
    let repl;
    if(args.length){
        repl='format!("'+fmt.join("")+'", '+args.join(", ")+')';
    } else {
        repl='"'+fmt.join("")+'".to_string()';
    }
    lines[i]=l.replace(m[0],repl);
}

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs",Buffer.from(lines.join("\n"),"utf-8"));
console.log("Done, lines:",lines.length);
