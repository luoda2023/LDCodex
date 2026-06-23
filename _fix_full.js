const { execSync } = require("child_process");
const fs = require("fs");
const buf = execSync("git show HEAD:crates/codex-plus-core/src/app_paths.rs", {encoding:"buffer"});

// Step 1: fix the root cause - OsStr::new("\") -> OsStr::new("\\")
let text = buf.toString("binary");
text = text.replace('OsStr::new("\\")', 'OsStr::new("\\\\")');

// Step 2: convert to Buffer and strip non-ASCII
let raw = Buffer.from(text, "binary");
let clean = Buffer.alloc(raw.length);
let j = 0;
for(let i=0; i<raw.length; i++) if(raw[i]<128) clean[j++] = raw[i];
clean = clean.slice(0,j);
text = clean.toString("ascii");

// Step 3: fix }#[cfg -> }\n#[cfg
text = text.replace(/\}#\[cfg/g, "}\n#[cfg");

// Step 4: dedup #[cfg(target_os = "macos")]
text = text.replace(/(#\[cfg\(target_os = \"macos\"\)\])(\n\1)+/g, "");

// Step 5: fix bare [ -> vec![ in macos function
text = text.replace(
  "    [\n        root.join(\"Codex.app\"),\n        root.join(\"OpenAI Codex.app\"),\n        root.join(\"OpenAI.Codex.app\"),\n    ]",
  "    vec![\n        root.join(\"Codex.app\"),\n        root.join(\"OpenAI Codex.app\"),\n        root.join(\"OpenAI.Codex.app\"),\n    ]"
);

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", text, "utf8");
console.log("Done, size: " + text.length);
