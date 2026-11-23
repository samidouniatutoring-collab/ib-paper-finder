import { h, toast, errorText } from "../ui";
import * as M from "./model";
import * as A from "./api";
import { buildPacket } from "./packet";

type Tab = "portfolio" | "invest" | "fees" | "calendar" | "news" | "watch" | "settings";
const TABS: [Tab, string][] = [["portfolio", "Portfolio"], ["invest", "Invest €X"], ["fees", "Fees"], ["calendar", "IPOs & earnings"], ["news", "News"], ["watch", "Watchlist"], ["settings", "Settings"]];

let S = M.load();
const tabOf = (): Tab => { const t = location.hash.slice(1) as Tab; return TABS.some(([k]) => k === t) ? t : "portfolio"; };
let tab: Tab = tabOf();
let eod: M.Eod = {};
let eodUpdated = "";
let live: Record<string, number> = {};
let liveChange: Record<string, number> = {};
let rates: M.Rates = { EUR: 1, USD: 1.08, GBP: 0.85, DKK: 7.46, CHF: 0.94 };
let filter = "all";
let lastRefresh = "";
let root: HTMLElement;
const persist = () => M.save(S);

const rowsFor = (acc = filter) => S.holdings.filter((x) => acc === "all" || x.accountId === acc).map((x) => M.valueHolding(x, live, rates, eod));
const sum = (r: M.Valued[], k: "value" | "cost") => r.reduce((a, x) => a + x[k], 0);
const num = (v: string) => Number(String(v).replace(",", "."));
const field = (label: string, input: HTMLElement, hint?: string) => h("label", { class: "field" }, label, input, hint ? h("span", { class: "small muted" }, hint) : null);
const cls = (n: number) => (n >= 0 ? "pos" : "neg");
/** Today's % change: live quote if available, else last vs previous daily close. */
function dayChange(x: M.Holding): number | undefined {
  if (x.quoteSymbol && liveChange[x.quoteSymbol] != null) return liveChange[x.quoteSymbol];
  const c = x.yahoo ? eod[x.yahoo]?.closes : undefined;
  return c && c.length >= 2 ? (c[c.length - 1][1] / c[c.length - 2][1] - 1) * 100 : undefined;
}

export function mount(el: HTMLElement): void {
  root = el;
  checkImport();
  window.addEventListener("hashchange", () => { if (!checkImport()) { tab = tabOf(); render(); } });
  render();
  void loadEod().then(() => refresh(true));
}
function checkImport(): boolean {
  const m = location.hash.match(/^#import=(.+)$/);
  if (!m) return false;
  try {
    const d = M.decodeImport(m[1]);
    if (confirm(`Load ${d.holdings.length} holdings into the Portfolio app${d.replace ? " (replacing those accounts)" : ""}?`)) { S = M.applyImport(S, d); persist(); toast(`Loaded ${d.holdings.length} holdings`); }
  } catch { toast("That import link is broken", true); }
  history.replaceState(null, "", location.pathname + "#portfolio"); tab = "portfolio"; render();
  return true;
}
async function loadEod(): Promise<void> {
  try { const r = await fetch(`${import.meta.env.BASE_URL}data/prices.json`, { cache: "no-cache" }); if (r.ok) { const j = await r.json(); eod = j.symbols || {}; eodUpdated = j.updated || ""; } } catch { /* offline */ }
}

function render(): void {
  const nav = h("nav", { class: "tabs" }, ...TABS.map(([k, l]) => h("a", { href: `#${k}`, class: k === tab ? "active" : "" }, l)));
  const body = h("div", {});
  ({ portfolio, invest, fees, calendar, news, watch, settings } as Record<Tab, (b: HTMLElement) => void>)[tab](body);
  root.replaceChildren(nav, body);
}

// ---------------- refresh ----------------
async function refresh(quiet = false): Promise<void> {
  try {
    rates = await A.fxRates().catch(() => rates);
    if (!quiet) await loadEod();
    if (!S.finnhubKey) { snapshot(); render(); return; }
    const syms = [...S.holdings.map((x) => x.quoteSymbol), ...S.watch.map((w) => w.symbol), "SPY"];
    const q = await A.quotes(S.finnhubKey, syms);
    live = Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v.c]));
    liveChange = Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v.dp]));
    // fill sector/country once per US symbol
    for (const x of S.holdings) if (x.quoteSymbol && (!x.sector || !x.country)) {
      try { const p = await A.profile(S.finnhubKey, x.quoteSymbol); if (p.finnhubIndustry) x.sector = x.sector || p.finnhubIndustry; if (p.country) x.country = x.country || p.country; if (p.name && x.name === x.ticker) x.name = p.name; } catch { /* skip */ }
    }
    snapshot();
    lastRefresh = new Date().toLocaleTimeString();
    const hits = S.watch.filter((w) => live[w.symbol] && ((w.above && live[w.symbol] >= w.above) || (w.below && live[w.symbol] <= w.below)));
    if (hits.length) toast(`Price alert: ${hits.map((w) => w.symbol).join(", ")}`);
    render();
  } catch (e) { toast(errorText(e), true); }
}

