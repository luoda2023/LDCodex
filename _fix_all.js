const { execSync } = require("child_process");
const fs = require("fs");

// === FIX 1: app_paths.rs ===
const buf = execSync("git show HEAD:crates/codex-plus-core/src/app_paths.rs", {encoding:"buffer"});
let text = buf.toString("binary");
text = text.replace('OsStr::new("\\")', 'OsStr::new("\\\\")');
let raw = Buffer.from(text, "binary");
let clean = Buffer.alloc(raw.length);
let j = 0;
for(let i=0; i<raw.length; i++) if(raw[i]<128) clean[j++] = raw[i];
clean = clean.slice(0,j);
let ap = clean.toString("ascii");
ap = ap.replace(/\r\n/g, "\n");
ap = ap.replace(/\}#\[cfg/g, "}\n#[cfg");
ap = ap.replace(/(#[[]cfg[(]target_os = "macos"[)]])(\n\1)+/g, "");
ap = ap.replace("    [\n        root.join(\"Codex.app\"),\n        root.join(\"OpenAI Codex.app\"),\n        root.join(\"OpenAI.Codex.app\"),\n    ]",
  "    vec![\n        root.join(\"Codex.app\"),\n        root.join(\"OpenAI Codex.app\"),\n        root.join(\"OpenAI.Codex.app\"),\n    ]");
ap = ap.replace(/"Codex\.exe"\.to_string\(\)/g, '"Codex.exe"');
ap = ap.replace(/"Info\.plist"\.to_string\(\)/g, '"Info.plist"');
ap = ap.replace(/"OpenAI\.Codex"\.to_string\(\)/g, '"OpenAI.Codex"');
fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", ap, "utf8");
console.log("app_paths.rs fixed");

// === FIX 2: launcher.rs ===
let launcher = fs.readFileSync("crates/codex-plus-core/src/launcher.rs", "utf8");
launcher = launcher.replace(".map(str::trim)", ".map(|s| s.trim())");
fs.writeFileSync("crates/codex-plus-core/src/launcher.rs", launcher);
console.log("launcher.rs fixed");

// === FIX 3: protocol_proxy.rs ===
let pp = fs.readFileSync("crates/codex-plus-core/src/protocol_proxy.rs", "utf8");
if (!pp.includes("use std::iter::FromIterator;")) {
  pp = "use std::iter::FromIterator;\n" + pp;
}
fs.writeFileSync("crates/codex-plus-core/src/protocol_proxy.rs", pp);
console.log("protocol_proxy.rs fixed");

// === FIX 4: proxy.rs ===
let proxy = fs.readFileSync("crates/codex-plus-core/src/proxy.rs", "utf8");
proxy = proxy.replace("env.get(name)", "env.get(name.as_str())");
fs.writeFileSync("crates/codex-plus-core/src/proxy.rs", proxy);
console.log("proxy.rs fixed");

// === FIX 5: relay_switch.rs ===
let rs = fs.readFileSync("crates/codex-plus-core/src/relay_switch.rs", "utf8");
rs = rs.replace("sections.join(\"\\n\\n\")", "sections.iter().map(|s| *s).collect::<Vec<_>>().join(\"\\n\\n\")");
fs.writeFileSync("crates/codex-plus-core/src/relay_switch.rs", rs);
console.log("relay_switch.rs fixed");

// === FIX 6: settings.rs ===
let settings = fs.readFileSync("crates/codex-plus-core/src/settings.rs", "utf8");
if (!settings.includes("use std::convert::TryFrom;")) {
  settings = "use std::convert::TryFrom;\n" + settings;
}
fs.writeFileSync("crates/codex-plus-core/src/settings.rs", settings);
console.log("settings.rs fixed");

// === FIX 7: zed_remote.rs ===
let zr = fs.readFileSync("crates/codex-plus-core/src/zed_remote.rs", "utf8");
if (!zr.includes("use std::convert::TryFrom;")) {
  zr = "use std::convert::TryFrom;\n" + zr;
}
fs.writeFileSync("crates/codex-plus-core/src/zed_remote.rs", zr);
console.log("zed_remote.rs fixed");

console.log("ALL FIXES APPLIED");
