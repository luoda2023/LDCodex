const fs = require("fs");
let content = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8");

// Replace the macos_app_candidates function's names array with vec! macro
content = content.replace(
    '    let dot = char::from(46u8).to_string();\n    let names = [\n        "Codex.app",\n        "OpenAI Codex.app",\n        "OpenAI.Codex.app",\n    ];\n    names\n        .into_iter()\n        .map(|name| root.join(name))\n        .collect()',
    '    [\n        root.join("Codex.app"),\n        root.join("OpenAI Codex.app"),\n        root.join("OpenAI.Codex.app"),\n    ]'
);

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", content, "utf8");
console.log("Done");
