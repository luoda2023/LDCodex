const fs = require("fs");
let content = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8");

content = content.replace(
    'vec!["Codex", &dot_char(), "exe"].concat()',
    '"Codex.exe".to_string()'
);

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", content, "utf8");
console.log("Fixed remaining");
