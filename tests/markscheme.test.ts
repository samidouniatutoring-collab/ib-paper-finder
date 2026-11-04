import { describe, expect, it } from "vitest";
import { msLineStart, splitMarkscheme } from "../src/lib/markscheme";

// Made-up sample text only (no real IB content).
describe("msLineStart", () => {
  it("recognises markscheme question starts", () => {
    expect(msLineStart("Question 2")).toEqual({ number: 2, strong: true });
    expect(msLineStart("Pregunta 3")).toEqual({ number: 3, strong: true });
    expect(msLineStart("1a State one thing")).toEqual({ number: 1, strong: false });
    expect(msLineStart("2 (b) Award [1]")).toEqual({ number: 2, strong: false });
    expect(msLineStart("3. Any valid answer")).toEqual({ number: 3, strong: false });
    expect(msLineStart("1.5 kg")).toBeNull();
    expect(msLineStart("Award marks")).toBeNull();
  });
});

describe("splitMarkscheme", () => {
  const pages = [
    "Sample markscheme\n1. Marks must be awarded as shown.\n2. Use the bands.\n3. Do not award half marks.",
    "1a A bakery sells cakes [1]\n1b Any reason [2]",
    "2a Shop opens [1]\n1. an answer list item\n2b Another [2]",
    "3 Map drawn [5]",
    "3 continued: labels",
  ];

  it("skips numbered instructions and maps each question to its pages", () => {
    const m = splitMarkscheme(pages, [1, 2, 3]);
    expect(m.get(1)).toEqual({ start: 2, end: 2 });
    expect(m.get(2)).toEqual({ start: 3, end: 3 });
    expect(m.get(3)).toEqual({ start: 4, end: 5 });
  });

  it("prefers Question headings when the paper uses them", () => {
    const m = splitMarkscheme(["Question 1\n2. list item\nmore", "Question 2\n3 something", "Question 3"], [1, 2, 3]);
    expect([...m.entries()]).toEqual([[1, { start: 1, end: 1 }], [2, { start: 2, end: 2 }], [3, { start: 3, end: 3 }]]);
  });

  it("tolerates one missing question and leaves unfound ones out", () => {
    const m = splitMarkscheme(["Question 1 x", "Question 3 y", "Question 4 z"], [1, 2, 3, 4]);
    expect(m.has(2)).toBe(false);
    expect(m.get(1)).toEqual({ start: 1, end: 1 });
    expect(m.get(3)).toEqual({ start: 2, end: 2 });
    expect(m.get(4)).toEqual({ start: 3, end: 3 });
  });

  it("returns nothing when no numbers can be found", () => {
    expect(splitMarkscheme(["no numbers here"], [1, 2]).size).toBe(0);
    expect(splitMarkscheme([], [1]).size).toBe(0);
  });
});
