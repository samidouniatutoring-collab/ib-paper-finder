import { describe, expect, it } from "vitest";
import { expandAssignees, homeworkSummary } from "../src/lib/homework";

const items = [
  { question_id: "a", marks: 6 },
  { question_id: "b", marks: 4 },
  { question_id: "c", marks: null },
];
const now = new Date(2026, 10, 10, 12); // 10 Nov 2026, local time

describe("homeworkSummary", () => {
  it("is not started with no answers", () => {
    const s = homeworkSummary(items, [], "2026-11-12", now);
    expect(s).toMatchObject({ status: "not_started", doneCount: 0, total: 3, score: null, overdue: false });
  });

  it("is in progress when some are done or scored, and sums scores", () => {
    const s = homeworkSummary(items, [
      { question_id: "a", done: true, score: 5, finished_at: "2026-11-09T10:00:00Z" },
      { question_id: "b", done: false, score: 2, finished_at: null },
    ], null, now);
    expect(s).toMatchObject({ status: "in_progress", doneCount: 1, score: 7, scoredMarks: 10, finishedAt: null });
  });

  it("is done when every question is done, with the last finish time", () => {
    const s = homeworkSummary(items, [
      { question_id: "a", done: true, score: 5, finished_at: "2026-11-09T10:00:00Z" },
      { question_id: "b", done: true, score: null, finished_at: "2026-11-11T08:00:00Z" },
      { question_id: "c", done: true, score: 3, finished_at: "2026-11-10T08:00:00Z" },
      { question_id: "zzz", done: true, score: 99, finished_at: "2027-01-01T00:00:00Z" }, // not in the set
    ], "2026-11-01", now);
    expect(s).toMatchObject({ status: "done", doneCount: 3, score: 8, scoredMarks: 6, finishedAt: "2026-11-11T08:00:00Z", overdue: false });
  });

  it("is overdue only after the due day", () => {
    expect(homeworkSummary(items, [], "2026-11-10", now).overdue).toBe(false);
    expect(homeworkSummary(items, [], "2026-11-09", now).overdue).toBe(true);
  });

  it("an empty set is never done", () => {
    expect(homeworkSummary([], [], null, now).status).toBe("not_started");
  });
});

describe("expandAssignees", () => {
  it("merges students and group members without duplicates", () => {
    const r = expandAssignees(["s1", "s2"], [{ id: "g1", members: ["s2", "s3"] }, { id: "g2", members: ["s4"] }], ["g1"]);
    expect(r).toEqual([
      { user_id: "s2", group_id: "g1" },
      { user_id: "s3", group_id: "g1" },
      { user_id: "s1", group_id: null },
    ]);
  });
});
