import { execSync } from "child_process";
import { writeFileSync } from "fs";

function fixAppPaths() {
  let d = execSync("git -C J:/codex-work/LDCodex show HEAD:crates/codex-plus-core/src/app_paths.rs");
  let s = d.toString("utf8");
  s = s.replace(/\ufeff/g, "");
  s = s.replace(/[^\x00-\x7f]/g, "");
  s = s.replace(/\r\n/g, "\n");
  const target = "}#[cfg(target_os = \"" + "macos" + "\")]";
  const repl = "}\n#[cfg(target_os = \"" + "macos" + "\")]";
  s = s.split(target).join(repl);
  s = s.split("\n").filter(l => l.indexOf("const CODEX_PREFIX") < 0).join("\n");
  s = s.replace(/\n*$/, "") + "\n";
  writeFileSync("J:/codex-work/LDCodex/crates/codex-plus-core/src/app_paths.rs", s, "utf8");
  console.log("app_paths.rs: " + s.length + " bytes");
}

function fixRelayConfig() {
  let d = execSync("git -C J:/codex-work/LDCodex show HEAD:crates/codex-plus-core/src/relay_config.rs");
  let s = d.toString("utf8");
  s = s.replace(/\ufeff/g, "");
  s = s.replace(/[^\x00-\x7f]/g, "");
  s = s.replace(/\r\n/g, "\n");
  let depth = 0;
  for (const ch of s) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  console.log("relay_config.rs: brace depth = " + depth);
  s = s.replace(/\n*$/, "") + "\n" + "}".repeat(depth) + "\n";
  writeFileSync("J:/codex-work/LDCodex/crates/codex-plus-core/src/relay_config.rs", s, "utf8");
  console.log("relay_config.rs: " + s.length + " bytes");
}

fixAppPaths();
fixRelayConfig();
console.log("Done");
