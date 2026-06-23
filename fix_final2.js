const fs = require("fs");
let content = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8");

// The rust 1.95 parser can't parse format!("...{}...{}...", var, var)
// Replace with direct literal strings since "." is always "."
content = content.replace(
    '    let dot = char::from(46u8).to_string();
    let names = [
        format!("Codex{}app", dot),
        format!("OpenAI Codex{}app", dot),
        format!("OpenAI{}Codex{}app", dot, dot),
    ];',
    '    let names = [
        "Codex.app",
        "OpenAI Codex.app",
        "OpenAI.Codex.app",
    ];'
);

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", content, "utf8");
console.log("Done");
