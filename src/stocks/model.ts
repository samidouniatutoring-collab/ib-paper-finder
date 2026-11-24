// Portfolio app: data model, storage, Bankinter fees and concentration analysis. Pure functions where possible (tested).

export type Market = "es" | "us" | "eu" | "uk" | "other";
export interface Account { id: string; name: string; broker: "bankinter" | "other"; brokerCero: boolean; otherFee: number; }
export interface Holding {
  id: string; accountId: string; ticker: string; name: string; market: Market; currency: string;
  shares: number; avgCost: number;            // avg cost per share, in `currency`
  quoteSymbol: string;                        // Finnhub symbol for live price (US listings only on the free plan); "" = manual
  quoteCurrency: string; quoteRatio: number;  // ADR: price × ratio = price of one held share (in quoteCurrency)
  manualPrice?: number; manualAt?: string;    // price in `currency`
  sector?: string; country?: string;
  boughtAt?: string;
  yahoo?: string;                            // end-of-day symbol (Yahoo format: ASML.AS, FRES.L, CLNX.MC…)
  plan?: boolean;                             // ETF with Bankinter 'compra periódica' active: no 6€ custody minimum
}
export interface EodSym { currency: string; name?: string; last?: number; lastDate?: string; closes: [string, number][]; }
export type Eod = Record<string, EodSym>;
export function yahooGuess(ticker: string, market: Market): string {
  const t = ticker.toUpperCase();
  return market === "us" ? t : market === "es" ? `${t}.MC` : market === "uk" ? `${t}.L` : "";
}
export interface Watch { symbol: string; above?: number; below?: number; note?: string; }
export interface Snapshot { date: string; value: number; cost: number; spy?: number; accounts?: Record<string, { value: number; cost: number }>; }
export interface Profile { goal: string; horizon: string; monthly: number; notes: string; }
export interface State {
  accounts: Account[]; holdings: Holding[]; watch: Watch[]; history: Snapshot[];
  finnhubKey: string; profile: Profile;
}

const KEY = "portfolio-app";
export const newId = (): string => Math.random().toString(36).slice(2, 10);

export function defaultState(): State {
  return {
    accounts: [
      { id: "mine", name: "My portfolio", broker: "bankinter", brokerCero: true, otherFee: 0 },
      { id: "parents", name: "Parents' portfolio", broker: "bankinter", brokerCero: false, otherFee: 0 },
    ],
    holdings: [], watch: [], history: [], finnhubKey: "",
    profile: { goal: "Beat the S&P 500 over the long run (aim 10–15% a year)", horizon: "5+ years, buy and hold", monthly: 200, notes: "" },
  };
}
/** Old default account names → new ones (names you typed yourself are left alone). */
const RENAMED: Record<string, string> = { "Parents' Bankinter": "Parents' portfolio", "My Bankinter": "My portfolio" };
export function renameAccounts(s: State): State {
  return { ...s, accounts: s.accounts.map((a) => (RENAMED[a.name] ? { ...a, name: RENAMED[a.name] } : a)) };
}
export function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    return renameAccounts({ ...defaultState(), ...(JSON.parse(raw) as Partial<State>) });
  } catch { return defaultState(); }
}
export function save(s: State): void {
  const raw = JSON.stringify(s);
  try { localStorage.setItem(KEY, raw); } catch { /* full or blocked: the IndexedDB copy still saves */ }
  void idb("put", raw);
  // Ask the browser not to clear this site's storage (Safari otherwise may).
  try { void navigator.storage?.persist?.(); } catch { /* ignore */ }
}

/** Second copy of everything (holdings, accounts, history and the Finnhub key) in IndexedDB,
 *  so the portfolio survives if the browser drops localStorage. Same fix as the Transcriber. */
