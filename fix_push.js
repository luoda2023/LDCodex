const fs = require("fs");
let content = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8");

// Replace the problematic vec! with manual push
content = content.replace(
    '    vec!["Codex.app", "OpenAI Codex.app", "OpenAI.Codex.app"]\n        .into_iter()\n        .map(|name| root.join(name))\n        .collect()',
    '    let mut v = Vec::new();\n    v.push(root.join("Codex.app"));\n    v.push(root.join("OpenAI Codex.app"));\n    v.push(root.join("OpenAI.Codex.app"));\n    v'
);

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", content, "utf8");
console.log("Done");
