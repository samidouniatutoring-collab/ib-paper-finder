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

import { onlyHeaderBefore, splitQuestions as __split } from "../src/lib/split";
import { timerSeconds as __timer, DEFAULT_PRACTICE as __def } from "../src/lib/practice";
describe("IB page headers", () => {
  it("ends a question on the page before the next one when only the header comes first", () => {
    const pages = [
      "– 2 –\n2226 – 5218\n1. [Maximum mark: 6]\nThe weights of apples are normally distributed. [6]",
      "– 3 –\n2226 – 5218\n2. [Maximum mark: 6]\nTriangle ABC is shown in the diagram. (a) Calculate the size of angle CAB. [3]\n(b) Calculate the area. [3]\nTurn over",
      "– 4 –\n2226 – 5218\n20EP04\n3. [Maximum mark: 5]\nAt a school fair, 200 people guessed the mass. [5]",
    ];
    const qs = __split(pages);
    const q2 = qs.find((q) => q.number === 2)!;
    expect([q2.startPage, q2.endPage, q2.marks]).toEqual([2, 2, 6]);
    expect(onlyHeaderBefore(pages[2], 3)).toBe(true);
    expect(onlyHeaderBefore("Some question text continues here\n3. [Maximum mark: 5]", 1)).toBe(false);
  });
  it("uses the official pace for Math AI SL and Business", () => {
    expect(__timer(6, "math-ai", __def, { level: "SL", paper_number: 1 })).toBe(405);
    expect(__timer(10, "business", __def, { level: "HL", paper_number: 2 })).toBe(1260);
    expect(__timer(6, "psychology", __def, { level: "HL", paper_number: 1 })).toBe(540);
  });
});
