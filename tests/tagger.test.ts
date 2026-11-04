import { describe, expect, it } from "vitest";
import { confidenceHint, tagQuestion } from "../src/lib/tagger";
import { TOPIC_MAPS, findTopic } from "../src/lib/topics";

describe("tagQuestion", () => {
  it("tags maths text by keyword", () => {
    const tags = tagQuestion("A sample of 50 students. Perform a chi-squared test for independence at the 5% significance level.", TOPIC_MAPS["math-ai"]);
    expect(tags[0].code).toBe("4.11");
    expect(confidenceHint(tags[0].confidence)).toBe("high");
  });

  it("tags business text and toolkit tools", () => {
    const codes = tagQuestion("Construct a cash flow forecast and comment on the closing balance. Then use a SWOT analysis.", TOPIC_MAPS.business).map((t) => t.code);
    expect(codes).toContain("3.7");
    expect(codes).toContain("tk.swot");
  });

  it("is accent-insensitive and respects paper restrictions", () => {
    const text = "Escribe un artículo para la revista sobre el medio ambiente y el cambio climático.";
    const p1 = tagQuestion(text, TOPIC_MAPS["spanish-b"], { paperNumber: 1 }).map((t) => t.code);
    expect(p1).toContain("tt.article");
    const p2 = tagQuestion(text, TOPIC_MAPS["spanish-b"], { paperNumber: 2 }).map((t) => t.code);
    expect(p2).not.toContain("tt.article");
    expect(p2).toContain("th.planet");
  });

  it("uses marks for psychology question type", () => {
    const saq = tagQuestion("Outline one study.", TOPIC_MAPS.psychology, { marks: 9 }).map((t) => t.code);
    expect(saq).toContain("type.saq");
    const erq = tagQuestion("Evaluate one theory.", TOPIC_MAPS.psychology, { marks: 22 }).map((t) => t.code);
    expect(erq).toContain("type.erq");
  });

  it("returns nothing for unrelated text and lowers page-level confidence", () => {
    expect(tagQuestion("zzz qqq", TOPIC_MAPS.sehs)).toEqual([]);
    const a = tagQuestion("velocity and momentum", TOPIC_MAPS.sehs)[0].confidence;
    const b = tagQuestion("velocity and momentum", TOPIC_MAPS.sehs, { pageLevel: true })[0].confidence;
    expect(b).toBeLessThan(a);
  });

  it("every topic map has unique codes and resolves tags", () => {
    for (const [subject, topics] of Object.entries(TOPIC_MAPS)) {
      const codes = topics.map((t) => t.code);
      expect(new Set(codes).size).toBe(codes.length);
      expect(findTopic(`${subject}:${codes[0]}`)?.code).toBe(codes[0]);
    }
  });
});
