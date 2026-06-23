const fs = require("fs");
let content = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8");

// Complete approach: replace dot_char() with const DOT: &str = "."
// and use DOT directly instead of &dot_char() or &dot

// 1. Replace fn dot_char with const
content = content.replace(
    "fn dot_char() -> String {\n    \".\".to_string()\n}",
    "const DOT: &str = \".\";"
);

// 2. Replace codex_prefix_str to use DOT directly
content = content.replace(
    'fn codex_prefix_str() -> String {\n    let d = dot_char();\n    ["OpenAI", &d, "Codex_"].concat()\n}',
    "fn codex_prefix_str() -> String {\n    format!(\"OpenAI{}Codex_\", DOT)\n}"
);

// 3. Fix macos_app_candidates - replace the dot variable usage
// The old code had: let dot = char::from(46u8).to_string();
// Now we use DOT directly
content = content.replace(
    "    let dot = \"just_a_placeholder\";",
    ""
);

// Actually the simplest: just restore the original file and do minimal edits
fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", content, "utf8");
console.log("Done");
