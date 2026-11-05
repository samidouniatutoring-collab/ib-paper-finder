import { supabase } from "./config";
import { SUBJECTS } from "./lib/detect";
import { lang } from "./i18n";
import { withOffline } from "./offline";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  status: "pending" | "approved" | "removed";
  role: "student" | "owner";
  created_at: string;
  /** "homework": only the papers behind their homework. "full": every paper in `subjects` (null = all). */
  access?: "homework" | "full";
  subjects?: string[] | null;
}

export interface Settings {
  allowed_domain: string | null;
  allow_downloads: boolean;
  practice_settings?: unknown;
}

export interface Paper {
  id: string;
  storage_path: string;
  file_hash: string;
  original_name: string;
  subject: string | null;
  level: string | null;
  year: number | null;
  session: string | null;
  timezone: string | null;
  paper_number: number | null;
  paper_part: "A" | "B" | null;
  kind: "paper" | "markscheme" | "prerelease";
  page_count: number;
  needs_review: boolean;
}

export interface Tag {
  question_id: string;
  topic: string;
  confidence: number;
  source: "auto" | "owner";
}

export interface Question {
  id: string;
  paper_id: string;
  number: number;
  label: string;
  start_page: number;
  end_page: number;
  marks: number | null;
  page_level: boolean;
  papers?: Paper;
  question_tags?: Tag[];
}

export interface Progress {
  question_id: string;
  done: boolean;
  score: number | null;
  note: string;
}

export const state: { profile: Profile | null; settings: Settings } = {
  profile: null,
  settings: { allowed_domain: null, allow_downloads: true },
};

export const isOwner = () => state.profile?.role === "owner";
/** Homework-only people see Homework and Progress, not the Finder, Practice or Library. */
export const homeworkOnly = () => !isOwner() && (state.profile?.access ?? "homework") === "homework";
export const canDownload = () => isOwner() || state.settings.allow_downloads;
export const watermarkText = () =>
  `Shared with ${state.profile?.full_name || state.profile?.email || ""} · for tutoring students only`;

export function db() {
  if (!supabase) throw new Error("Not configured");
  return supabase;
}

/** Supabase returns at most 1000 rows per request; fetch page by page. */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export function subjectName(id: string | null): string {
  const s = SUBJECTS.find((x) => x.id === id);
  if (!s) return id ?? "Unknown subject";
  return lang === "es" ? s.nameEs : s.name;
}

export function paperLabel(p: Paper): string {
  const parts = [
    p.year ?? "?",
    p.session ?? "",
    p.timezone && p.timezone !== "TZ0" ? p.timezone : "",
    p.paper_number ? `Paper ${p.paper_number}${p.paper_part ?? ""}` : "Paper ?",
    p.level ?? "",
  ];
  return parts.filter(Boolean).join(" · ");
}

export async function loadPapers(): Promise<Paper[]> {
  return fetchAll<Paper>((a, b) => db().from("papers").select("*").order("year", { ascending: false }).range(a, b));
}

/** Questions of one subject with their paper and tags. */
export async function loadSubjectQuestions(subject: string): Promise<Question[]> {
  return withOffline(`subject:${subject}`, () => fetchAll<Question>((a, b) =>
    db()
      .from("questions")
      .select("*, papers!inner(*), question_tags(*)")
      .eq("papers.subject", subject)
      .eq("papers.kind", "paper")
      .order("number")
      .range(a, b),
  ));
}

async function one<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw error;
  if (!data) throw new Error("Not found");
  return data as T;
}

export const loadQuestion = (id: string) =>
  withOffline(`question:${id}`, () => one<Question>(db().from("questions").select("*, papers(*), question_tags(*)").eq("id", id).single()));
export const loadPaper = (id: string) => withOffline(`paper:${id}`, () => one<Paper>(db().from("papers").select("*").eq("id", id).single()));

export async function loadMyProgress(): Promise<Map<string, Progress>> {
  const rows = await withOffline("progress", () => fetchAll<Progress>((a, b) => db().from("progress").select("question_id, done, score, note").range(a, b)));
  return new Map(rows.map((r) => [r.question_id, r]));
}

export async function saveProgress(p: Progress): Promise<void> {
  const { error } = await db()
    .from("progress")
    .upsert({ ...p, user_id: state.profile!.id, updated_at: new Date().toISOString() });
  if (error) throw error;
}

/** The markscheme that belongs to a paper (same subject, level, year, session, timezone, paper number). */
function findMarkschemeQuery(p: Paper, kind: Paper["kind"] = "markscheme") {
  let q = db().from("papers").select("*").eq("kind", kind);
  for (const k of ["subject", "level", "year", "session", "timezone", "paper_number", "paper_part"] as const) {
    q = p[k] == null ? q.is(k, null) : q.eq(k, p[k] as string | number);
  }
  return q.order("created_at").limit(1);
}

export async function findMarkscheme(p: Paper, kind: Paper["kind"] = "markscheme"): Promise<Paper | null> {
  const { data } = await findMarkschemeQuery(p, kind);
  return (data?.[0] as Paper) ?? null;
}

/** The paper a markscheme belongs to. */
export const findPaperFor = (ms: Paper) => findMarkscheme(ms, "paper");

/** The pre-release statement of a Paper 1 (same subject, level, year, session, timezone). */
export function findPrerelease(p: Paper): Promise<Paper | null> {
  if (p.kind !== "paper" || p.paper_number !== 1) return Promise.resolve(null);
  return withOffline(`prerelease:${p.id}`, () => findMarkscheme(p, "prerelease"));
}

