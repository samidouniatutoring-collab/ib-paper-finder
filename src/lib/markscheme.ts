// Splits a markscheme by the question numbers of its paper. Pure, no DOM.
import { questionStart } from "./split";

export interface MsStart {
  number: number;
  page: number; // 1-based
  line: number;
  strong: boolean; // "Question 3" / "Pregunta 3" style heading
  part?: boolean; // "1. (a)" / "1a" style: a real answer row, not a numbered instruction like "1 General"
}

const HAS_PART = /^\s*\d{1,2}\s*[.)]?\s*\(?[a-h]\)(?:\s|$)|^\s*\d{1,2}[a-h](?:[\s.):]|$)/;

const STRONG = /^\s*(?:question|pregunta|q)\s*(\d{1,2})\b/i;
// Markscheme table rows often start "1a", "1 a)", "1.a" or "1(a)".
// A bare number followed by a capitalised word ("3 Map drawn") also counts; a page number alone doesn't.
const PART = /^\s*(\d{1,2})(?:\s*[.]?\s*\(?[a-h]\)?(?:[\s.):]|$)|\s+(?=[A-ZÁÉÍÓÚÑ]))/;

// "Question 1 continued" / "Pregunta 1 (continuación)" sits at the top of every extra page of a long question.
// It marks a continuation, never where the question starts.
const CONTINUED = /\b(continued|cont\.|continuaci[oó]n|contin[uú]a)\b/i;

export function msLineStart(line: string): { number: number; strong: boolean } | null {
  if (CONTINUED.test(line)) return null;
  const s = line.match(STRONG);
  if (s) {
    const n = Number(s[1]);
    return n >= 1 && n <= 60 ? { number: n, strong: true } : null;
  }
  const n = questionStart(line);
  if (n !== null) return { number: n, strong: false };
  const p = line.match(PART);
  if (p) {
    const m = Number(p[1]);
    return m >= 1 && m <= 60 ? { number: m, strong: false } : null;
  }
  return null;
}

export function msStarts(pages: string[]): MsStart[] {
  const out: MsStart[] = [];
  pages.forEach((text, pi) =>
    text.split(/\r?\n/).forEach((line, li) => {
      const s = msLineStart(line);
      if (s) out.push({ ...s, part: HAS_PART.test(line), page: pi + 1, line: li });
    }),
  );
  return out;
}

/**
 * Picks the longest run of starts that follows the paper's question numbers in order (skipping at most one
 * missing number at a time). On a tie the run with more "1. (a)"-style answer rows wins, then the run spread over
 * more pages (numbered instructions at the front sit on one page), then the earlier one.
 * "Question N" headings are used alone when they cover at least half of the questions.
 */
const pagesOf = (run: MsStart[]) => new Set(run.map((s) => s.page)).size;
const partsOf = (run: MsStart[]) => run.filter((s) => s.part).length;

function bestRun(cands: MsStart[], numbers: number[]): MsStart[] {
  let best: MsStart[] = [];
  for (let i = 0; i < cands.length; i++) {
    let k = numbers.indexOf(cands[i].number);
    if (k < 0) continue;
    const run = [cands[i]];
    for (let j = i + 1; j < cands.length; j++) {
      const n = cands[j].number;
      if (n === numbers[k + 1] || (n === numbers[k + 2] && numbers[k + 2] !== undefined)) {
        k = numbers.indexOf(n, k + 1);
        run.push(cands[j]);
      }
    }
    // Longer run wins; on a tie, the run made of real answer rows ("1. (a)") beats numbered instructions
    // ("1 General"), then the run spread over more pages.
    if (
      run.length > best.length ||
      (run.length === best.length && (partsOf(run) > partsOf(best) || (partsOf(run) === partsOf(best) && pagesOf(run) > pagesOf(best))))
    ) best = run;
  }
  return best;
}

export interface MsRange {
  start: number;
  end: number;
}

/** Page range of each paper question in the markscheme. Questions that weren't found are left out. */
export function splitMarkscheme(pages: string[], questionNumbers: number[]): Map<number, MsRange> {
  const numbers = [...new Set(questionNumbers)].sort((a, b) => a - b);
  const out = new Map<number, MsRange>();
  if (!numbers.length || !pages.length) return out;
  const all = msStarts(pages);
  const strong = all.filter((s) => s.strong);
  let run = bestRun(strong, numbers);
  // "Question N" headings win only if they cover half the questions and the plain run isn't longer or more
  // spread out: markband pages list "Question 1: Knowledge…", "Question 2: Application…" all on one page.
  const plain = bestRun(all, numbers);
  if (run.length < Math.max(1, Math.ceil(numbers.length / 2)) || plain.length > run.length || pagesOf(plain) > pagesOf(run)) run = plain;
  run.forEach((s, i) => {
    const next = run[i + 1];
    let end = next ? next.page : pages.length;
    if (next && next.line === 0 && next.page > s.page) end = next.page - 1;
    out.set(s.number, { start: s.page, end: Math.max(s.page, end) });
  });
  // Multiple-choice answer grids ("1.  A   16.  B"): every number on a grid line is answered on that page.
  for (const [n, page] of answerGrid(pages)) if (numbers.includes(n) && !out.has(n)) out.set(n, { start: page, end: page });
  return out;
}

const GRID_LINE = /^\s*(?:\d{1,2}\s*[.)]?\s+[A-D]\s*)+$/;
/** Question number → page for multiple-choice answer grids (lines made only of "N. X" pairs). */
export function answerGrid(pages: string[]): Map<number, number> {
  const out = new Map<number, number>();
  pages.forEach((text, pi) => {
    const lines = text.split(/\r?\n/).filter((l) => GRID_LINE.test(l));
    if (lines.length < 3) return;
    for (const l of lines) for (const m of l.matchAll(/(\d{1,2})\s*[.)]?\s+[A-D](?=\s|$)/g)) if (!out.has(Number(m[1]))) out.set(Number(m[1]), pi + 1);
  });
  return out;
}