function snapshot(): void {
  const all = rowsFor("all"); if (!all.length) return;
  const today = new Date().toISOString().slice(0, 10);
  const accounts = Object.fromEntries(S.accounts.map((a) => { const r = rowsFor(a.id); return [a.id, { value: sum(r, "value"), cost: sum(r, "cost") }]; }));
  const spy = live.SPY ?? eod.SPY?.last;
  S.history = [...S.history.filter((x) => x.date !== today), { date: today, value: sum(all, "value"), cost: sum(all, "cost"), spy, accounts }].slice(-2000);
  persist();
}

// ---------------- Portfolio ----------------
function portfolio(b: HTMLElement): void {
  const rows = rowsFor();
  const value = sum(rows, "value"), cost = sum(rows, "cost");
  const bf = M.backfill(rows, eod, rates);
  const myRet = bf ? bf.mine[bf.mine.length - 1] : NaN, spyRet = bf ? bf.bench[bf.bench.length - 1] : NaN;
  const accSel = h("select", { onchange: (e: Event) => { filter = (e.target as HTMLSelectElement).value; render(); } },
    h("option", { value: "all", selected: filter === "all" }, "All accounts"), ...S.accounts.map((a) => h("option", { value: a.id, selected: filter === a.id }, a.name)));
  b.append(
    h("div", { class: "row spread" }, accSel,
      h("div", { class: "row" }, h("span", { class: "small muted" }, [eodUpdated ? `Closing prices: ${new Date(eodUpdated).toLocaleDateString()}` : "", lastRefresh ? `Live: ${lastRefresh}` : ""].filter(Boolean).join(" · ")),
        h("button", { class: "btn btn-small", onclick: (e: Event) => { (e.target as HTMLButtonElement).disabled = true; void refresh(); } }, "Refresh prices"))),
    h("div", { class: "kpis" },
      kpi("Value", M.eur(value)), kpi("Cost", M.eur(cost)), kpi("Profit / loss", `${M.eur(value - cost)} (${M.pct(cost ? (value - cost) / cost : 0)})`, value - cost),
      kpi("12 months: you vs S&P 500", isFinite(myRet) ? `${M.pct(myRet)} vs ${M.pct(spyRet)}` : "building up: ~2 weeks of daily prices", isFinite(myRet) ? myRet - spyRet : undefined),
      kpi("Custody / year", M.eur(rows.length ? M.yearlyCustody(rows, S.accounts) : 0))),
  );
  const w = M.warnings(rows);
  if (w.length) b.append(h("div", { class: "card notice warnbox" }, h("strong", {}, "Concentration warnings"), h("ul", {}, ...w.map((x) => h("li", {}, x)))));
  if (!S.holdings.length) b.append(h("div", { class: "card notice" }, "No holdings yet. Add them below (copy shares and average price from the Bankinter app: Bróker → Mi cartera), or paste a CSV."));
  else b.append(h("div", { class: "card", style: "overflow-x:auto" }, holdingsTable(rows, value)));
  if (rows.length) b.append(h("div", { class: "grid3" }, bars("By sector", M.breakdown(rows, (r) => r.h.sector || "")), bars("By country", M.breakdown(rows, (r) => r.h.country || "")), bars("By currency", M.breakdown(rows, (r) => r.h.currency))));
  if (bf) b.append(h("div", { class: "card" }, h("h2", {}, "Your current holdings vs the S&P 500, last 12 months"), chart(bf), h("p", { class: "small muted" }, "Replays the stocks you hold today with daily closing prices (ignores when you actually bought or sold).", bf.missing.length ? ` No price history for: ${bf.missing.join(", ")}.` : "")));
  b.append(holdingForm(), csvCard());
}
function kpi(label: string, v: string, sign?: number) { return h("div", { class: "kpi" }, h("div", { class: "small muted" }, label), h("div", { class: `kpi-v ${sign == null ? "" : cls(sign)}` }, v)); }
function holdingsTable(rows: M.Valued[], total: number): HTMLElement {
  return h("table", { class: "progress-table" },
    h("thead", {}, h("tr", {}, ...["Stock", "Account", "Shares", "Avg cost", "Price", "Today", "Value", "Weight", "P/L", ""].map((x) => h("th", {}, x)))),
    h("tbody", {}, ...[...rows].sort((a, b) => b.value - a.value).map((r) => h("tr", {},
      h("td", {}, h("strong", {}, r.h.ticker), h("div", { class: "small muted" }, r.h.name !== r.h.ticker ? r.h.name : "", r.h.sector ? ` · ${r.h.sector}` : "")),
      h("td", { class: "small" }, S.accounts.find((a) => a.id === r.h.accountId)?.name ?? ""),
      h("td", {}, r.h.shares), h("td", {}, `${r.h.avgCost.toFixed(2)} ${r.h.currency}`),
      h("td", {}, r.price == null ? h("span", { class: "badge badge-warn" }, "no price") : `${r.price.toFixed(2)} ${r.h.currency}`, r.priceSource === "manual" ? h("span", { class: "badge badge-muted", title: `Entered ${r.h.manualAt ?? ""}` }, "manual") : r.priceSource === "eod" ? h("span", { class: "badge badge-muted", title: "Closing price" }, (r.priceDate ?? "").slice(5)) : r.priceSource === "live" ? h("span", { class: "badge badge-ok" }, "live") : null),
      h("td", { class: cls(dayChange(r.h) ?? 0) }, dayChange(r.h) != null ? `${(dayChange(r.h) as number).toFixed(2)}%` : ""),
      h("td", {}, M.eur(r.value)), h("td", {}, `${((r.value / (total || 1)) * 100).toFixed(1)}%`),
      h("td", { class: cls(r.pl) }, `${M.pct(r.plPct)}`),
      h("td", {}, h("button", { class: "btn btn-ghost btn-small", onclick: () => editHolding(r.h) }, "Edit"))))));
}
function bars(title: string, s: M.Slice[]): HTMLElement {
  return h("div", { class: "card" }, h("h2", {}, title), ...s.slice(0, 10).map((x) => h("div", { class: "bar" },
    h("span", { class: "bar-l small" }, x.key), h("span", { class: "bar-t" }, h("span", { class: `bar-f${x.pct > 0.25 ? " hot" : ""}`, style: `width:${(x.pct * 100).toFixed(1)}%` })), h("span", { class: "small" }, `${(x.pct * 100).toFixed(0)}%`))));
}
function chart(bf: NonNullable<ReturnType<typeof M.backfill>>): SVGElement {
  const pts = bf.dates.map((date) => ({ date }));
  const W = 640, H = 200, P = 30;
  const my = bf.mine, sp = bf.bench;
  const lo = Math.min(0, ...my, ...sp), hi = Math.max(0, ...my, ...sp) || 0.01;
  const X = (i: number) => P + (i / Math.max(1, pts.length - 1)) * (W - 2 * P);
  const Y = (v: number) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
  const path = (a: number[]) => a.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "chart");
  svg.innerHTML = `<line x1="${P}" x2="${W - P}" y1="${Y(0)}" y2="${Y(0)}" stroke="#ccc" stroke-dasharray="3 3"/>
    <path d="${path(sp)}" fill="none" stroke="#9ca3af" stroke-width="2"/><path d="${path(my)}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
    <text x="${P}" y="14" font-size="11" fill="var(--accent)">You ${M.pct(my[my.length - 1])}</text><text x="${P + 110}" y="14" font-size="11" fill="#6b7280">S&amp;P 500 ${M.pct(sp[sp.length - 1])}</text>
    <text x="${P}" y="${H - 8}" font-size="10" fill="#6b7280">${pts[0].date}</text><text x="${W - P}" y="${H - 8}" font-size="10" fill="#6b7280" text-anchor="end">${pts[pts.length - 1].date}</text>`;
  return svg;
}

