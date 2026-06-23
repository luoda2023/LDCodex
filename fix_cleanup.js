const fs = require("fs");
let c = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8");

// Remove unused let d = dot_char() in codex_prefix_str
c = c.replace(
    'fn codex_prefix_str() -> String {
    let d = dot_char();
    "OpenAI.Codex_".to_string()
}',
    'fn codex_prefix_str() -> String {
    "OpenAI.Codex_".to_string()
}'
);

// Replace fn dot_char to return simpler &str but keep for compatibility
c = c.replace(
    "fn dot_char() -> String {
    \"..\"[1..2].to_string()
}",
    "fn dot_char() -> String {
    \".\".to_string()
}"
);

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", c);
console.log("Done");