function idb(op: "get" | "put", value?: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open("portfolio-app", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onerror = () => resolve(undefined);
      req.onsuccess = () => {
        const tx = req.result.transaction("kv", op === "get" ? "readonly" : "readwrite");
        const st = tx.objectStore("kv");
        const r = op === "get" ? st.get(KEY) : st.put(value, KEY);
        r.onsuccess = () => resolve(op === "get" ? (r.result as string | undefined) : value);
        r.onerror = () => resolve(undefined);
      };
    } catch { resolve(undefined); }
  });
}
const hasData = (s: Partial<State>): boolean => !!(s.finnhubKey || s.holdings?.length || s.watch?.length || s.history?.length);
/** On start: if localStorage lost the portfolio or the key but IndexedDB still has them, bring them back.
 *  Returns the restored state, or null if nothing needed restoring. */
export async function restore(): Promise<State | null> {
  let cur: Partial<State> = {};
  try { cur = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<State>; } catch { /* ignore */ }
  const raw = await idb("get");
  let saved: Partial<State> = {};
  try { saved = raw ? (JSON.parse(raw) as Partial<State>) : {}; } catch { /* ignore */ }
  if (!hasData(saved)) { if (hasData(cur)) void idb("put", JSON.stringify(cur)); return null; }
  const merged: State = { ...defaultState(), ...saved, ...cur };
  // Fill whatever localStorage lost from the IndexedDB copy.
  if (!cur.finnhubKey && saved.finnhubKey) merged.finnhubKey = saved.finnhubKey;
  if (!cur.holdings?.length && saved.holdings?.length) { merged.holdings = saved.holdings; merged.accounts = saved.accounts ?? merged.accounts; }
  if (!cur.history?.length && saved.history?.length) merged.history = saved.history;
  if (!cur.watch?.length && saved.watch?.length) merged.watch = saved.watch;
  if (JSON.stringify(merged) === JSON.stringify({ ...defaultState(), ...cur })) return null;
  Object.assign(merged, renameAccounts(merged));
  try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* ignore */ }
  void idb("put", JSON.stringify(merged));
  return merged;
}

// ---------- Bankinter fees (published tariff, Nov 2026) ----------
export const MARKET_LABEL: Record<Market, string> = { es: "Spain (Mercado Continuo)", us: "USA", eu: "Europe (Paris, Frankfurt, Amsterdam…)", uk: "UK (London)", other: "Other international" };
/** Commission for one buy or sell, in EUR. */
export function tradeFee(acc: Account, market: Market, amountEur: number, promoDay = false): number {
  if (acc.broker === "other") return acc.otherFee;
  if (market === "es") {
    if (acc.brokerCero) return 0;
    if (amountEur <= 2000) return 3.95;
    if (amountEur <= 60000) return 8;
    return Math.min(200, amountEur * 0.0007);
  }
  if (promoDay && acc.brokerCero) return 0;
  return amountEur < 40000 ? 20 : amountEur * 0.002;
}
/** Financial transaction tax on BUYING (Spain large caps 0.2%, France 0.4%, Italy 0.1%). */
export function buyTax(country: string | undefined, market: Market, amountEur: number): number {
  const c = (country || "").toUpperCase();
  if (market === "es" || c === "ES" || c === "SPAIN") return amountEur * 0.002;
  if (c === "FR" || c === "FRANCE") return amountEur * 0.004;
  if (c === "IT" || c === "ITALY") return amountEur * 0.001;
  return 0;
}
/** Custody per quarter for one stock: 0.04% (Spain) / 0.05% (international), minimum 6€ per stock. */
export function custodyQuarter(acc: Account, market: Market, valueEur: number, plan = false): number {
  if (acc.broker === "other" || valueEur <= 0) return 0;
  const v = valueEur * (market === "es" ? 0.0004 : 0.0005);
  return plan ? v : Math.max(6, v);
}
export function dividendFee(acc: Account, market: Market, dividendEur: number): number {
  if (acc.broker === "other") return 0;
  return Math.max(1.2, dividendEur * (market === "es" ? 0.0025 : 0.003));
}