function holdingForm(x?: M.Holding): HTMLElement {
  const v = x ?? { id: "", accountId: filter !== "all" ? filter : S.accounts[0]?.id, ticker: "", name: "", market: "us", currency: "USD", shares: 0, avgCost: 0, quoteSymbol: "", quoteCurrency: "USD", quoteRatio: 1 } as M.Holding;
  const i = (val: unknown, type = "text", attrs: Record<string, unknown> = {}) => h("input", { type, value: val ?? "", ...attrs });
  const f = {
    acc: h("select", {}, ...S.accounts.map((a) => h("option", { value: a.id, selected: a.id === v.accountId }, a.name))),
    ticker: i(v.ticker, "text", { placeholder: "AMD" }), name: i(v.name, "text", { placeholder: "Advanced Micro Devices" }),
    market: h("select", {}, ...(Object.keys(M.MARKET_LABEL) as M.Market[]).map((k) => h("option", { value: k, selected: k === v.market }, M.MARKET_LABEL[k]))),
    cur: i(v.currency, "text", { placeholder: "USD / EUR / GBP / DKK" }), shares: i(v.shares || "", "number", { step: "any" }), avg: i(v.avgCost || "", "number", { step: "any" }),
    qs: i(v.quoteSymbol, "text", { placeholder: "e.g. AMD, or ASML / NVO for the US listing" }), qc: i(v.quoteCurrency, "text"), qr: i(v.quoteRatio, "number", { step: "any" }),
    mp: i(v.manualPrice ?? "", "number", { step: "any" }), sector: i(v.sector ?? ""), yahoo: i(v.yahoo ?? "", "text", { placeholder: "AMD, ASML.AS, FRES.L, CLNX.MC, SU.PA…" }), plan: h("input", { type: "checkbox", checked: !!v.plan }), country: i(v.country ?? "", "text", { placeholder: "US, NL, FR, ES…" }),
  };
  const saveIt = () => {
    const t = (f.ticker as HTMLInputElement).value.trim().toUpperCase();
    if (!t) return toast("Ticker needed", true);
    const n: M.Holding = { ...v, id: v.id || M.newId(), accountId: (f.acc as HTMLSelectElement).value, ticker: t, name: (f.name as HTMLInputElement).value.trim() || t,
      market: (f.market as HTMLSelectElement).value as M.Market, currency: (f.cur as HTMLInputElement).value.trim().toUpperCase() || "USD",
      shares: num((f.shares as HTMLInputElement).value), avgCost: num((f.avg as HTMLInputElement).value),
      quoteSymbol: (f.qs as HTMLInputElement).value.trim().toUpperCase(), quoteCurrency: (f.qc as HTMLInputElement).value.trim().toUpperCase() || "USD", quoteRatio: num((f.qr as HTMLInputElement).value) || 1,
      sector: (f.sector as HTMLInputElement).value.trim() || undefined, country: (f.country as HTMLInputElement).value.trim() || undefined,
      yahoo: (f.yahoo as HTMLInputElement).value.trim().toUpperCase() || M.yahooGuess(t, (f.market as HTMLSelectElement).value as M.Market) || undefined, plan: (f.plan as HTMLInputElement).checked };
    const mp = num((f.mp as HTMLInputElement).value);
    if (mp && mp !== v.manualPrice) { n.manualPrice = mp; n.manualAt = new Date().toISOString().slice(0, 10); } else if (!mp) { delete n.manualPrice; delete n.manualAt; }
    S.holdings = [...S.holdings.filter((y) => y.id !== n.id), n]; persist(); toast("Saved"); render();
  };
  const del = x ? h("button", { class: "btn btn-danger", onclick: () => { if (confirm(`Remove ${x.ticker}?`)) { S.holdings = S.holdings.filter((y) => y.id !== x.id); persist(); render(); } } }, "Remove") : null;
  const card = h("details", { class: "card", open: !!x }, h("summary", {}, h("strong", {}, x ? `Edit ${x.ticker}` : "Add a holding")),
    h("div", { class: "form-grid" }, field("Account", f.acc), field("Ticker", f.ticker), field("Name", f.name), field("Market (sets the fee)", f.market),
      field("Currency you paid in", f.cur), field("Shares", f.shares), field("Average cost per share", f.avg, "In that currency, as Bankinter shows it")),
    h("h3", {}, "Price"),
    h("div", { class: "form-grid" }, field("Closing-price symbol", f.yahoo, "Updated every weekday evening for any market. US: ticker. Madrid .MC · London .L · Paris .PA · Amsterdam .AS · Frankfurt .DE · Copenhagen .CO · Toronto .TO. New symbols are added to the daily list by Claude."),
      field("Live price symbol (US listing)", f.qs, "Free Finnhub = US listings only. European stocks with a US listing (ASML, NVO, BHP) can use it; leave blank to type prices yourself."),
      field("Live price currency", f.qc), field("Shares per US listing unit", f.qr, "1 for most. BHP's US listing = 2 shares."), field("Or type the price yourself", f.mp, "Use for European/UK-only stocks; refresh it weekly.")),
    h("h3", {}, "Optional"), h("div", { class: "form-grid" }, field("Sector", f.sector, "Filled automatically for US symbols"), field("Country", f.country), h("label", { class: "check" }, f.plan, "ETF on Bankinter 'compra periódica' (no 6€ custody minimum)")),
    h("div", { class: "row" }, h("button", { class: "btn", onclick: saveIt }, "Save"), del));
  return card;
}
function editHolding(x: M.Holding): void { const f = holdingForm(x); root.querySelector("details.card")?.replaceWith(f); f.scrollIntoView({ behavior: "smooth" }); }
function csvCard(): HTMLElement {
  const ta = h("textarea", { rows: 5, placeholder: "ticker,shares,avgCost,currency,market,quoteSymbol,name\nAMD,10,95.20,USD,us\nASML,2,610,EUR,eu,ASML\nCLNX,40,33.1,EUR,es,,Cellnex" });
  const acc = h("select", {}, ...S.accounts.map((a) => h("option", { value: a.id }, a.name)));
  return h("details", { class: "card" }, h("summary", {}, h("strong", {}, "Paste many at once (CSV)")),
    h("div", { class: "stack" }, field("Into account", acc), ta,
      h("button", { class: "btn btn-secondary", onclick: () => { const n = M.parseCsv((ta as HTMLTextAreaElement).value, (acc as HTMLSelectElement).value); if (!n.length) return toast("Nothing recognised", true); S.holdings.push(...n); persist(); toast(`Added ${n.length}`); render(); } }, "Import")));
}

