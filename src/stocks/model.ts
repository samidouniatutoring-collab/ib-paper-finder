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
}
export interface Watch { symbol: string; above?: number; below?: number; note?: string; }
export interface Snapshot { date: string; value: number; cost: number; spy?: number; }
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
      { id: "parents", name: "Parents' Bankinter", broker: "bankinter", brokerCero: false, otherFee: 0 },
      { id: "mine", name: "My Bankinter", broker: "bankinter", brokerCero: false, otherFee: 0 },
    ],
    holdings: [], watch: [], history: [], finnhubKey: "",
    profile: { goal: "Beat the S&P 500 over the long run (aim 10–15% a year)", horizon: "5+ years, buy and hold", monthly: 200, notes: "" },
  };
}
export function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...(JSON.parse(raw) as Partial<State>) };
  } catch { return defaultState(); }
}
export function save(s: State): void { localStorage.setItem(KEY, JSON.stringify(s)); }

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
export function custodyQuarter(acc: Account, market: Market, valueEur: number): number {
  if (acc.broker === "other" || valueEur <= 0) return 0;
  return Math.max(6, valueEur * (market === "es" ? 0.0004 : 0.0005));
}
export function dividendFee(acc: Account, market: Market, dividendEur: number): number {
  if (acc.broker === "other") return 0;
  return Math.max(1.2, dividendEur * (market === "es" ? 0.0025 : 0.003));
}

// ---------- valuation ----------
export type Rates = Record<string, number>; // units of currency per 1 EUR
export const toEur = (amount: number, cur: string, rates: Rates): number => (cur === "EUR" ? amount : amount / (rates[cur] || NaN));

export interface Valued { h: Holding; price: number | null; priceSource: "live" | "manual" | "none"; value: number; cost: number; pl: number; plPct: number; }
export function valueHolding(h: Holding, live: Record<string, number>, rates: Rates): Valued {
  let price: number | null = null; let src: Valued["priceSource"] = "none";
  const q = h.quoteSymbol && live[h.quoteSymbol];
  if (q) {
    const inQuote = q * (h.quoteRatio || 1);
    price = h.quoteCurrency === h.currency ? inQuote : toEur(inQuote, h.quoteCurrency, rates) * (h.currency === "EUR" ? 1 : rates[h.currency] || NaN);
    src = "live";
  } else if (h.manualPrice) { price = h.manualPrice; src = "manual"; }
  const cost = toEur(h.shares * h.avgCost, h.currency, rates);
  const value = price == null ? cost : toEur(h.shares * price, h.currency, rates);
  return { h, price, priceSource: src, value, cost, pl: value - cost, plPct: cost ? (value - cost) / cost : 0 };
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
  return rows.reduce((a, r) => { const acc = accounts.find((x) => x.id === r.h.accountId); return a + (acc ? custodyQuarter(acc, r.h.market, r.value) * 4 : 0); }, 0);
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
      quoteSymbol: c[5] !== undefined ? c[5].toUpperCase() : market === "us" ? c[0].toUpperCase() : "", quoteCurrency: market === "us" ? "USD" : cur, quoteRatio: 1 });
  }
  return out;
}

export const eur = (n: number): string => (isFinite(n) ? n.toLocaleString("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: n < 100 ? 2 : 0 }) : "–");
export const pct = (n: number): string => (isFinite(n) ? `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%` : "–");
