const fs = require("fs");
let content = fs.readFileSync("crates/codex-plus-core/src/app_paths.rs","utf8");

// Scan for any non-printable/non-ASCII bytes that aren't valid UTF-8
let lines = content.split("\n");

// Rebuild the macos_app_candidates function cleanly
for(let i=0;i<lines.length;i++){
    if(lines[i].includes("fn macos_app_candidates")){
        // Collect the function
        let fnLines = [];
        let j = i;
        while(j < lines.length && lines[j].trim() !== "}"){
            fnLines.push(lines[j]);
            j++;
        }
        fnLines.push(lines[j]); // closing }
        console.log("Found function at L"+(i+1)+" to L"+(j+1));
        console.log(fnLines.join("\n"));
        
        // Replace the function body with clean code
        let cleanFn = [
            "#[cfg(target_os = \"macos\")]",
            "fn macos_app_candidates(root: &Path) -> Vec<PathBuf> {",
            "    if root.extension() == Some(OsStr::new(\"app\")) {",
            "        return vec![root.to_path_buf()];",
            "    }",
            "    vec![\"Codex.app\", \"OpenAI Codex.app\", \"OpenAI.Codex.app\"]",
            "        .into_iter()",
            "        .map(|name| root.join(name))",
            "        .collect()",
            "}"
        ];
        
        // Replace lines
        lines.splice(i, j-i+1, ...cleanFn);
        console.log("Replaced with clean function");
        break;
    }
}

fs.writeFileSync("crates/codex-plus-core/src/app_paths.rs", lines.join("\n"), "utf8");
console.log("Done");
