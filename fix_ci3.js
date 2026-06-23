const fs = require("fs");
let c = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8");

// Replace ALL format!(..., dot_char()) with hardcoded ".exe", ".json", ".plist", ".Codex" etc
c = c.replace(/format!\("Codex\{\}exe", dot_char\(\)\)/g, '"Codex.exe".to_string()');
c = c.replace(/format!\("package\{\}json", dot_char\(\)\)/g, '"package.json".to_string()');
c = c.replace(/format!\("Info\{\}plist", dot_char\(\)\)/g, '"Info.plist".to_string()');
c = c.replace(/format!\("OpenAI\{\}Codex", dot_char\(\)\)/g, '"OpenAI.Codex".to_string()');
c = c.replace(/format!\("Codex\{\}app", dot\)/g, '"Codex.app"');
c = c.replace(/format!\("OpenAI Codex\{\}app", dot\)/g, '"OpenAI Codex.app"');
c = c.replace(/format!\("OpenAI\{\}Codex\{\}app", dot, dot\)/g, '"OpenAI.Codex.app"');

// Fix codex_prefix_str
c = c.replace('format!("OpenAI{}Codex_", d)', '"OpenAI.Codex_".to_string()');

// Fix the remaining vec!["Codex", &dot_char(), "exe"].concat()
c = c.replace('vec!["Codex", &dot_char(), "exe"].concat()', '"Codex.exe".to_string()');

// Verify no more problematic patterns
let remaining = c.match(/format!\(.*dot_char\(\)\)/g) || [];
console.log("Remaining format! with dot_char:", remaining.length);

remaining = c.match(/format!\(.*dot, dot\)/g) || [];
console.log("Remaining format! with dot:", remaining.length);

remaining = c.match(/vec!\[.*dot_char\(\)/g) || [];
console.log("Remaining vec! with dot_char:", remaining.length);

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", c);
console.log("Done");