// ---------- valuation ----------
export type Rates = Record<string, number>; // units of currency per 1 EUR
export const toEur = (amount: number, cur: string, rates: Rates): number => (cur === "EUR" ? amount : amount / (rates[cur] || NaN));

export interface Valued { h: Holding; price: number | null; priceSource: "live" | "eod" | "manual" | "none"; priceDate?: string; value: number; cost: number; pl: number; plPct: number; }
const convert = (x: number, from: string, to: string, rates: Rates) => (from === to ? x : toEur(x, from, rates) * (to === "EUR" ? 1 : rates[to] || NaN));
export function valueHolding(h: Holding, live: Record<string, number>, rates: Rates, eod: Eod = {}): Valued {
  let price: number | null = null; let src: Valued["priceSource"] = "none"; let date: string | undefined;
  const q = h.quoteSymbol && live[h.quoteSymbol];
  const e = h.yahoo ? eod[h.yahoo] : undefined;
  if (q) { price = convert(q * (h.quoteRatio || 1), h.quoteCurrency, h.currency, rates); src = "live"; }
  else if (e?.last) { price = convert(e.last, e.currency, h.currency, rates); src = "eod"; date = e.lastDate; }
  else if (h.manualPrice) { price = h.manualPrice; src = "manual"; date = h.manualAt; }
  const cost = toEur(h.shares * h.avgCost, h.currency, rates);
  const value = price == null ? cost : toEur(h.shares * price, h.currency, rates);
  return { h, price, priceSource: src, priceDate: date, value, cost, pl: value - cost, plPct: cost ? (value - cost) / cost : 0 };
}

export interface Slice { key: string; value: number; pct: number; }
export function breakdown(rows: Valued[], key: (v: Valued) => string): Slice[] {
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r) || "Unknown", (m.get(key(r) || "Unknown") || 0) + r.value);
  return [...m.entries()].map(([k, v]) => ({ key: k, value: v, pct: v / total })).sort((a, b) => b.value - a.value);
}
export function warnings(rows: Valued[]): string[] {
  const out: string[] = [];
  for (const s of breakdown(rows, (r) => r.h.ticker)) if (s.pct > 0.1) out.push(`${s.key} is ${(s.pct * 100).toFixed(1)}% of the portfolio (over 10% in one stock).`);
  for (const s of breakdown(rows, (r) => r.h.sector || "")) if (s.key !== "Unknown" && s.pct > 0.25) out.push(`${s.key} is ${(s.pct * 100).toFixed(1)}% (over 25% in one sector).`);
  for (const s of breakdown(rows, (r) => r.h.currency)) if (s.pct > 0.7) out.push(`${(s.pct * 100).toFixed(0)}% is in ${s.key}: a big currency bet against the euro.`);
  return out;
}
/** Total yearly custody if each stock pays its own 6€ minimum. */
export function yearlyCustody(rows: Valued[], accounts: Account[]): number {
  return rows.reduce((a, r) => { const acc = accounts.find((x) => x.id === r.h.accountId); return a + (acc ? custodyQuarter(acc, r.h.market, r.value, r.h.plan) * 4 : 0); }, 0);
}

// ---------- CSV import: ticker,shares,avgCost,currency,market[,quoteSymbol,name] ----------
export function parseCsv(text: string, accountId: string): Holding[] {
  const out: Holding[] = [];
  for (const line of text.split(/\r?\n/)) {
    const c = line.split(/[;\t]/.test(line) ? /[;\t]/ : /,/).map((x) => x.trim());
    if (c.length < 4 || !c[0] || /ticker/i.test(c[0])) continue;
    const shares = Number(c[1].replace(",", ".")); const avg = Number(c[2].replace(",", "."));
    if (!isFinite(shares) || !isFinite(avg)) continue;
    const market = (["es", "us", "eu", "uk", "other"].includes(c[4]) ? c[4] : "us") as Market;
    const cur = (c[3] || "USD").toUpperCase();
    out.push({ id: newId(), accountId, ticker: c[0].toUpperCase(), name: c[6] || c[0].toUpperCase(), market, currency: cur, shares, avgCost: avg,
      quoteSymbol: c[5] !== undefined ? c[5].toUpperCase() : market === "us" ? c[0].toUpperCase() : "", quoteCurrency: market === "us" ? "USD" : cur, quoteRatio: 1,
      yahoo: c[7] ? c[7].toUpperCase() : yahooGuess(c[0], market) || undefined });
  }
  return out;
}

