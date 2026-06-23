const fs = require("fs");
let content = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8");

// Replace the 3 format! lines in macos_app_candidates with hardcoded literals
content = content.replace(
    '    let dot = char::from(46u8).to_string();
    let names = [
        format!("Codex{}app", dot),
        format!("OpenAI Codex{}app", dot),
        format!("OpenAI{}Codex{}app", dot, dot),
    ];',
    "    let names = [\"Codex.app\", \"OpenAI Codex.app\", \"OpenAI.Codex.app\"];"
);

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", content, "utf8");
console.log("Done");
