// Keyword-based topic tagging. Pure, no DOM.
import type { Topic } from "./topics";

export interface TagResult {
  code: string;
  confidence: number; // 0..1
}

export function tagText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‐-―-]/g, " ")
    .replace(/\s+/g, " ");
}

const cache = new Map<string, RegExp>();
function keywordRe(k: string): RegExp {
  let re = cache.get(k);
  if (!re) {
    const esc = tagText(k).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(^|[^a-z0-9])${esc}(?=[^a-z0-9]|$)`);
    cache.set(k, re);
  }
  return re;
}

export function confidenceHint(c: number): "high" | "medium" | "low" {
  return c >= 0.75 ? "high" : c >= 0.5 ? "medium" : "low";
}

/** How sure the automatic tagger is that a question is on a topic (not difficulty). */
export function matchLabel(hint: "high" | "medium" | "low" | "owner", es = false): string {
  return es
    ? { high: "encaje fuerte", medium: "encaje probable", low: "encaje débil", owner: "revisado" }[hint]
    : { high: "strong match", medium: "likely match", low: "weak match", owner: "checked by you" }[hint];
}

/**
 * Scores each topic: every distinct keyword found adds 1 (multi-word keywords add 2, strong keywords 3).
 * Returns up to `max` (default 4) keyword topics (plus any marks-based topics such as SAQ/ERQ).
 */
export function tagQuestion(
  text: string,
  topics: Topic[],
  opts: { paperNumber?: number | null; marks?: number | null; pageLevel?: boolean; max?: number } = {},
): TagResult[] {
  const t = tagText(text);
  const scored: { code: string; group: string; score: number }[] = [];
  const byMarks: TagResult[] = [];
  for (const topic of topics) {
    if (topic.papers && opts.paperNumber && !topic.papers.includes(opts.paperNumber)) continue;
    if (topic.marks) {
      const [min, max] = topic.marks;
      if (opts.marks != null && opts.marks >= min && opts.marks <= max) byMarks.push({ code: topic.code, confidence: 0.8 });
      continue;
    }
    let score = 0;
    for (const k of topic.keywords) if (keywordRe(k).test(t)) score += k.trim().includes(" ") ? 2 : 1;
    // Strong keywords name the topic outright ("integral", "simultaneous equations"): one is enough for a strong match.
    for (const k of topic.strong ?? []) if (keywordRe(k).test(t)) score += 3;
    for (const g of topic.together ?? []) if (g.every((k) => keywordRe(k).test(t))) score += 3;
    if (score > 0) scored.push({ code: topic.code, group: topic.group, score });
  }
  scored.sort((a, b) => b.score - a.score);
  // Groups are separate dimensions (e.g. a unit vs. a toolkit tool), so compare scores within a group.
  const groupTop = new Map<string, number>();
  for (const s of scored) groupTop.set(s.group, Math.max(groupTop.get(s.group) ?? 0, s.score));
  const factor = opts.pageLevel ? 0.7 : 1;
  const out = scored
    .filter((s) => s.score >= (groupTop.get(s.group) ?? 0) / 2)
    .slice(0, opts.max ?? 4)
    .map((s) => ({ code: s.code, confidence: Math.round(Math.min(0.95, 0.25 + 0.2 * s.score) * factor * 100) / 100 }));
  return [...out, ...byMarks];
}
