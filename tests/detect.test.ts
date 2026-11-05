import { describe, expect, it } from "vitest";
import { detectPaperCode, detectPaper, pairKey } from "../src/lib/detect";

describe("detectPaper", () => {
  it("detects pre-release statements as Paper 1", () => {
    for (const name of [
      "Business_management_paper_1_pre-release_statement_HL_SL_May_2024.pdf",
      "M24 Business Management prerelease.pdf",
      "Business management pre release N23 TZ1.pdf",
      "BM_pre-seen_case_study_2025.pdf",
    ]) expect(detectPaper(name), name).toMatchObject({ subject: "business", kind: "prerelease", paperNumber: 1 });
    expect(detectPaper("Business_management_paper_2_pre-release.pdf").paperNumber).toBe(1);
    expect(detectPaper("May 2024 TZ2", "Business management\nPaper 1 pre-release statement\nCase study: Example Co")).toMatchObject({
      kind: "prerelease", paperNumber: 1, year: 2024, session: "May", timezone: "TZ2",
    });
  });

  it("markscheme wins over pre-release; pre-release wins over paper", () => {
    expect(detectPaper("Business_management_paper_1_pre-release_markscheme.pdf").kind).toBe("markscheme");
    expect(detectPaper("Business_management_paper_1__HL.pdf", "Paper 1 pre-release statement").kind).toBe("prerelease");
    expect(detectPaper("Business_management_paper_1__HL.pdf", "Markscheme\npre-release").kind).toBe("markscheme");
  });

  it("ignores pre-release mentions deep in a Paper 1 cover page", () => {
    const cover = "Business management\nHigher level\nPaper 1\n" + "Instructions to candidates. ".repeat(20) + "A clean copy of the pre-release statement is required.";
    expect(detectPaper("Business_management_paper_1__HL.pdf", cover).kind).toBe("paper");
  });

  it("reads common IB file names", () => {
    expect(detectPaper("Business_management_paper_1__HL.pdf")).toMatchObject({
      subject: "business", level: "HL", paperNumber: 1, kind: "paper",
    });
    expect(detectPaper("May 2023/Business_management_paper_2__markscheme__HL.pdf")).toMatchObject({
      subject: "business", paperNumber: 2, kind: "markscheme", level: "HL",
    });
    expect(detectPaper("Mathematics_applications_and_interpretation_paper_1__TZ1_SL.pdf")).toMatchObject({
      subject: "math-ai", level: "SL", timezone: "TZ1", paperNumber: 1,
    });
    expect(detectPaper("M23_Maths_AI_SL_P2_TZ2_MS.pdf")).toMatchObject({
      subject: "math-ai", year: 2023, session: "May", timezone: "TZ2", paperNumber: 2, kind: "markscheme",
    });
    expect(detectPaper("Psychology_paper_1__HL_SL_November_2022.pdf")).toMatchObject({
      subject: "psychology", level: "HL/SL", year: 2022, session: "November",
    });
    expect(detectPaper("N21 SEHS SL paper 3.pdf")).toMatchObject({ subject: "sehs", year: 2021, session: "November", paperNumber: 3 });
    expect(detectPaper("Sports_exercise_and_health_science_paper_2__SL.pdf").subject).toBe("sehs");
  });

  it("handles Spanish B and English A Language and Literature", () => {
    expect(detectPaper("Español B NM prueba 1 mayo 2024.pdf")).toMatchObject({
      subject: "spanish-b", level: "SL", paperNumber: 1, session: "May", year: 2024,
    });
    expect(detectPaper("Lengua_B_Prueba_2_NS_esquema_de_calificacion.pdf")).toMatchObject({
      subject: "spanish-b", level: "HL", paperNumber: 2, kind: "markscheme",
    });
    expect(detectPaper("Spanish_B_paper_1__SL.pdf").subject).toBe("spanish-b");
    expect(detectPaper("English_A_Language_and_literature_paper_1__SL.pdf")).toMatchObject({ subject: "english-a-ll", level: "SL" });
    expect(detectPaper("English A Lang and Lit HL P2.pdf")).toMatchObject({ subject: "english-a-ll", level: "HL", paperNumber: 2 });
  });

  it("falls back to first-page text, strictly", () => {
    const d = detectPaper("scan_0042.pdf", "Psychology\nHigher level\nPaper 2\nNovember 2021\nYou may not open this booklet");
    expect(d).toMatchObject({ subject: "psychology", level: "HL", paperNumber: 2, year: 2021, session: "November", kind: "paper" });
    // "may" as a verb must not set the session
    expect(detectPaper("scan.pdf", "You may use a calculator").session).toBeNull();
    expect(detectPaper("scan.pdf", "Dear Ms Smith").kind).toBe("paper");
    expect(detectPaper("scan.pdf", "Markscheme\nBusiness management").kind).toBe("markscheme");
  });

  it("pairs a paper with its markscheme", () => {
    const a = detectPaper("M23_Business_management_paper_1_HL.pdf");
    const b = detectPaper("M23_Business_management_paper_1_HL_markscheme.pdf");
    const key = (d: typeof a) => pairKey({ subject: d.subject, level: d.level, year: d.year, session: d.session, timezone: d.timezone, paper_number: d.paperNumber });
    expect(key(a)).toBe(key(b));
  });
  it("detects timezone 3", () => {
    expect(detectPaper("Mathematics_applications_and_interpretation_paper_1_TZ3_SL.pdf")).toMatchObject({
      subject: "math-ai", level: "SL", timezone: "TZ3", paperNumber: 1, kind: "paper",
    });
    expect(detectPaper("Mathematics_applications_and_interpretation_paper_2_TZ3_SL_markscheme.pdf")).toMatchObject({
      timezone: "TZ3", paperNumber: 2, kind: "markscheme",
    });
  });
  it("reads the IB paper code on the pages when the file name has no year", () => {
    const pages = "Mathematics: applications and interpretation\nStandard level\nPaper 2\n\n– 2 – M24/5/MATAI/SP2/ENG/TZ1/XX\n1. [Maximum mark: 14]";
    expect(detectPaper("Mathematics_applications_and_interpretation_paper_2_TZ1_SL.pdf", pages)).toMatchObject({
      subject: "math-ai", level: "SL", year: 2024, session: "May", timezone: "TZ1", paperNumber: 2, kind: "paper",
    });
    expect(detectPaper("Mathematics_applications_and_interpretation_paper_2_TZ3_SL_markscheme.pdf", "Markscheme\nN23/5/MATAI/SP2/ENG/TZ3/XX/M")).toMatchObject({
      year: 2023, session: "November", timezone: "TZ3", paperNumber: 2, kind: "markscheme",
    });
    expect(detectPaper("Math AISL Paper 2 TZA.pdf", "– 3 – M25/5/MATAI/SP2/ENG/TZ2/XX")).toMatchObject({
      subject: "math-ai", year: 2025, session: "May", timezone: "TZ2", paperNumber: 2, level: "SL",
    });
    expect(detectPaperCode("M24/3/BUSMT/HP3/ENG/TZ0/XX")).toMatchObject({ level: "HL", paperNumber: 3, year: 2024 });
  });
});
