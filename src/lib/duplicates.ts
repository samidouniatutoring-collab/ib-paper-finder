// Finds papers that are the same exam uploaded twice (e.g. a scan and a normal PDF of the same paper) by
// comparing their text, not just their details. On real IB papers, copies overlap 0.66–0.95 and different
// papers from the same session 0.17–0.27, so 0.5 is a safe line. Pure, no DOM.

export interface DupCandidate {
  id: string;
  kind: string;
  subject: string | null;
  level: string | null;
  year: number | null;
  session: string | null;
  timezone: string | null;
  paper_number: number | null;
  paper_part?: string | null;
  original_name: string;
}

export const SAME_PAPER = 0.5;

export function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-zà-ÿ]{4,}/g) ?? []);
}

export function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

/** Papers that could be the same exam: same subject, level, year, session and paper; timezone equal or unknown. */
export function couldMatch(a: DupCandidate, b: DupCandidate): boolean {
  return a.kind === b.kind && a.subject === b.subject && a.level === b.level && a.year === b.year && a.session === b.session &&
    a.paper_number === b.paper_number && (a.paper_part ?? null) === (b.paper_part ?? null) && (a.timezone === b.timezone || !a.timezone || !b.timezone);
}

/** Of two copies, keep the one with a known timezone, then the one with more text (scans read worse), then the older. */
function better<T extends DupCandidate>(a: T, b: T, size: (p: T) => number): T {
  if (!!a.timezone !== !!b.timezone) return a.timezone ? a : b;
  if (size(a) !== size(b)) return size(a) > size(b) ? a : b;
  return a.id < b.id ? a : b;
}

/** Map of duplicate paper id → the copy to keep. */
export function findDuplicates<T extends DupCandidate>(papers: T[], textOf: Map<string, string>): Map<string, T> {
  const bag = new Map(papers.map((p) => [p.id, words(textOf.get(p.id) ?? "")]));
  const size = (p: T) => bag.get(p.id)?.size ?? 0;
  const dup = new Map<string, T>();
  for (let i = 0; i < papers.length; i++) {
    for (let j = i + 1; j < papers.length; j++) {
      const a = papers[i], b = papers[j];
      if (!couldMatch(a, b) || overlap(bag.get(a.id)!, bag.get(b.id)!) < SAME_PAPER) continue;
      const keep = better(a, b, size);
      const drop = keep === a ? b : a;
      if (!dup.has(keep.id)) dup.set(drop.id, keep);
    }
  }
  return dup;
}