/** All pre-release statements of a subject (for linking many Paper 1 questions at once). */
export function loadPrereleases(subject: string): Promise<Paper[]> {
  return withOffline(`prereleases:${subject}`, async () => {
    const { data, error } = await db().from("papers").select("*").eq("kind", "prerelease").eq("subject", subject);
    if (error) throw error;
    return (data ?? []) as Paper[];
  });
}

// ---------------------------------------------------------------------------
// Homework
// ---------------------------------------------------------------------------
export interface HomeworkSet {
  id: string;
  title: string;
  due_date: string | null;
  note: string;
  created_at: string;
}

export interface HomeworkItem {
  set_id: string;
  question_id: string;
  position: number;
  questions?: Question;
}

export interface HomeworkAssignment {
  set_id: string;
  user_id: string;
  group_id: string | null;
  assigned_at: string;
  owner_comment: string;
  owner_comment_at: string | null;
  owner_score?: number | null;
}

export interface Submission {
  id: string;
  set_id: string;
  user_id: string;
  files: string[];
  note: string;
  created_at: string;
}

export interface HomeworkAnswer {
  set_id: string;
  question_id: string;
  user_id: string;
  done: boolean;
  score: number | null;
  comment: string;
  finished_at: string | null;
}

export interface StudentGroup {
  id: string;
  name: string;
  members: string[];
}

export async function loadGroups(): Promise<StudentGroup[]> {
  const { data, error } = await db().from("student_groups").select("id, name, student_group_members(user_id)").order("name");
  if (error) throw error;
  return (data ?? []).map((g: { id: string; name: string; student_group_members: { user_id: string }[] }) => ({
    id: g.id,
    name: g.name,
    members: g.student_group_members.map((m) => m.user_id),
  }));
}

export async function loadApprovedStudents(): Promise<Profile[]> {
  return fetchAll<Profile>((a, b) =>
    db().from("profiles").select("*").eq("status", "approved").eq("role", "student").order("full_name").range(a, b),
  );
}

/** Sets with their ordered items (and each question's paper). RLS limits students to their own sets. */
export function loadHomework(setId?: string): Promise<{ sets: HomeworkSet[]; items: HomeworkItem[] }> {
  return withOffline(`homework:${setId ?? "all"}`, () => fetchHomework(setId));
}

async function fetchHomework(setId?: string): Promise<{ sets: HomeworkSet[]; items: HomeworkItem[] }> {
  let sq = db().from("homework_sets").select("*").order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
  if (setId) sq = sq.eq("id", setId);
  const { data: sets, error } = await sq;
  if (error) throw error;
  const ids = (sets ?? []).map((s: HomeworkSet) => s.id);
  if (!ids.length) return { sets: [], items: [] };
  const items = await fetchAll<HomeworkItem>((a, b) =>
    db().from("homework_items").select("*, questions(*, papers(*))").in("set_id", ids).order("position").range(a, b),
  );
  return { sets: sets as HomeworkSet[], items };
}

export async function loadHomeworkAnswers(setIds: string[]): Promise<HomeworkAnswer[]> {
  if (!setIds.length) return [];
  return withOffline(`answers:${[...setIds].sort().join(",")}`, () =>
    fetchAll<HomeworkAnswer>((a, b) => db().from("homework_answers").select("*").in("set_id", setIds).range(a, b)));
}

export async function loadAssignments(setIds: string[]): Promise<HomeworkAssignment[]> {
  if (!setIds.length) return [];
  return fetchAll<HomeworkAssignment>((a, b) => db().from("homework_assignments").select("*").in("set_id", setIds).range(a, b));
}

// ---------------------------------------------------------------------------
// Markscheme part of a question
// ---------------------------------------------------------------------------
export interface MarkschemePart {
  ms: Paper;
  start: number;
  end: number;
  exact: boolean; // false = this question wasn't found, so the whole markscheme is shown
  source: "auto" | "owner" | "split" | "whole";
}

/** The markscheme pages for a question: the stored mapping, else the markscheme's own split, else the whole markscheme. */
export function markschemeFor(q: Question): Promise<MarkschemePart | null> {
  return withOffline(`markscheme:${q.id}`, () => findMarkschemePart(q));
}

async function findMarkschemePart(q: Question): Promise<MarkschemePart | null> {
  const { data: msRows, error } = await findMarkschemeQuery(q.papers!);
  if (error) throw error;
  const ms = (msRows?.[0] as Paper) ?? null;
  if (!ms) return null;
  const { data: r, error: rErr } = await db().from("markscheme_ranges").select("start_page, end_page, source, markscheme_id").eq("question_id", q.id).maybeSingle();
  if (rErr && !/markscheme_ranges/.test(rErr.message)) throw rErr;
  if (r && r.markscheme_id === ms.id) return { ms, start: r.start_page, end: r.end_page, exact: true, source: r.source };
  if (!q.page_level) {
    const { data, error: qErr } = await db().from("questions").select("start_page, end_page").eq("paper_id", ms.id).eq("number", q.number).maybeSingle();
    if (qErr) throw qErr;
    if (data) return { ms, start: data.start_page, end: data.end_page, exact: true, source: "split" };
  }
  return { ms, start: 1, end: Math.max(1, ms.page_count || 999), exact: false, source: "whole" };
}

/** Owner: set (or with null, reset to automatic) a question's markscheme pages. */
export async function saveMarkschemeRange(q: Question, ms: Paper, range: { start: number; end: number } | null): Promise<void> {
  if (!range) {
    const { error } = await db().from("markscheme_ranges").delete().eq("question_id", q.id);
    if (error) throw error;
    return;
  }
  const { error } = await db().from("markscheme_ranges").upsert({
    question_id: q.id, markscheme_id: ms.id, start_page: range.start, end_page: range.end, source: "owner", updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