export const eur = (n: number): string => (isFinite(n) ? n.toLocaleString("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: n < 100 ? 2 : 0 }) : "–");
export const pct = (n: number): string => (isFinite(n) ? `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%` : "–");

/** Today's holdings replayed over the last `days` using end-of-day closes (today's FX), vs a benchmark. */
export function backfill(rows: Valued[], eod: Eod, rates: Rates, bench = "^GSPC", days = 365): { dates: string[]; mine: number[]; bench: number[]; missing: string[] } | null {
  const b = eod[bench]; if (!b || b.closes.length < 10) return null;
  const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const dates = b.closes.map((c) => c[0]).filter((d) => d >= start);
  const missing: string[] = []; const series: { sh: number; cur: string; map: Map<string, number> }[] = [];
  for (const r of rows) {
    const e = r.h.yahoo ? eod[r.h.yahoo] : undefined;
    if (!e || e.closes.length < 10) { missing.push(r.h.ticker); continue; }
    series.push({ sh: r.h.shares, cur: e.currency, map: new Map(e.closes) });
  }
  if (!series.length) return null;
  const last: number[] = series.map(() => NaN);
  const vals = dates.map((d) => series.reduce((tot, s, i) => { const c = s.map.get(d); if (c != null) last[i] = c; return tot + (isFinite(last[i]) ? toEur(s.sh * last[i], s.cur, rates) : 0); }, 0));
  // start the comparison from the first day every series has a price
  const firstFull = dates.findIndex((d) => series.every((s) => [...s.map.keys()].some((k) => k <= d)));
  const i0 = Math.max(0, firstFull);
  const bm = new Map(b.closes);
  return { dates: dates.slice(i0), mine: vals.slice(i0).map((v) => v / vals[i0] - 1), bench: dates.slice(i0).map((d) => (bm.get(d) as number) / (bm.get(dates[i0]) as number) - 1), missing };
}

/** One-click import links: stocks.html#import=<base64url JSON {accounts?, holdings, watch?}>. The hash never reaches a server. */
export interface ImportData { accounts?: Account[]; holdings: Holding[]; watch?: Watch[]; replace?: boolean; }
export function encodeImport(d: ImportData): string {
  const b = btoa(unescape(encodeURIComponent(JSON.stringify(d))));
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeImport(s: string): ImportData {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(decodeURIComponent(escape(atob(b + "=".repeat((4 - (b.length % 4)) % 4)))));
}
export function applyImport(st: State, d: ImportData): State {
  const accounts = [...st.accounts];
  for (const a of d.accounts ?? []) { const i = accounts.findIndex((x) => x.id === a.id); if (i >= 0) accounts[i] = { ...accounts[i], ...a }; else accounts.push(a); }
  const touched = new Set(d.holdings.map((x) => x.accountId));
  const keep = d.replace ? st.holdings.filter((x) => !touched.has(x.accountId)) : st.holdings;
  const holdings = [...keep, ...d.holdings.map((x) => ({ ...x, id: x.id || newId() }))];
  const watch = [...st.watch]; for (const w of d.watch ?? []) if (!watch.some((x) => x.symbol === w.symbol)) watch.push(w);
  return { ...st, accounts, holdings, watch };
}
