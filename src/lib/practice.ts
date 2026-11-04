// Practice mode: choosing the next question and its timer. Pure, no DOM.

export interface PracticeSettings {
  minutesPerMark: number;
  subjects: Record<string, number>;
}

export const DEFAULT_PRACTICE: PracticeSettings = { minutesPerMark: 1.5, subjects: {} };

const okMinutes = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 30;

/** Accepts whatever is stored (or typed by the owner) and returns valid settings. */
export function parsePracticeSettings(raw: unknown): PracticeSettings {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return { ...DEFAULT_PRACTICE, subjects: {} };
    }
  }
  const o = (v && typeof v === "object" ? v : {}) as { minutesPerMark?: unknown; subjects?: unknown };
  const subjects: Record<string, number> = {};
  if (o.subjects && typeof o.subjects === "object") {
    for (const [k, m] of Object.entries(o.subjects as Record<string, unknown>)) if (okMinutes(m)) subjects[k] = m;
  }
  return { minutesPerMark: okMinutes(o.minutesPerMark) ? o.minutesPerMark : DEFAULT_PRACTICE.minutesPerMark, subjects };
}

/** Seconds for a question, or null when its marks are unknown (the timer then counts up). */
export function timerSeconds(marks: number | null, subject: string | null, s: PracticeSettings): number | null {
  if (marks == null || marks <= 0) return null;
  const perMark = (subject && s.subjects[subject]) || s.minutesPerMark;
  return Math.round(marks * perMark * 60);
}

export interface PracticeCandidate {
  id: string;
  marks: number | null;
  papers?: { paper_number: number | null; level: string | null } | null;
  question_tags?: { topic: string }[];
}

export interface PracticeFilter {
  topics: string[]; // tag ids ("subject:code"); empty = any topic
  paper?: number | null;
  level?: string | null; // "HL" or "SL"
  includeDone: boolean;
}

/** Every question that fits the filter, leaving out done ones (unless included) and ones already shown. */
export function practicePool<Q extends PracticeCandidate>(qs: Q[], f: PracticeFilter, done: Set<string>, seen: Set<string>): Q[] {
  return qs.filter((q) => {
    if (seen.has(q.id)) return false;
    if (!f.includeDone && done.has(q.id)) return false;
    if (f.topics.length && !(q.question_tags ?? []).some((t) => f.topics.includes(t.topic))) return false;
    if (f.paper && q.papers?.paper_number !== f.paper) return false;
    if (f.level && !(q.papers?.level ?? "").includes(f.level)) return false;
    return true;
  });
}

/** A random question from the pool, or null when nothing is left. */
export function pickPracticeQuestion<Q extends PracticeCandidate>(
  qs: Q[], f: PracticeFilter, done: Set<string>, seen: Set<string>, random: () => number = Math.random,
): Q | null {
  const pool = practicePool(qs, f, done, seen);
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

export function formatClock(seconds: number): string {
  const s = Math.abs(Math.round(seconds));
  return `${seconds < 0 ? "-" : ""}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
