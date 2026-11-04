// Homework status for one student and one set. Pure, no DOM.

export type HomeworkStatus = "not_started" | "in_progress" | "done";

export interface HomeworkAnswerLike {
  question_id: string;
  done: boolean;
  score: number | null;
  finished_at: string | null;
}

export interface HomeworkSummary {
  status: HomeworkStatus;
  doneCount: number;
  total: number;
  /** Sum of self-scores and of the marks of the scored questions (null when nothing is scored). */
  score: number | null;
  scoredMarks: number | null;
  /** When the last question was marked done, only when every question is done. */
  finishedAt: string | null;
  overdue: boolean;
}

/** "YYYY-MM-DD" of a date in the user's local time. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * items: the set's question ids with their marks; answers: this student's rows for the set.
 * A set is overdue when its due date has passed (the due day itself still counts) and it isn't done.
 */
export function homeworkSummary(
  items: { question_id: string; marks: number | null }[],
  answers: HomeworkAnswerLike[],
  dueDate: string | null,
  now: Date = new Date(),
): HomeworkSummary {
  const ids = new Set(items.map((i) => i.question_id));
  const mine = answers.filter((a) => ids.has(a.question_id));
  const done = mine.filter((a) => a.done);
  const touched = mine.some((a) => a.done || a.score != null);
  const total = items.length;
  const status: HomeworkStatus = total > 0 && done.length >= total ? "done" : touched ? "in_progress" : "not_started";

  const marks = new Map(items.map((i) => [i.question_id, i.marks]));
  const scored = mine.filter((a) => a.score != null);
  const score = scored.length ? scored.reduce((s, a) => s + (a.score ?? 0), 0) : null;
  const withMarks = scored.filter((a) => marks.get(a.question_id) != null);
  const scoredMarks = withMarks.length ? withMarks.reduce((s, a) => s + (marks.get(a.question_id) ?? 0), 0) : null;

  const finishedAt =
    status === "done"
      ? done.map((a) => a.finished_at).filter((x): x is string => !!x).sort().at(-1) ?? null
      : null;
  const overdue = status !== "done" && !!dueDate && localDay(now) > dueDate;
  return { status, doneCount: done.length, total, score, scoredMarks, finishedAt, overdue };
}

/** Owner view: every student assigned to a set, expanded from picked students and groups (no duplicates). */
export function expandAssignees(
  studentIds: string[],
  groups: { id: string; members: string[] }[],
  pickedGroups: string[],
): { user_id: string; group_id: string | null }[] {
  const out = new Map<string, string | null>();
  for (const g of groups) if (pickedGroups.includes(g.id)) for (const m of g.members) if (!out.has(m)) out.set(m, g.id);
  for (const s of studentIds) if (!out.has(s)) out.set(s, null);
  return [...out.entries()].map(([user_id, group_id]) => ({ user_id, group_id }));
}
