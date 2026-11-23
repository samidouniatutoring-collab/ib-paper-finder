// Builds the free "analysis packet" you send to Claude in the chat (no API cost).
import { type Account, type State, type Valued, MARKET_LABEL, breakdown, eur, pct, tradeFee, warnings, yearlyCustody } from "./model";
import type { Earning, Ipo, NewsItem } from "./api";

export interface PacketInput {
  state: State; rows: Valued[]; scope: string; cash: number; accountId: string; ideas: string;
  news: Record<string, NewsItem[]>; market: NewsItem[]; ipos: Ipo[]; earnings: Earning[]; spyReturn?: number; myReturn?: number;
}

const date = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

export function buildPacket(p: PacketInput): string {
  const { state, rows } = p;
  const acc = state.accounts.find((a) => a.id === p.accountId) as Account;
  const total = rows.reduce((a, r) => a + r.value, 0);
  const cost = rows.reduce((a, r) => a + r.cost, 0);
  const L: string[] = [];
  L.push("# Portfolio packet", "");
  L.push("> Please analyse this with Sami. Not a request for personal financial advice: give **3–5 different options** for the new money, each with pros, cons, risks and the fee impact, then a short comparison. Sami decides.", "");
  L.push("## The question");
  L.push(`- **New money to invest:** ${eur(p.cash)} into **${acc.name}** (${acc.broker === "bankinter" ? `Bankinter${acc.brokerCero ? ", Bróker Cero active" : ", no Bróker Cero"}` : `other broker, ${eur(acc.otherFee)} per trade`})`);
  L.push(`- **Goal:** ${state.profile.goal}`, `- **Horizon:** ${state.profile.horizon}`, `- **Monthly top-up:** ${eur(state.profile.monthly)}`);
  if (p.ideas.trim()) L.push(`- **Ideas / questions from Sami:** ${p.ideas.trim()}`);
  if (state.profile.notes.trim()) L.push(`- **Standing notes:** ${state.profile.notes.trim()}`);
  L.push("", "### Constraints to respect");
  L.push("- Must be buyable at Bankinter (Spanish + main international markets). Say so if an idea isn't available there.");
  L.push(`- Fees per trade at this account: Spain ${eur(tradeFee(acc, "es", Math.min(p.cash, 1999)))}, international ${eur(tradeFee(acc, "us", p.cash))} (Bankinter international is a flat 20€ under 40,000€). Fewer, bigger trades beat many small ones.`);
  L.push("- Custody: 0.04% (Spain) / 0.05% (international) per quarter, **minimum 6€ per stock**, so every extra stock costs at least 24€/year. Dividend collection 0.25–0.30% (min 1.20€). Tobin tax on buys: Spain 0.2%, France 0.4%, Italy 0.1%.");
  L.push("- Bankinter promoted ETFs (300+ from iShares, Vanguard, Amundi…) can be bought with 0€ commission, and with 'compra periódica' (monthly plan) the 6€ custody minimum is waived: the cheapest way to add money every month at Bankinter. Bróker Cero promo days (Black Friday, Cyber Monday, debut days) make international trades free.");
  L.push("- Diversify away from current concentrations (see warnings). Long-term, slow and steady; no leverage, no options.");
  L.push("", "## Current portfolio");
  L.push(`Value **${eur(total)}**, cost ${eur(cost)}, P/L **${eur(total - cost)} (${pct(cost ? (total - cost) / cost : 0)})**.`);
  if (p.myReturn != null && p.spyReturn != null) L.push(`Current holdings replayed over the last 12 months: ${pct(p.myReturn)} vs S&P 500 ${pct(p.spyReturn)}.`);
  L.push("", "| Account | Stock | Market | Weight | Value | P/L | Sector | Country |", "|---|---|---|---|---|---|---|---|");
  for (const r of [...rows].sort((a, b) => b.value - a.value)) {
    const a = state.accounts.find((x) => x.id === r.h.accountId);
    L.push(`| ${a?.name ?? ""} | ${r.h.ticker} ${r.h.name !== r.h.ticker ? `(${r.h.name})` : ""} | ${r.h.market} | ${((r.value / (total || 1)) * 100).toFixed(1)}% | ${eur(r.value)} | ${pct(r.plPct)} | ${r.h.sector ?? "?"} | ${r.h.country ?? "?"} |`);
  }
  const slices = (title: string, s: ReturnType<typeof breakdown>) => { L.push("", `**${title}:** ` + s.map((x) => `${x.key} ${(x.pct * 100).toFixed(0)}%`).join(" · ")); };
  slices("By sector", breakdown(rows, (r) => r.h.sector || ""));
  slices("By country", breakdown(rows, (r) => r.h.country || ""));
  slices("By currency", breakdown(rows, (r) => r.h.currency));
  L.push("", `**Estimated custody per year** (6€ minimum per stock): ${eur(yearlyCustody(rows, state.accounts))}`);
  const w = warnings(rows);
  if (w.length) { L.push("", "### Warnings"); for (const x of w) L.push(`- ${x}`); }
  if (state.watch.length) { L.push("", "## Watchlist"); for (const x of state.watch) L.push(`- ${x.symbol}${x.note ? `: ${x.note}` : ""}`); }
  const holdNews = Object.entries(p.news).filter(([, n]) => n.length);
  if (holdNews.length) {
    L.push("", "## News on holdings (last 7 days)");
    for (const [s, n] of holdNews) { L.push(`**${s}**`); for (const x of n.slice(0, 3)) L.push(`- ${date(x.datetime)} · ${x.source}: ${x.headline}`); }
  }
  if (p.market.length) { L.push("", "## Market headlines"); for (const x of p.market.slice(0, 12)) L.push(`- ${date(x.datetime)} · ${x.source}: ${x.headline}`); }
  const myEarn = p.earnings.filter((e) => rows.some((r) => r.h.quoteSymbol === e.symbol || r.h.ticker === e.symbol));
  if (myEarn.length) { L.push("", "## Upcoming earnings (holdings)"); for (const e of myEarn) L.push(`- ${e.date} ${e.symbol}${e.epsEstimate != null ? ` (EPS est. ${e.epsEstimate})` : ""}`); }
  if (p.ipos.length) { L.push("", "## IPO calendar (next 45 days)"); for (const i of p.ipos.slice(0, 15)) L.push(`- ${i.date} ${i.name} (${i.symbol || "no ticker yet"}, ${i.exchange || "?"}) ${i.price ? `$${i.price}` : ""} ${i.status}`); }
  L.push("", "## What I'd like back", "1. A read on the current portfolio: concentration, risks, what's working.", `2. 3–5 options for the ${eur(p.cash)}, mixing kinds (e.g. a broad ETF, a sector/country the portfolio lacks, 1–2 individual growth stocks with a clear thesis). For each: why, pros, cons, main risk, fee cost in € and %, and Bankinter availability.`, "3. One or two stocks worth watching that aren't obvious yet, with the thesis and what would prove it wrong.", "4. Anything to avoid doing.");
  L.push("", `_Markets ref: ${Object.entries(MARKET_LABEL).map(([k, v]) => `${k} = ${v}`).join("; ")}_`);
  return L.join("\n");
}