// ---------------- Invest €X ----------------
function invest(b: HTMLElement): void {
  const cash = h("input", { type: "number", value: 500, step: "any" });
  const acc = h("select", {}, ...S.accounts.map((a) => h("option", { value: a.id, selected: a.id === "mine" }, a.name)));
  const scope = h("select", {}, h("option", { value: "all" }, "All portfolios together"), ...S.accounts.map((a) => h("option", { value: a.id }, `${a.name} only`)));
  const ideas = h("textarea", { rows: 3, placeholder: "Optional: anything you're thinking about (a stock you heard of, a sector, 'I want less in chips'…)" });
  const out = h("div", { class: "stack" });
  const go = async (btn: HTMLButtonElement) => {
    btn.disabled = true; out.replaceChildren(h("p", { class: "muted" }, "Collecting prices, news, IPOs and earnings… (about 30 s)"));
    try {
      if (S.finnhubKey) await refresh(true);
      const sc = (scope as HTMLSelectElement).value;
      const rows = rowsFor(sc);
      const news: Record<string, A.NewsItem[]> = {};
      let market: A.NewsItem[] = [], ipos: A.Ipo[] = [], earn: A.Earning[] = [];
      if (S.finnhubKey) {
        const top = [...rows].sort((a, z) => z.value - a.value).map((r) => r.h.quoteSymbol).filter(Boolean).slice(0, 10);
        for (const s of top) { try { news[s] = (await A.companyNews(S.finnhubKey, s)).slice(0, 3); } catch { /* skip */ } }
        market = await A.marketNews(S.finnhubKey).catch(() => []);
        ipos = await A.ipoCalendar(S.finnhubKey).catch(() => []);
        earn = await A.earnings(S.finnhubKey).catch(() => []);
      }
      const bf = M.backfill(rows, eod, rates);
      const md = buildPacket({ state: S, rows, scope: sc === "all" ? "All portfolios" : `${S.accounts.find((a) => a.id === sc)?.name} only`, cash: num((cash as HTMLInputElement).value), accountId: (acc as HTMLSelectElement).value, ideas: (ideas as HTMLTextAreaElement).value, news, market, ipos, earnings: earn,
        myReturn: bf ? bf.mine[bf.mine.length - 1] : undefined, spyReturn: bf ? bf.bench[bf.bench.length - 1] : undefined });
      const name = `Portfolio_packet_${new Date().toISOString().slice(0, 10)}.md`;
      out.replaceChildren(
        h("div", { class: "card notice stack" }, h("strong", {}, "Packet ready"), h("span", {}, "Download it (or copy it) and send it to Claude in your finance chat. It uses your normal Claude plan, no extra cost."),
          h("div", { class: "row" },
            h("button", { class: "btn", onclick: () => { const a = h("a", { href: URL.createObjectURL(new Blob([md], { type: "text/markdown" })), download: name }); a.click(); } }, "Download packet"),
            h("button", { class: "btn btn-secondary", onclick: async () => { await navigator.clipboard.writeText(md); toast("Copied"); } }, "Copy"),
            h("a", { class: "btn btn-secondary", href: "https://claude.ai/new", target: "_blank", rel: "noopener" }, "Open Claude ↗"))),
        h("pre", { class: "card packet" }, md));
    } catch (e) { out.replaceChildren(h("p", { class: "neg" }, errorText(e))); }
    btn.disabled = false;
  };
  b.append(h("div", { class: "card stack" }, h("h2", {}, "I have money to invest"),
    h("p", { class: "small muted" }, "The app gathers your portfolio, concentration, fees, news on your stocks, upcoming earnings and IPOs into one file. Claude then gives you 3–5 options with pros, cons and fee cost. You decide."),
    h("div", { class: "form-grid" }, field("Amount (€)", cash), field("Into account", acc), field("Analyse", scope, "Your own portfolio, your parents', or both")), field("Your ideas (optional)", ideas),
    h("button", { class: "btn", onclick: (e: Event) => void go(e.target as HTMLButtonElement) }, "Build packet")), out);
}

