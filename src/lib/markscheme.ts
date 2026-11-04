// Splits a markscheme by the question numbers of its paper. Pure, no DOM.
import { questionStart } from "./split";

export interface MsStart {
  number: number;
  page: number; // 1-based
  line: number;
  strong: boolean; // "Question 3" / "Pregunta 3" style heading
}

const STRONG = /^\s*(?:question|pregunta|q)\s*(\d{1,2})\b/i;
// Markscheme table rows often start "1a", "1 a)", "1.a" or "1(a)".
// A bare number followed by a capitalised word ("3 Map drawn") also counts; a page number alone doesn't.
const PART = /^\s*(\d{1,2})(?:\s*[.]?\s*\(?[a-h]\)?(?:[\s.):]|$)|\s+(?=[A-ZÁÉÍÓÚÑ]))/;

export function msLineStart(line: string): { number: number; strong: boolean } | null {
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
      if (s) out.push({ ...s, page: pi + 1, line: li });
    }),
  );
  return out;
}

/**
 * Picks the longest run of starts that follows the paper's question numbers in order (skipping at most one
 * missing number at a time). On a tie the run spread over more pages wins (numbered instructions at the
 * front sit on one page), then the earlier one.
 * "Question N" headings are used alone when they cover at least half of the questions.
 */
const pagesOf = (run: MsStart[]) => new Set(run.map((s) => s.page)).size;

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
    if (run.length > best.length || (run.length === best.length && pagesOf(run) > pagesOf(best))) best = run;
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
  if (run.length < Math.max(1, Math.ceil(numbers.length / 2))) run = bestRun(all, numbers);
  run.forEach((s, i) => {
    const next = run[i + 1];
    let end = next ? next.page : pages.length;
    if (next && next.line === 0 && next.page > s.page) end = next.page - 1;
    out.set(s.number, { start: s.page, end: Math.max(s.page, end) });
  });
  return out;
}
