const fs = require("fs");
let content = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8");
let lines = content.split("\n");

// Fix line 480: the problematic format! with multiple dot args
lines[479] = "\"OpenAI\".to_owned() + &dot + \"Codex\" + &dot + \"app\",";

// Fix line 478
lines[477] = "\"Codex\".to_owned() + &dot + \"app\",";

// Fix line 479 (was 478)
lines[478] = "\"OpenAI Codex\".to_owned() + &dot + \"app\",";

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", lines.join("\n"), "utf8");
console.log("Done");
