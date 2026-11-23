import { describe, expect, it } from "vitest";
import * as M from "../src/stocks/model";

const bk: M.Account = { id: "a", name: "B", broker: "bankinter", brokerCero: false, otherFee: 0 };
const cero: M.Account = { ...bk, brokerCero: true };
const other: M.Account = { ...bk, broker: "other", otherFee: 1 };

describe("Bankinter fees", () => {
  it("national tiers", () => {
    expect(M.tradeFee(bk, "es", 1500)).toBe(3.95);
    expect(M.tradeFee(bk, "es", 5000)).toBe(8);
    expect(M.tradeFee(bk, "es", 100000)).toBeCloseTo(70);
    expect(M.tradeFee(bk, "es", 1e6)).toBe(200);
    expect(M.tradeFee(cero, "es", 5000)).toBe(0);
  });
  it("international flat 20 then 0.20%", () => {
    expect(M.tradeFee(bk, "us", 100)).toBe(20);
    expect(M.tradeFee(bk, "eu", 39999)).toBe(20);
    expect(M.tradeFee(bk, "us", 50000)).toBeCloseTo(100);
    expect(M.tradeFee(cero, "us", 1000, true)).toBe(0);
    expect(M.tradeFee(bk, "us", 1000, true)).toBe(20);
    expect(M.tradeFee(other, "us", 1000)).toBe(1);
  });
  it("custody minimum 6 per stock per quarter", () => {
    expect(M.custodyQuarter(bk, "us", 500)).toBe(6);
    expect(M.custodyQuarter(bk, "us", 40000)).toBeCloseTo(20);
    expect(M.custodyQuarter(bk, "es", 40000)).toBeCloseTo(16);
    expect(M.custodyQuarter(other, "us", 40000)).toBe(0);
  });
  it("buy taxes", () => {
    expect(M.buyTax(undefined, "es", 1000)).toBeCloseTo(2);
    expect(M.buyTax("FR", "eu", 1000)).toBeCloseTo(4);
    expect(M.buyTax("US", "us", 1000)).toBe(0);
  });
});

describe("valuation & analysis", () => {
  const rates = { EUR: 1, USD: 1.1 };
  const mk = (t: string, sh: number, avg: number, sector: string, cur = "USD"): M.Holding => ({ id: t, accountId: "a", ticker: t, name: t, market: "us", currency: cur, shares: sh, avgCost: avg, quoteSymbol: t, quoteCurrency: "USD", quoteRatio: 1, sector });
  it("values live USD holding in EUR", () => {
    const v = M.valueHolding(mk("AMD", 10, 100, "Semis"), { AMD: 110 }, rates);
    expect(v.value).toBeCloseTo(1000);
    expect(v.cost).toBeCloseTo(909.09, 1);
    expect(v.plPct).toBeCloseTo(0.1);
  });
  it("ADR ratio and currency conversion", () => {
    const h = { ...mk("BHP", 10, 20, "Mining", "EUR"), quoteRatio: 0.5 };
    const v = M.valueHolding(h, { BHP: 44 }, rates); // 44$ * .5 = 22$ = 20€
    expect(v.price).toBeCloseTo(20);
  });
  it("warns about concentration", () => {
    const rows = [mk("A", 1, 70, "Semis"), mk("B", 1, 30, "Mining")].map((h) => M.valueHolding(h, { A: 70, B: 30 }, rates));
    const w = M.warnings(rows).join(" ");
    expect(w).toContain("A is 70.0%");
    expect(w).toContain("Semis");
    expect(M.yearlyCustody(rows, [bk])).toBeCloseTo(48);
  });
  it("parses CSV", () => {
    const r = M.parseCsv("ticker,shares,avgCost,currency,market\nAMD,10,95.2,USD,us\nCLNX;40;33,1;EUR;es", "a");
    expect(r.length).toBe(2);
    expect(r[1].avgCost).toBeCloseTo(33.1);
    expect(r[1].quoteSymbol).toBe("");
    expect(r[0].quoteSymbol).toBe("AMD");
  });
});

describe("EOD, plans, import links, backfill", () => {
  const rates = { EUR: 1, USD: 1.1, GBP: 0.85 };
  const h0: M.Holding = { id: "x", accountId: "a", ticker: "FRES", name: "Fresnillo", market: "uk", currency: "GBP", shares: 100, avgCost: 10, quoteSymbol: "", quoteCurrency: "GBP", quoteRatio: 1, yahoo: "FRES.L" };
  const eod: M.Eod = { "FRES.L": { currency: "GBP", last: 12, lastDate: "2026-11-20", closes: [] } };
  it("uses closing prices when there's no live quote", () => {
    const v = M.valueHolding(h0, {}, rates, eod);
    expect(v.priceSource).toBe("eod"); expect(v.price).toBe(12); expect(v.value).toBeCloseTo(1200 / 0.85);
  });
  it("plan waives the custody minimum", () => {
    expect(M.custodyQuarter({ id: "a", name: "", broker: "bankinter", brokerCero: true, otherFee: 0 }, "eu", 1000, true)).toBeCloseTo(0.5);
  });
  it("yahoo guesses", () => { expect(M.yahooGuess("clnx", "es")).toBe("CLNX.MC"); expect(M.yahooGuess("amd", "us")).toBe("AMD"); expect(M.yahooGuess("asml", "eu")).toBe(""); });
  it("import links round-trip and replace per account", () => {
    const d: M.ImportData = { holdings: [{ ...h0, id: "" }], replace: true };
    expect(M.decodeImport(M.encodeImport(d)).holdings[0].ticker).toBe("FRES");
    const st = { ...M.defaultState(), holdings: [{ ...h0, id: "old", accountId: "a" }, { ...h0, id: "keep", accountId: "b" }] };
    const n = M.applyImport(st, d);
    expect(n.holdings.map((x) => x.id)).toContain("keep");
    expect(n.holdings.map((x) => x.id)).not.toContain("old");
    expect(n.holdings.length).toBe(2);
  });
  it("backfill compares with the benchmark", () => {
    const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (29 - i) * 864e5).toISOString().slice(0, 10));
    const e: M.Eod = { "^GSPC": { currency: "USD", closes: days.map((d, i) => [d, 100 + i] as [string, number]) }, "FRES.L": { currency: "GBP", closes: days.map((d, i) => [d, 10 + i * 0.5] as [string, number]) } };
    const r = M.backfill([M.valueHolding(h0, {}, rates, e)], e, rates)!;
    expect(r.mine[0]).toBeCloseTo(0); expect(r.mine[r.mine.length - 1]).toBeCloseTo(1.45); expect(r.bench[r.bench.length - 1]).toBeCloseTo(0.29);
  });
});
