// Detects paper details from a file name and (optionally) the first page's text. Pure, no DOM.

export type SubjectId = "business" | "math-ai" | "psychology" | "sehs" | "spanish-b" | "english-a-ll";

export const SUBJECTS: { id: SubjectId; name: string; nameEs: string }[] = [
  { id: "business", name: "Business Management", nameEs: "Gestión Empresarial" },
  { id: "math-ai", name: "Mathematics: Applications & Interpretation", nameEs: "Matemáticas: Aplicaciones e Interpretación" },
  { id: "psychology", name: "Psychology", nameEs: "Psicología" },
  { id: "sehs", name: "Sports, Exercise & Health Science", nameEs: "Ciencias del Deporte, el Ejercicio y la Salud" },
  { id: "spanish-b", name: "Spanish B", nameEs: "Español B" },
  { id: "english-a-ll", name: "English A: Language and Literature", nameEs: "Inglés A: Lengua y Literatura" },
];

export type Level = "HL" | "SL" | "HL/SL";
export type Session = "May" | "November";
export type Timezone = "TZ0" | "TZ1" | "TZ2" | "TZ3";
export type Kind = "paper" | "markscheme" | "prerelease";

export interface Detected {
  subject: SubjectId | null;
  level: Level | null;
  year: number | null;
  session: Session | null;
  timezone: Timezone | null;
  paperNumber: number | null;
  kind: Kind;
}