// ---------------- Fees ----------------
function fees(b: HTMLElement): void {
  const acc = h("select", {}, ...S.accounts.map((a) => h("option", { value: a.id }, a.name)));
  const market = h("select", {}, ...(Object.keys(M.MARKET_LABEL) as M.Market[]).map((k) => h("option", { value: k, selected: k === "us" }, M.MARKET_LABEL[k])));
  const amt = h("input", { type: "number", value: 1000, step: "any" });
  const country = h("input", { placeholder: "FR, IT, ES… (for Tobin tax)" });
  const promo = h("input", { type: "checkbox" });
  const etf = h("input", { type: "checkbox" });
  const out = h("div", {});
  const calc = () => {
    const a = S.accounts.find((x) => x.id === (acc as HTMLSelectElement).value) as M.Account;
    const m = (market as HTMLSelectElement).value as M.Market; const x = num((amt as HTMLInputElement).value);
    const isEtf = (etf as HTMLInputElement).checked;
    const fee = M.tradeFee(a, m, x, (promo as HTMLInputElement).checked); const buyFee = isEtf ? 0 : fee; const tax = isEtf ? 0 : M.buyTax((country as HTMLInputElement).value, m, x);
    const cust = M.custodyQuarter(a, m, x, isEtf) * 4;
    out.replaceChildren(h("table", { class: "progress-table" },
      h("tr", {}, h("td", {}, "Commission to buy"), h("td", {}, `${M.eur(buyFee)} (${((buyFee / x) * 100).toFixed(2)}%)`)),
      h("tr", {}, h("td", {}, "Commission to sell"), h("td", {}, `${M.eur(fee)} (${((fee / x) * 100).toFixed(2)}%)`)),
      h("tr", {}, h("td", {}, "Tobin tax (buying only)"), h("td", {}, M.eur(tax))),
      h("tr", {}, h("td", {}, h("strong", {}, "Buy now + sell later")), h("td", {}, h("strong", {}, `${M.eur(buyFee + fee + tax)} (${(((buyFee + fee + tax) / x) * 100).toFixed(2)}%)`))),
      h("tr", {}, h("td", {}, "Custody per year for this stock"), h("td", {}, `${M.eur(cust)} (${((cust / x) * 100).toFixed(2)}%/yr)`)),
      h("tr", {}, h("td", { class: "small muted", colspan: 2 }, "Plus Bankinter's margin when converting € ↔ $ / £ (not published). Spanish stocks with Bróker Cero: 0€ commission."))));
  };
  [acc, market, amt, country, promo, etf].forEach((e) => e.addEventListener("input", calc)); calc();
  const intl = [100, 250, 500, 1000, 2500, 5000, 10000].map((x) => h("tr", {}, h("td", {}, M.eur(x)), h("td", {}, `${((20 / x) * 100).toFixed(1)}%`), h("td", {}, `${((40 / x) * 100).toFixed(1)}%`), h("td", {}, `${((Math.max(6, x * 0.0005) * 4 / x) * 100).toFixed(2)}%`)));
  const all = rowsFor("all");
  const sellAll = all.reduce((t, r) => { const a = S.accounts.find((z) => z.id === r.h.accountId) as M.Account; return t + M.tradeFee(a, r.h.market, r.value); }, 0);
  const rebuy = all.reduce((t, r) => { const a = S.accounts.find((z) => z.id === "mine") ?? S.accounts[0]; return t + M.tradeFee(a, r.h.market, r.value) + M.buyTax(r.h.country, r.h.market, r.value); }, 0);
  b.append(
    h("div", { class: "card stack" }, h("h2", {}, "Fee calculator (Bankinter tariff)"),
      h("div", { class: "form-grid" }, field("Account", acc), field("Market", market), field("Amount (€)", amt), field("Company country", country)),
      h("label", { class: "check" }, promo, "Free-trading promo day (Bróker Cero only: Black Friday, Cyber Monday, debut days…)"),
      h("label", { class: "check" }, etf, "Promoted ETF bought with 'compra periódica' (0€ to buy, no 6€ custody minimum)"), out),
    h("div", { class: "card" }, h("h2", {}, "Why small international buys hurt"),
      h("table", { class: "progress-table" }, h("thead", {}, h("tr", {}, ...["Buy size", "Fee to buy (20€)", "Buy + sell", "Custody per year"].map((x) => h("th", {}, x)))), h("tbody", {}, ...intl)),
      h("p", { class: "small muted" }, "Custody is 0.05% a quarter per international stock but at least 6€ per stock, so a 500€ position pays 24€ a year (4.8%). Fewer, bigger positions at Bankinter; small monthly buys are cheaper at a low-cost broker.")),
    all.length ? h("div", { class: "card" }, h("h2", {}, "Sell everything and rebuy in my account"),
      h("p", {}, `Selling all ${all.length} positions: ${M.eur(sellAll)} · Rebuying them: ${M.eur(rebuy)} · `, h("strong", {}, `Total ≈ ${M.eur(sellAll + rebuy)}`), ` (${((sellAll + rebuy) / (sum(all, "value") || 1) * 100).toFixed(1)}% of the portfolio), plus currency margin. On a Bróker Cero promo day the commissions drop to about 0€.`)) : "");
}

