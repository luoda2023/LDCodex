const fs = require("fs");
let content = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8");

content = content.replace(
    'format!("Codex{}app", dot)',
    '"Codex".to_string() + &dot + "app"'
);
content = content.replace(
    'format!("OpenAI Codex{}app", dot)',
    '"OpenAI Codex".to_string() + &dot + "app"'
);
content = content.replace(
    'format!("OpenAI{}Codex{}app", dot, dot)',
    '"OpenAI".to_string() + &dot + "Codex" + &dot + "app"'
);
content = content.replace(
    'format!("OpenAI{}Codex_", d)',
    '"OpenAI".to_string() + &d + "Codex_"'
);

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", content, "utf8");
console.log("Done");
