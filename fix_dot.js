const fs = require("fs");
let content = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8");

// Only change: make dot_char() return &str instead of String
// This means all &dot references are &str, not &String - avoids parser bug

content = content.replace(
    'fn dot_char() -> String {\n    \"..\"[1..2].to_string()\n}',
    'fn dot_char() -> &\'static str {\n    \".\"\n}'
);

// Since dot_char() now returns &str, we don't need &dot_char() - just dot_char()
// But we also don't need to remove & - &(&str) = &str, it still works

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", content, "utf8");
console.log("Changed dot_char return type to &str");