// ---------------- Calendar ----------------
function calendar(b: HTMLElement): void {
  const box = h("div", {}, h("p", { class: "muted" }, "Loading…")); b.append(box);
  if (!S.finnhubKey) { box.replaceChildren(h("p", {}, "Add your Finnhub key in Settings.")); return; }
  void (async () => {
    try {
      const [ipos, earn] = await Promise.all([A.ipoCalendar(S.finnhubKey), A.earnings(S.finnhubKey)]);
      const mine = new Set([...S.holdings.map((x) => x.quoteSymbol || x.ticker), ...S.watch.map((w) => w.symbol)]);
      const myEarn = earn.filter((e) => mine.has(e.symbol)).sort((a, z) => a.date.localeCompare(z.date));
      box.replaceChildren(
        h("div", { class: "card" }, h("h2", {}, "Earnings: your stocks and watchlist (next 30 days)"),
          myEarn.length ? h("table", { class: "progress-table" }, ...myEarn.map((e) => h("tr", {}, h("td", {}, e.date), h("td", {}, h("strong", {}, e.symbol)), h("td", { class: "small muted" }, e.hour === "bmo" ? "before open" : e.hour === "amc" ? "after close" : ""), h("td", {}, e.epsEstimate != null ? `EPS est. ${e.epsEstimate}` : "")))) : h("p", { class: "muted" }, "None in the next 30 days.")),
        h("div", { class: "card" }, h("h2", {}, "IPO calendar (US, next 45 days)"),
          ipos.length ? h("table", { class: "progress-table" }, h("thead", {}, h("tr", {}, ...["Date", "Company", "Ticker", "Exchange", "Price", "Size", "Status"].map((x) => h("th", {}, x)))),
            h("tbody", {}, ...ipos.map((i) => h("tr", {}, h("td", {}, i.date), h("td", {}, i.name), h("td", {}, i.symbol || "–"), h("td", {}, i.exchange || ""), h("td", {}, i.price ? `$${i.price}` : ""), h("td", {}, i.totalSharesValue ? `$${(i.totalSharesValue / 1e6).toFixed(0)}M` : ""), h("td", {}, h("span", { class: "badge" }, i.status)))))) : h("p", { class: "muted" }, "No IPOs listed."),
          h("p", { class: "small muted" }, "Bankinter retail clients usually buy on the first trading day at market price, not at the IPO price. Watch Bankinter's blog for free-commission debut days.")));
    } catch (e) { box.replaceChildren(h("p", { class: "neg" }, errorText(e))); }
  })();
}

