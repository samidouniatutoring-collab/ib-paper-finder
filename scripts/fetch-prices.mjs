// Runs on GitHub Actions before each build and every weekday evening.
// Reads closing prices from Sami's Google Sheet (GOOGLEFINANCE, every market, no API key),
// appends them to a running history kept on the `data` branch, and writes public/data/prices.json.
// Never fails the build.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const SHEET = "1nBsWVvtM4b3kZxcxDGu8LuB8b34sD4hB07WH6vRu3qY";
const HIST = process.argv[2] || "history.json";
const hist = existsSync(HIST) ? JSON.parse(readFileSync(HIST, "utf8") || "{}") : {};
hist.symbols ||= {};

function parseCsv(t) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

let ok = 0;
try {
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv&gid=0`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const rows = parseCsv(await r.text()).slice(1);
  const today = new Date().toISOString().slice(0, 10);
  for (const [sym, , priceS, curS, dateS] of rows) {
    let price = parseFloat(priceS); if (!sym || !isFinite(price)) continue;
    let cur = curS || "USD";
    if (cur === "GBX" || cur === "GBp") { cur = "GBP"; price /= 100; }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateS || "") ? dateS : today;
    const s = (hist.symbols[sym] ||= { currency: cur, closes: [] });
    s.currency = cur;
    s.closes = s.closes.filter((c) => c[0] !== date);
    s.closes.push([date, +price.toFixed(4)]);
    s.closes.sort((a, b) => a[0].localeCompare(b[0]));
    s.closes = s.closes.slice(-800);
    ok++;
  }
  hist.updated = new Date().toISOString();
} catch (e) { console.log("sheet fetch failed:", e.message); }

writeFileSync(HIST, JSON.stringify(hist));
const out = { updated: hist.updated || null, symbols: {} };
for (const [k, s] of Object.entries(hist.symbols)) { const last = s.closes[s.closes.length - 1]; out.symbols[k] = { currency: s.currency, last: last?.[1], lastDate: last?.[0], closes: s.closes }; }
mkdirSync("public/data", { recursive: true });
writeFileSync("public/data/prices.json", JSON.stringify(out));
console.log(`prices: ${ok} symbols from the sheet, ${Object.keys(hist.symbols).length} in history`);
