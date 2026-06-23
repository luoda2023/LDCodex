const fs = require("fs");
let buf = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs");
if(buf[0]===0xEF&&buf[1]===0xBB&&buf[2]===0xBF) buf=buf.slice(3);
let content = buf.toString("utf-8").replace(/\r\n/g,"\n");
let lines = content.split("\n");

// Fix duplicate #[cfg] attributes
for(let i=0;i<lines.length;i++){
    if(lines[i].trim()==="#[cfg(target_os = \"macos\")]"){
        let j=i+1;
        while(j<lines.length && lines[j].trim()==="#[cfg(target_os = \"macos\")]"){
            lines.splice(j,1);
        }
    }
}

// Fix macos_app_candidates - replace &dot with DOT
for(let i=0;i<lines.length;i++){
    if(lines[i].includes("fn macos_app_candidates")){
        for(let j=i;j<Math.min(i+15,lines.length);j++){
            lines[j]=lines[j].replace(/&dot(?![a-zA-Z])/g, "DOT");
        }
        break;
    }
}

// Check for remaining &dot
for(let i=0;i<lines.length;i++){
    if(lines[i].includes("&dot") && !lines[i].includes("&dot_char") && !lines[i].includes("&dot(")){
        console.log("Still has &dot at L"+(i+1)+": "+lines[i].trim());
    }
}

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs",Buffer.from(lines.join("\n"),"utf-8"));
console.log("Done");
