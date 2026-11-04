import { describe, expect, it } from "vitest";
import { formatClock, parsePracticeSettings, pickPracticeQuestion, practicePool, timerSeconds } from "../src/lib/practice";

const q = (id: string, topics: string[], paper = 1, level = "HL", marks: number | null = 6) => ({
  id, marks, papers: { paper_number: paper, level }, question_tags: topics.map((topic) => ({ topic })),
});
const qs = [q("a", ["s:1"]), q("b", ["s:2"]), q("c", ["s:1", "s:3"], 2, "SL"), q("d", ["s:1"], 1, "HL/SL")];

describe("practice selection", () => {
  it("filters by topic, paper and level", () => {
    const f = { topics: ["s:1"], includeDone: true };
    expect(practicePool(qs, f, new Set(), new Set()).map((x) => x.id)).toEqual(["a", "c", "d"]);
    expect(practicePool(qs, { ...f, paper: 1 }, new Set(), new Set()).map((x) => x.id)).toEqual(["a", "d"]);
    expect(practicePool(qs, { ...f, level: "SL" }, new Set(), new Set()).map((x) => x.id)).toEqual(["c", "d"]);
    expect(practicePool(qs, { topics: [], includeDone: true }, new Set(), new Set())).toHaveLength(4);
  });

  it("skips done questions unless included, and never repeats in a session", () => {
    const f = { topics: ["s:1"], includeDone: false };
    expect(practicePool(qs, f, new Set(["a"]), new Set(["c"])).map((x) => x.id)).toEqual(["d"]);
    expect(practicePool(qs, { ...f, includeDone: true }, new Set(["a"]), new Set(["c"])).map((x) => x.id)).toEqual(["a", "d"]);
  });

  it("picks randomly from the pool and returns null when empty", () => {
    const f = { topics: ["s:1"], includeDone: false };
    expect(pickPracticeQuestion(qs, f, new Set(), new Set(), () => 0)?.id).toBe("a");
    expect(pickPracticeQuestion(qs, f, new Set(), new Set(), () => 0.999)?.id).toBe("d");
    expect(pickPracticeQuestion(qs, f, new Set(["a", "c", "d"]), new Set(), () => 0)).toBeNull();
  });
});

describe("practice timer", () => {
  it("uses 1.5 min per mark by default and per-subject overrides", () => {
    const s = parsePracticeSettings({ minutesPerMark: 1.5, subjects: { math: 1.2, bad: -3 } });
    expect(s.subjects).toEqual({ math: 1.2 });
    expect(timerSeconds(10, "other", s)).toBe(900);
    expect(timerSeconds(10, "math", s)).toBe(720);
    expect(timerSeconds(null, "math", s)).toBeNull();
  });
  it("survives bad settings JSON", () => {
    expect(parsePracticeSettings("{oops")).toEqual({ minutesPerMark: 1.5, subjects: {} });
    expect(parsePracticeSettings('{"minutesPerMark": 2}').minutesPerMark).toBe(2);
    expect(parsePracticeSettings(null).minutesPerMark).toBe(1.5);
  });
  it("formats the clock", () => {
    expect(formatClock(905)).toBe("15:05");
    expect(formatClock(-65)).toBe("-1:05");
  });
});
