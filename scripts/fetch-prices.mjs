// Runs on GitHub Actions before each build (and every weekday evening): downloads end-of-day prices
// for the symbols in prices-symbols.txt from Yahoo Finance and writes public/data/prices.json.
// Server-side, so no browser CORS limits and no API key. Never fails the build.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const syms = [...new Set(readFileSync("prices-symbols.txt", "utf8").split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean))];
const out = { updated: new Date().toISOString(), symbols: {} };
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
for (const s of syms) {
  let done = false;
  for (const host of ["query1", "query2"]) {
    if (done) break;
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=2y&interval=1d`, { headers: UA });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const res = j.chart?.result?.[0];
      if (!res) throw new Error("no result");
      let cur = res.meta.currency || "USD"; let k = 1;
      if (cur === "GBp" || cur === "GBX") { cur = "GBP"; k = 0.01; }
      if (cur === "ZAc") { cur = "ZAR"; k = 0.01; }
      const ts = res.timestamp || []; const cl = res.indicators?.quote?.[0]?.close || [];
      const closes = [];
      for (let i = 0; i < ts.length; i++) if (cl[i] != null) closes.push([new Date(ts[i] * 1000).toISOString().slice(0, 10), +(cl[i] * k).toFixed(4)]);
      const last = closes[closes.length - 1];
      out.symbols[s] = { currency: cur, name: res.meta.longName || res.meta.shortName || s, exchange: res.meta.exchangeName, last: last?.[1], lastDate: last?.[0], closes };
      ok++; done = true;
    } catch (e) { console.log(`  ${s} via ${host}: ${e.message}`); }
  }
  await sleep(400);
}
mkdirSync("public/data", { recursive: true });
writeFileSync("public/data/prices.json", JSON.stringify(out));
console.log(`prices: ${ok}/${syms.length} symbols`);