// ---------------- News ----------------
function news(b: HTMLElement): void {
  const box = h("div", {}, h("p", { class: "muted" }, "Loading…")); b.append(box);
  if (!S.finnhubKey) { box.replaceChildren(h("p", {}, "Add your Finnhub key in Settings.")); return; }
  const item = (n: A.NewsItem) => h("li", {}, h("a", { href: n.url, target: "_blank", rel: "noopener" }, n.headline), h("span", { class: "small muted" }, ` · ${n.source} · ${new Date(n.datetime * 1000).toLocaleDateString()}`));
  void (async () => {
    try {
      const syms = [...new Set(S.holdings.map((x) => x.quoteSymbol).filter(Boolean))].slice(0, 15);
      const per: [string, A.NewsItem[]][] = [];
      for (const s of syms) per.push([s, (await A.companyNews(S.finnhubKey, s).catch(() => [])).slice(0, 4)]);
      const mk = await A.marketNews(S.finnhubKey);
      box.replaceChildren(
        h("div", { class: "card" }, h("h2", {}, "Your stocks"), ...per.filter(([, n]) => n.length).map(([s, n]) => h("div", {}, h("h3", {}, s), h("ul", {}, ...n.map(item))))),
        h("div", { class: "card" }, h("h2", {}, "Markets"), h("ul", {}, ...mk.slice(0, 20).map(item))));
    } catch (e) { box.replaceChildren(h("p", { class: "neg" }, errorText(e))); }
  })();
}

// ---------------- Watchlist ----------------
function watch(b: HTMLElement): void {
  const sym = h("input", { placeholder: "Ticker (US), e.g. PLTR" }), above = h("input", { type: "number", step: "any", placeholder: "Alert above" }), below = h("input", { type: "number", step: "any", placeholder: "Alert below" }), note = h("input", { placeholder: "Why you're watching it" });
  b.append(h("div", { class: "card stack" }, h("h2", {}, "Watchlist"),
    h("div", { class: "form-grid" }, field("Ticker", sym), field("Alert above $", above), field("Alert below $", below), field("Note", note)),
    h("button", { class: "btn", onclick: () => { const s = (sym as HTMLInputElement).value.trim().toUpperCase(); if (!s) return; S.watch = [...S.watch.filter((w) => w.symbol !== s), { symbol: s, above: num((above as HTMLInputElement).value) || undefined, below: num((below as HTMLInputElement).value) || undefined, note: (note as HTMLInputElement).value.trim() || undefined }]; persist(); void refresh(true); render(); } }, "Add"),
    S.watch.length ? h("table", { class: "progress-table" }, ...S.watch.map((w) => { const p = live[w.symbol]; const hit = p && ((w.above && p >= w.above) || (w.below && p <= w.below));
      return h("tr", {}, h("td", {}, h("strong", {}, w.symbol), hit ? h("span", { class: "badge badge-warn" }, "alert") : null), h("td", {}, p ? `$${p.toFixed(2)}` : "–"), h("td", { class: cls(liveChange[w.symbol] ?? 0) }, liveChange[w.symbol] != null ? `${liveChange[w.symbol].toFixed(2)}%` : ""),
        h("td", { class: "small" }, [w.above ? `↑ ${w.above}` : "", w.below ? `↓ ${w.below}` : ""].filter(Boolean).join(" · ")), h("td", { class: "small muted" }, w.note ?? ""),
        h("td", {}, h("button", { class: "btn btn-ghost btn-small", onclick: () => { S.watch = S.watch.filter((x) => x !== w); persist(); render(); } }, "Remove"))); })) : h("p", { class: "muted" }, "Nothing yet."),
    h("p", { class: "small muted" }, "Alerts are checked whenever you open the app or press Refresh.")));
}

