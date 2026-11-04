// Splits a search snippet marked with ⟦ ⟧ (from Postgres ts_headline) into plain and highlighted parts. Pure.
export function snippetParts(s: string): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  const re = /⟦([^⟧]*)⟧/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push({ text: s.slice(last, m.index), hit: false });
    out.push({ text: m[1], hit: true });
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last).replace(/[⟦⟧]/g, ""), hit: false });
  return out.map((p) => ({ ...p, text: p.text.replace(/\s+/g, " ") })).filter((p) => p.text);
}

/** Text safe to store in Postgres (no NUL characters), trimmed to a sane size. */
export function cleanBody(text: string): string {
  return text.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").trim().slice(0, 20000);
}
