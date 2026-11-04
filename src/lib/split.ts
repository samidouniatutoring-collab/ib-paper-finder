// Splits a paper's page texts into questions. Pure, no DOM.

export interface SplitQuestion {
  number: number;
  label: string;
  startPage: number; // 1-based
  endPage: number;
  marks: number | null;
  pageLevel: boolean;
  text: string; // used for tagging, and stored (in Supabase only) for search
}

// A line that starts a question: "1.", "2 (a)", "2(a)", "Question 3", "Pregunta 4", "3)"
const START = /^\s*(?:(?:question|pregunta|q)\s*(\d{1,2})\b|(\d{1,2})\s*(?:\.(?!\d)|\)|(?=\s*\([a-z]\))))/i;
const MARKS = /\[\s*(\d{1,2})\s*(?:marks?|puntos?|points?)?\s*\]|\(\s*(\d{1,2})\s*(?:marks?|puntos?)\s*\)/gi;
const TOTAL = /\[\s*(?:total|max(?:imum)?)\s*:?\s*(\d{1,3})\s*(?:marks?|puntos?)?\s*\]/i;

export function questionStart(line: string): number | null {
  const m = line.match(START);
  if (!m) return null;
  const n = Number(m[1] ?? m[2]);
  return n >= 1 && n <= 60 ? n : null;
}

/** Sum the marks in a block of text; a "[Total: N]" wins if present. */
export function detectMarks(text: string): number | null {
  const total = text.match(TOTAL);
  if (total) return Number(total[1]);
  let sum = 0;
  let found = false;
  for (const m of text.matchAll(MARKS)) {
    sum += Number(m[1] ?? m[2]);
    found = true;
  }
  return found ? sum : null;
}

/**
 * Finds question starts in order (1, 2, 3, ...). A number only counts if it is the next expected one,
 * so numbered lists inside a question don't break the split. Falls back to one item per page when
 * fewer than two questions are found.
 */
export function splitQuestions(pages: string[]): SplitQuestion[] {
  const starts: { number: number; page: number; line: number }[] = [];
  let expected = 1;
  pages.forEach((text, pi) => {
    text.split(/\r?\n/).forEach((line, li) => {
      const n = questionStart(line);
      if (n === null) return;
      // Allow the first question found to be any small number (some papers start at a later section).
      if (n === expected || (starts.length === 0 && n <= 3)) {
        starts.push({ number: n, page: pi + 1, line: li });
        expected = n + 1;
      }
    });
  });

  if (starts.length < 2) {
    return pages.map((text, i) => ({
      number: i + 1,
      label: `p. ${i + 1}`,
      startPage: i + 1,
      endPage: i + 1,
      marks: detectMarks(text),
      pageLevel: true,
      text,
    }));
  }

  return starts.map((s, i) => {
    const next = starts[i + 1];
    // A question ends on the page where the next one starts (or the page before, if the next starts at the top).
    let endPage = next ? next.page : pages.length;
    if (next && next.line === 0 && next.page > s.page) endPage = next.page - 1;
    const text = collect(pages, s, next);
    return {
      number: s.number,
      label: String(s.number),
      startPage: s.page,
      endPage: Math.max(s.page, endPage),
      marks: detectMarks(text),
      pageLevel: false,
      text,
    };
  });
}

function collect(
  pages: string[],
  from: { page: number; line: number },
  to?: { page: number; line: number },
): string {
  const out: string[] = [];
  for (let p = from.page; p <= (to ? to.page : pages.length); p++) {
    const lines = pages[p - 1].split(/\r?\n/);
    const a = p === from.page ? from.line : 0;
    const b = to && p === to.page ? to.line : lines.length;
    out.push(lines.slice(a, b).join("\n"));
  }
  return out.join("\n");
}
