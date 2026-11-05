import { describe, expect, it } from "vitest";
import { findDuplicates, type DupCandidate } from "../src/lib/duplicates";

const p = (id: string, timezone: string | null, name = id): DupCandidate => ({
  id, kind: "paper", subject: "math-ai", level: "SL", year: 2026, session: "May", timezone, paper_number: 1, original_name: name,
});
describe("duplicates", () => {
  it("finds a scan that is the same paper as a text PDF and keeps the one with a timezone", () => {
    const text = new Map([
      ["tz1", "triangle shown diagram calculate size angle area pyramid silver square length midpoint probability archery target"],
      ["scan", "triangle shown diagram calculate size angle area pyramid silver square length midpoint probability archery"],
      ["tz2", "jelly beans school fair guessed mass grouped frequency table estimate mean standard deviation explain"],
    ]);
    const d = findDuplicates([p("tz1", "TZ1"), p("scan", null), p("tz2", "TZ2")], text);
    expect([...d.keys()]).toEqual(["scan"]);
    expect(d.get("scan")!.id).toBe("tz1");
  });
  it("never matches different papers or different timezones", () => {
    const same = "triangle shown diagram calculate size angle area pyramid";
    const d = findDuplicates([p("a", "TZ1"), p("b", "TZ2")], new Map([["a", same], ["b", same]]));
    expect(d.size).toBe(0);
  });
});
