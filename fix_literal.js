const fs = require("fs");
let content = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8");

// The macos_app_candidates function: replace dynamic concat with literal strings
content = content.replace(
    '    let dot = dot_char();\n    let names = [\n        format!("Codex{}app", dot),\n        format!("OpenAI Codex{}app", dot),\n        format!("OpenAI{}Codex{}app", dot, dot),\n    ];',
    '    let names = ["Codex.app", "OpenAI Codex.app", "OpenAI.Codex.app"];'
);

// The file_name eq_ignore_ascii_case with Codex.exe - replace
content = content.replace(
    '"Codex.exe".to_string()',
    '"Codex.exe"'
);

// Also replace any remaining to_string() + &dot_char() + patterns
// Check for "Codex".to_string() + &dot_char() + "exe" type patterns
content = content.replace(
    '"Codex".to_string() + &dot_char() + "exe"',
    '"Codex.exe".to_string()'
);

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", content, "utf8");
console.log("Done - replaced with literal strings");
