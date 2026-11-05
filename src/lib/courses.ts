// The courses this app is for: one level per subject and only the papers that course sits.
// Change these when what you teach changes.
import type { SubjectId } from "./detect";

export interface Course {
  /** "SL" or "HL", or null to show both levels. */
  level: "SL" | "HL" | null;
  papers: number[];
  /** Official exam length in minutes per paper (reading time not included), when known. */
  examMinutes: Partial<Record<number, number>>;
}

export const COURSES: Record<SubjectId, Course> = {
  business: { level: "HL", papers: [1, 2, 3], examMinutes: { 1: 90, 2: 105, 3: 75 } },
  "math-ai": { level: "SL", papers: [1, 2], examMinutes: { 1: 90, 2: 90 } },
  psychology: { level: "HL", papers: [1, 2, 3], examMinutes: {} },
  sehs: { level: "SL", papers: [1, 2], examMinutes: {} },
  "spanish-b": { level: "SL", papers: [1, 2], examMinutes: {} },
  "english-a-ll": { level: null, papers: [1, 2], examMinutes: {} },
};

/** True when a paper belongs to the course (unknown level counts as a match; "HL/SL" papers match both). */
export function inCourse(p: { subject: string | null; level: string | null; paper_number: number | null }): boolean {
  const c = p.subject ? COURSES[p.subject as SubjectId] : undefined;
  if (!c) return true;
  if (c.level && p.level && !p.level.includes(c.level)) return false;
  if (p.paper_number != null && !c.papers.includes(p.paper_number)) return false;
  return true;
}

export const courseLabel = (subject: string): string => {
  const c = COURSES[subject as SubjectId];
  return c?.level ?? "";
};
