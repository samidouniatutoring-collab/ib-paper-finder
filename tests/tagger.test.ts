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

  it("Math AI: integration from a rate of change, equations, approximation instructions", () => {
    const math = TOPIC_MAPS["math-ai"];
    const codes = (text: string, paperNumber = 2) => tagQuestion(text, math, { paperNumber }).map((x) => x.code);
    const conf = (text: string, code: string) => tagQuestion(text, math, { paperNumber: 1 }).find((x) => x.code === code)?.confidence ?? 0;
    expect(codes("the rate of change of the height of the plant is modelled as dh/dt = 1.2 - 0.1t. (c) find an expression for h in terms of t")).toContain("5.5");
    expect(codes("the lowest point of the ball passes through the points (1, 2.8), (2, 2.86) and (3, 2.89). write down three equations in terms of a, b and c", 1)).toContain("1.8");
    expect(codes("find the cost of the car. give your answer correct to the nearest dollar")).not.toContain("1.6");
    expect(codes("calculate the percentage error in her estimate")).toContain("1.6");
    expect(conf("find the integral of f(x) between x = 0 and x = 2", "5.5")).toBeGreaterThanOrEqual(0.75);
  });
});
