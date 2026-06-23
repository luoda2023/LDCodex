const fs = require("fs");
let content = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8");
content = content.replace(/\r\n/g,"\n");
let lines = content.split("\n");

// Find second fn dot_char
let firstDot, secondDot;
for(let i=0;i<lines.length;i++){
  if(lines[i].includes("fn dot_char()")){
    if(firstDot===undefined) firstDot=i;
    else { secondDot=i; break; }
  }
}
console.log("first dot_char:", firstDot, "second:", secondDot);

// Remove second dot_char (3 lines)
lines.splice(secondDot, 3);

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
    for(let j=i;j<Math.min(i+5,lines.length);j++){
      if(lines[j].includes("vec![") && lines[j].includes("].concat()")){
        lines[j] = lines[j].replace(
          'vec!["OpenAI", &d, "Codex_"].concat()',
          'format!("OpenAI{}Codex_", d)'
        );
      }
    }
    break;
  }
}

// Fix remaining vec! patterns
for(let i=0;i<lines.length;i++){
  let l = lines[i];
  if(!l.includes("vec![") || !l.includes("].concat()")) continue;
  
  let m = l.match(/vec!\[(.*?)\]\.concat\(\)/);
  if(!m) continue;
  
  let parts = m[1];
  let items = [];
  let pos = 0;
  while(pos < parts.length){
    if(parts[pos] === "\""){
      let end = parts.indexOf("\"", pos+1);
      items.push({type:"str", val: parts.substring(pos+1, end)});
      pos = end+1;
    } else if(parts[pos] === "&"){
      let end = pos+1;
      while(end < parts.length && (parts[end].match(/[\w\(\)]/))) end++;
      items.push({type:"ref", val: parts.substring(pos+1, end)});
      pos = end;
    } else {
      pos++;
    }
  }
  
  let fmtParts = [];
  let args = [];
  for(let item of items){
    if(item.type === "str") fmtParts.push(item.val);
    else { args.push(item.val); fmtParts.push("{}"); }
  }
  
  let newExpr;
  if(args.length > 0){
    newExpr = "format!(\"" + fmtParts.join("") + "\", " + args.join(", ") + ")";
  } else {
    newExpr = "\"" + fmtParts.join("") + "\".to_string()";
  }
  
  lines[i] = l.replace(m[0], newExpr);
  console.log("Fixed line " + (i+1) + ": " + m[0] + " -> " + newExpr);
}

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", lines.join("\n"), "utf8");
console.log("Done.");
