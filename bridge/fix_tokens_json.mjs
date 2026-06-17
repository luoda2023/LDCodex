import { readFileSync, writeFileSync, existsSync } from "fs";

const p = process.argv[2] || "data/admin-tokens.json";
if (!existsSync(p)) {
  console.log("File not found:", p);
  process.exit(0);
}

let d = JSON.parse(readFileSync(p, "utf8"));
let changed = false;

if (d.byProvider) {
  const original = d.byProvider.length;
  d.byProvider = d.byProvider.filter(function(r) {
    return ["1", "2", "3"].indexOf(String(r.name)) < 0;
  });
  changed = d.byProvider.length !== original;
}

if (changed) {
  writeFileSync(p, JSON.stringify(d));
  console.log("CLEANED: removed 1/2/3 from byProvider");
} else {
  console.log("no changes needed");
}