/** Lowercase, strip accents, turn separators into single spaces. */
export function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/[_\-.,()[\]/\\+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SUBJECT_PATTERNS: [SubjectId, RegExp][] = [
  ["spanish-b", /\b(spanish|espanol|lengua) b\b|\bspanish ab initio\b/],
  ["english-a-ll", /\benglish a\b.*\b(lang(uage)?|ll)\b|\blanguage (and|&) literature\b|\blang (and|&)? ?lit\b|\blengua y literatura\b/],
  ["business", /\bbusiness( management)?\b|\bbm\b|\bgestion empresarial\b/],
  ["math-ai", /\bmath(s|ematics)?\b.*\b(applications|app|ai|aplicaciones)\b|\bmaths? ai\b|\bmatematicas\b.*\baplicaciones\b/],
  ["psychology", /\bpsycholog(y|ie)\b|\bpsicologia\b/],
  ["sehs", /\bsehs\b|\bsports?\b.*\bexercise\b|\bciencias del deporte\b/],
];

function detectSubject(s: string): SubjectId | null {
  for (const [id, re] of SUBJECT_PATTERNS) if (re.test(s)) return id;
  return null;
}

function detectLevel(s: string): Level | null {
  const hl = /\b(hl|higher level|ns|nivel superior)\b/.test(s);
  const sl = /\b(sl|standard level|nm|nivel medio)\b/.test(s);
  if (hl && sl) return "HL/SL";
  if (hl) return "HL";
  if (sl) return "SL";
  return null;
}

function detectSessionYear(s: string, strict = false): { session: Session | null; year: number | null } {
  if (strict) {
    // Page text: only trust "May 2023" / "November 2022" / "mayo de 2023" (the word "may" is common English).
    const m = s.match(/\b(may|mayo|november|noviembre)(?: de)? ((?:19|20)\d{2})\b/);
    if (!m) return { session: null, year: null };
    return { session: m[1].startsWith("may") ? "May" : "November", year: Number(m[2]) };
  }
  let session: Session | null = null;
  let year: number | null = null;
  // Short codes like M23 / N22 (common IB style)
  const code = s.match(/\b([mn])(\d{2})\b/);
  if (code) {
    session = code[1] === "m" ? "May" : "November";
    year = 2000 + Number(code[2]);
  }
  const full = s.match(/\b(19|20)(\d{2})\b/);
  if (full) year = Number(full[1] + full[2]);
  if (/\b(may|mayo)\b/.test(s)) session = "May";
  else if (/\b(november|nov|noviembre)\b/.test(s)) session = "November";
  return { session, year };
}

function detectTimezone(s: string): Timezone | null {
  const m = s.match(/\btz ?([0-3])\b|\btime ?zone ([0-3])\b|\bzona horaria ([0-3])\b/);
  if (!m) return null;
  return `TZ${m[1] ?? m[2] ?? m[3]}` as Timezone;
}

function detectPaperNumber(s: string, strict = false): number | null {
  const m = strict ? s.match(/\b(?:paper|prueba) ([1-3])\b/) : s.match(/\b(?:paper|prueba|p)\s?([1-3])\b/);
  return m ? Number(m[1]) : null;
}

function detectKind(s: string, strict = false): Kind {
  const re = strict
    ? /\b(markscheme|mark scheme|marking scheme|esquema de calificacion)\b/
    : /\b(markschemes?|mark scheme|marking scheme|ms|esquema de calificacion|esquema)\b/;
  return re.test(s)
    ? "markscheme"
    : "paper";
}

// Business Management Paper 1 pre-release statement. Page text is only trusted near the top (the title),
// because the Paper 1 exam itself can mention the pre-release statement in its instructions.
const PRERELEASE = /\b(pre ?release(d)?( statement)?|pre ?seen)\b/;
function isPrerelease(s: string, strict = false): boolean {
  return PRERELEASE.test(strict ? s.slice(0, 300) : s);
}

/**
 * IB paper code printed at the top of the pages, e.g. "M24/5/MATAI/SP2/ENG/TZ1/XX" (paper) or
 * ".../TZ1/XX/M" (markscheme): session + year, level (S/H/B), paper number and timezone.
 */
export interface PaperCode {
  subject: SubjectId | null;
  session: Session;
  year: number;
  level: Level | null;
  paperNumber: number | null;
  timezone: Timezone | null;
  markscheme: boolean;
}
const CODE_SUBJECTS: Record<string, SubjectId> = {
  MATAI: "math-ai", MATHAI: "math-ai", BUSMT: "business", BUSMG: "business", PSYCH: "psychology",
  SPEXS: "sehs", SEHS: "sehs", SPANB: "spanish-b", ENGAL: "english-a-ll",
};
export function detectPaperCode(text: string): PaperCode | null {
  const m = text.match(/\b([MN])(\d{2})\s*\/\s*\d\s*\/\s*([A-Z]{2,8})\s*\/\s*([SHB])?P([1-3])\s*\/\s*[A-Z]{3}(?:\s*\/\s*TZ([0-3]))?(?:\s*\/\s*XX)?(\s*\/\s*M\b)?/);
  if (!m) {
    // Question papers print a session number instead, e.g. "2226 – 5218": 22 = May, 88 = November, 26 = 2026.
    const n = text.match(/\b(22|88)(\d{2})\s*[–—-]\s*\d{4}\b/);
    if (!n) return null;
    return { session: n[1] === "22" ? "May" : "November", year: 2000 + Number(n[2]), subject: null, level: null, paperNumber: null, timezone: null, markscheme: false };
  }
  return {
    session: m[1] === "M" ? "May" : "November",
    year: 2000 + Number(m[2]),
    subject: CODE_SUBJECTS[m[3]] ?? null,
    level: m[4] === "S" ? "SL" : m[4] === "H" ? "HL" : m[4] === "B" ? "HL/SL" : null,
    paperNumber: Number(m[5]),
    timezone: m[6] !== undefined ? (`TZ${m[6]}` as Timezone) : null,
    markscheme: Boolean(m[7]),
  };
}

/** Drops the IB licence/copyright page that some downloads put in front of the cover. */
export function withoutLicencePages(pages: string[]): string[] {
  const isLicence = (t: string) =>
    /all rights reserved/i.test(t) && /prior written permission/i.test(t) && !/instructions to (candidates|students)/i.test(t);
  const kept = pages.filter((t) => !isLicence(t));
  return kept.length ? kept : pages;
}

/** Combine file name (preferred), the IB paper code and first-page text (fallbacks) into one result. */
export function detectPaper(fileName: string, firstPageText = ""): Detected {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const f = normalise(base);
  const t = normalise(firstPageText.slice(0, 2000));
  const code = detectPaperCode(firstPageText);
  const fy = detectSessionYear(f);
  const ty = detectSessionYear(t, true);
  // Markscheme wins over pre-release, which wins over paper. A pre-release statement is always Paper 1.
  const kind: Kind =
    detectKind(f) === "markscheme" || detectKind(t, true) === "markscheme" || code?.markscheme
      ? "markscheme"
      : isPrerelease(f) || isPrerelease(t, true)
        ? "prerelease"
        : "paper";
  return {
    subject: detectSubject(f) ?? code?.subject ?? detectSubject(t),
    level: detectLevel(f) ?? code?.level ?? detectLevel(t),
    year: fy.year ?? code?.year ?? ty.year,
    session: fy.session ?? code?.session ?? ty.session,
    timezone: detectTimezone(f) ?? code?.timezone ?? detectTimezone(t),
    paperNumber: kind === "prerelease" ? 1 : detectPaperNumber(f) ?? code?.paperNumber ?? detectPaperNumber(t, true),
    kind,
  };
}

/** Key used to pair a paper with its markscheme. Pre-release statements must not be matched with it. */
export function pairKey(p: {
  subject: string | null;
  level: string | null;
  year: number | null;
  session: string | null;
  timezone: string | null;
  paper_number: number | null;
}): string {
  return [p.subject, p.level, p.year, p.session, p.timezone ?? "TZ0", p.paper_number].join("|");
}