// ---------------- Settings ----------------
function settings(b: HTMLElement): void {
  const key = h("input", { type: "password", value: S.finnhubKey, placeholder: "Finnhub API key", autocomplete: "off" });
  const goal = h("input", { value: S.profile.goal }), hor = h("input", { value: S.profile.horizon }), mon = h("input", { type: "number", value: S.profile.monthly }), notes = h("textarea", { rows: 3, value: S.profile.notes, placeholder: "Anything Claude should always know (e.g. no tobacco/weapons, prefer dividends…)" });
  b.append(
    h("div", { class: "card stack" }, h("h2", {}, "Finnhub key"), field("Key", key, "Free at finnhub.io → Get free API key. Stored only in this browser; never sent anywhere except Finnhub."),
      h("button", { class: "btn", onclick: () => { S.finnhubKey = (key as HTMLInputElement).value.trim(); persist(); toast("Saved"); void refresh(); } }, "Save key")),
    h("div", { class: "card stack" }, h("h2", {}, "Your investing profile (goes into every packet)"),
      h("div", { class: "form-grid" }, field("Goal", goal), field("Horizon", hor), field("Monthly top-up (€)", mon)), field("Standing notes", notes),
      h("button", { class: "btn", onclick: () => { S.profile = { goal: (goal as HTMLInputElement).value, horizon: (hor as HTMLInputElement).value, monthly: num((mon as HTMLInputElement).value), notes: (notes as HTMLTextAreaElement).value }; persist(); toast("Saved"); } }, "Save profile")),
    h("div", { class: "card stack" }, h("h2", {}, "Accounts"), ...S.accounts.map(accountRow),
      h("button", { class: "btn btn-secondary", onclick: () => { S.accounts.push({ id: M.newId(), name: "New account", broker: "other", brokerCero: false, otherFee: 1 }); persist(); render(); } }, "Add account")),
    h("div", { class: "card stack" }, h("h2", {}, "Backup"), h("p", { class: "small muted" }, "Everything lives in this browser. Download a backup now and then (and to move to another device)."),
      h("div", { class: "row" },
        h("button", { class: "btn btn-secondary", onclick: () => { const { finnhubKey: _k, ...rest } = S; const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(rest, null, 1)], { type: "application/json" })), download: `portfolio-backup-${new Date().toISOString().slice(0, 10)}.json` }); a.click(); } }, "Download backup"),
        h("label", { class: "btn btn-secondary" }, "Restore backup", h("input", { type: "file", accept: ".json", style: "display:none", onchange: async (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; try { const d = JSON.parse(await f.text()); S = { ...M.defaultState(), ...d, finnhubKey: S.finnhubKey }; persist(); toast("Restored"); render(); } catch { toast("Not a valid backup", true); } } })))));
}
function accountRow(a: M.Account): HTMLElement {
  const name = h("input", { value: a.name }); const broker = h("select", {}, h("option", { value: "bankinter", selected: a.broker === "bankinter" }, "Bankinter"), h("option", { value: "other", selected: a.broker === "other" }, "Other broker (flat fee)"));
  const cero = h("input", { type: "checkbox", checked: a.brokerCero }); const fee = h("input", { type: "number", step: "any", value: a.otherFee });
  return h("div", { class: "form-grid acc" }, field("Name", name), field("Broker", broker), field("Fee per trade (other broker)", fee), h("label", { class: "check" }, cero, "Bróker Cero"),
    h("div", { class: "row" }, h("button", { class: "btn btn-small", onclick: () => { Object.assign(a, { name: (name as HTMLInputElement).value, broker: (broker as HTMLSelectElement).value, brokerCero: (cero as HTMLInputElement).checked, otherFee: num((fee as HTMLInputElement).value) }); persist(); toast("Saved"); } }, "Save"),
      h("button", { class: "btn btn-ghost btn-small", onclick: () => { if (S.holdings.some((x) => x.accountId === a.id)) return toast("Move or remove its holdings first", true); S.accounts = S.accounts.filter((x) => x !== a); persist(); render(); } }, "Delete")));
}
