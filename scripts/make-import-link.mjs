// node scripts/make-import-link.mjs holdings.json  → one-click link that loads holdings into the Portfolio app.
import { readFileSync } from "node:fs";
const d = JSON.parse(readFileSync(process.argv[2], "utf8"));
const b = Buffer.from(JSON.stringify(d), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
console.log(`https://samidouniatutoring-collab.github.io/ib-paper-finder/stocks.html#import=${b}`);
