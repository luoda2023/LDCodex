const fs = require("fs");
let content = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8");

// Since dot is now &str, change &dot to just dot
// But only in the macos_app_candidates function where dot is defined as a local variable
// Replace: .to_string() + &dot + with .to_string() + dot + 
// And: + &dot + with + dot +
// Check: dot is &str, so we use dot not &dot

// Fix the macos function section
content = content.replace(
    '    let dot = dot_char();\n    let names = [\n        "Codex".to_string() + &dot + "app",\n        "OpenAI Codex".to_string() + &dot + "app",\n        "OpenAI".to_string() + &dot + "Codex" + &dot + "app",\n    ];',
    '    let dot = dot_char();\n    let names = [\n        format!("Codex{}app", dot),\n        format!("OpenAI Codex{}app", dot),\n        format!("OpenAI{}Codex{}app", dot, dot),\n    ];'
);

// Actually let me try format! since dot is &str
// format! with &str should not trigger the parser bug because &str != &String

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", content, "utf8");
console.log("Done");
