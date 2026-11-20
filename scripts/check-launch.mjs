// Run before going live:  npm run check-launch
// Fails while the legal pages still contain [PLACEHOLDERS] that you need to fill in.
import fs from "node:fs";

const files = fs.readdirSync(".").filter((f) => f.endsWith(".html"));
let bad = 0;
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  for (const m of text.matchAll(/\[(YOUR LEGAL NAME|BUSINESS ADDRESS|CONFIRM REGION)[^\]]*\]/g)) {
    console.log(`${f}: ${m[0]}`);
    bad++;
  }
}
if (bad) {
  console.log(`\n${bad} placeholder(s) left. Fill them in before launch.`);
  process.exit(1);
}
console.log("No placeholders left in the legal pages.");
