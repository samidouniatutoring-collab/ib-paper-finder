import { describe, expect, it } from "vitest";
import { detectMarks, questionStart, splitQuestions } from "../src/lib/split";

// Made-up sample text only (no real IB content).
const pages = [
  "Sample Exam\nInstructions to candidates\n1. A bakery sells cakes.\n(a) State one thing. [2]\n(b) Explain another. [4]",
  "2 (a) A shop opens.\n1. this numbered list item must not restart numbering\n(b) Describe it. [3 marks]\nQuestion 3\nA river flows.",
  "(a) Draw a map. [5]\n[Total: 9]",
  "Pregunta 4\nEscribe un texto corto. [10 puntos]",
];

describe("questionStart", () => {
  it("recognises question numbers", () => {
    expect(questionStart("1. A bakery")).toBe(1);
    expect(questionStart("2 (a) A shop")).toBe(2);
    expect(questionStart("2(a) A shop")).toBe(2);
    expect(questionStart("Question 3")).toBe(3);
    expect(questionStart("Pregunta 4")).toBe(4);
    expect(questionStart("1.5 kg of flour")).toBeNull();
    expect(questionStart("(a) part")).toBeNull();
  });
});

describe("detectMarks", () => {
  it("sums marks or uses the total", () => {
    expect(detectMarks("x [2] y [4]")).toBe(6);
    expect(detectMarks("x [3 marks] (2 marks)")).toBe(5);
    expect(detectMarks("[5]\n[Total: 9]")).toBe(9);
    expect(detectMarks("no marks")).toBeNull();
  });
});

describe("splitQuestions", () => {
  it("splits in order and keeps page ranges", () => {
    const q = splitQuestions(pages);
    expect(q.map((x) => x.number)).toEqual([1, 2, 3, 4]);
    expect(q[0]).toMatchObject({ startPage: 1, endPage: 1, marks: 6, pageLevel: false });
    expect(q[1]).toMatchObject({ startPage: 2, endPage: 2, marks: 3 });
    expect(q[2]).toMatchObject({ startPage: 2, endPage: 3, marks: 9 });
    expect(q[3]).toMatchObject({ startPage: 4, endPage: 4, marks: 10 });
  });

  it("falls back to page level when numbering is unclear", () => {
    const q = splitQuestions(["Some text", "More text [4]"]);
    expect(q).toHaveLength(2);
    expect(q.every((x) => x.pageLevel)).toBe(true);
    expect(q[1].marks).toBe(4);
  });
});
