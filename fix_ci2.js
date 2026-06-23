const fs = require("fs");
let c = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8")
 .replace('format!("Codex{}app", dot)','"Codex.app"')
 .replace('format!("OpenAI Codex{}app", dot)','"OpenAI Codex.app"')
 .replace('format!("OpenAI{}Codex{}app", dot, dot)','"OpenAI.Codex.app"');
fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs",c);
