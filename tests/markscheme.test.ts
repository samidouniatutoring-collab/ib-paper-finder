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

  it("'Question 1 continued' headers are not where the question starts (Math AI markscheme)", () => {
    // Pages: instructions, Q1 starts on 3, continues on 4 with a header, Q2 starts on 4, Q3 on 5 (also continued on 6).
    const pages = [
      "Markscheme\nInstructions to Examiners",
      "1 General\nAward marks using the annotations",
      "1. (a) 30 A1\n(b) arithmetic formula chosen (M1)",
      "Question 1 continued\n(e) 1.44% A1\n[Total 15 marks]\n2. (a) (i) 30 A1",
      "3. (a) 0.95 A1",
      "Question 3 continued\n(c) 12 A1",
    ];
    const m = splitMarkscheme(pages, [1, 2, 3]);
    expect(m.get(1)).toEqual({ start: 3, end: 4 });
    expect(m.get(2)).toEqual({ start: 4, end: 4 });
    expect(m.get(3)).toEqual({ start: 5, end: 6 });
  });

  it("ignores markband 'Question N:' headings that all sit on one page (Psychology Paper 2)", () => {
    const pages = [
      "Markscheme",
      "Question 1: Knowledge and understanding\n0 The work does not reach\nQuestion 2: Application\nQuestion 3: Compare and contrast\nQuestion 4: Design",
      "Section A\n1.   Describe how you used an interview",
      "2.   Explain the concept of bias",
      "3.   Compare and contrast the methodology",
      "4.   Design an observation",
      "Section B\n5.   Discuss the following study",
    ];
    const m = splitMarkscheme(pages, [1, 2, 3, 4, 5]);
    expect([...m.values()].map((r) => r.start)).toEqual([3, 4, 5, 6, 7]);
  });
  it("reads multiple-choice answer grids in two columns (SEHS Paper 1A)", () => {
    const grid = Array.from({ length: 15 }, (_, i) => `${i + 1}.    A   ${i + 16}.   B`).join("\n\n");
    const m = splitMarkscheme(["Markscheme\nPaper 1A", grid], Array.from({ length: 30 }, (_, i) => i + 1));
    expect(m.size).toBe(30);
    expect(m.get(16)).toEqual({ start: 2, end: 2 });
    expect(m.get(30)).toEqual({ start: 2, end: 2 });
  });
});
