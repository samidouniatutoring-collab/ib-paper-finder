// Free data sources, called straight from the browser. Your Finnhub key stays in this browser only.
import type { Rates } from "./model";

const FH = "https://finnhub.io/api/v1";
const day = (d: Date): string => d.toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fh<T>(key: string, path: string, params: Record<string, string> = {}): Promise<T> {
  if (!key) throw new Error("Add your free Finnhub key in Settings first.");
  const q = new URLSearchParams({ ...params, token: key });
  const r = await fetch(`${FH}${path}?${q}`);
  if (r.status === 429) { await sleep(1500); return fh(key, path, params); }
  if (r.status === 401 || r.status === 403) throw new Error("Finnhub refused the request (wrong key, or that data isn't on the free plan).");
  if (!r.ok) throw new Error(`Finnhub error ${r.status}`);
  return r.json() as Promise<T>;
}

export interface Quote { c: number; d: number; dp: number; pc: number; t: number; }
/** Live prices, one call per symbol, paced under the free limit (60/min). */
export async function quotes(key: string, symbols: string[], onEach?: (s: string) => void): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  for (const s of [...new Set(symbols.filter(Boolean))]) {
    try { const q = await fh<Quote>(key, "/quote", { symbol: s }); if (q && q.c) out[s] = q; } catch (e) { if (String(e).includes("key")) throw e; }
    onEach?.(s); await sleep(250);
  }
  return out;
}
export interface FhProfile { name?: string; finnhubIndustry?: string; country?: string; currency?: string; ticker?: string; }
export const profile = (key: string, symbol: string) => fh<FhProfile>(key, "/stock/profile2", { symbol });

export interface NewsItem { headline: string; source: string; url: string; datetime: number; summary: string; related?: string; }
export function companyNews(key: string, symbol: string, days = 7): Promise<NewsItem[]> {
  const to = new Date(); const from = new Date(Date.now() - days * 864e5);
  return fh<NewsItem[]>(key, "/company-news", { symbol, from: day(from), to: day(to) });
}
export const marketNews = (key: string) => fh<NewsItem[]>(key, "/news", { category: "general" });

export interface Ipo { date: string; exchange: string; name: string; symbol: string; price: string; numberOfShares: number; status: string; totalSharesValue: number; }
export async function ipoCalendar(key: string, days = 45): Promise<Ipo[]> {
  const r = await fh<{ ipoCalendar: Ipo[] }>(key, "/calendar/ipo", { from: day(new Date()), to: day(new Date(Date.now() + days * 864e5)) });
  return (r.ipoCalendar || []).sort((a, b) => a.date.localeCompare(b.date));
}
export interface Earning { date: string; symbol: string; epsEstimate: number | null; hour: string; }
export async function earnings(key: string, days = 30): Promise<Earning[]> {
  const r = await fh<{ earningsCalendar: Earning[] }>(key, "/calendar/earnings", { from: day(new Date()), to: day(new Date(Date.now() + days * 864e5)) });
  return r.earningsCalendar || [];
}

/** ECB exchange rates (free, no key): units per 1 EUR. */
export async function fxRates(): Promise<Rates> {
  for (const url of ["https://api.frankfurter.dev/v1/latest?base=EUR", "https://api.frankfurter.app/latest?from=EUR"]) {
    try { const r = await fetch(url); if (r.ok) { const j = await r.json(); return { EUR: 1, ...j.rates }; } } catch { /* try next */ }
  }
  throw new Error("Couldn't load exchange rates.");
}
