import { loadMyProgress, subjectName } from "../data";
import { tr } from "../i18n";
import { SUBJECTS, type SubjectId } from "../lib/detect";
import { TOPIC_MAPS, tagId } from "../lib/topics";
import { h, spinner } from "../ui";
import { subjectQuestions, topicName } from "./finder";

export async function progressView(root: HTMLElement): Promise<void> {
  root.replaceChildren(spinner(tr("Loading…", "Cargando…")));
  const progress = await loadMyProgress();
  const sections: HTMLElement[] = [];
  for (const s of SUBJECTS) {
    const qs = await subjectQuestions(s.id);
    if (!qs.some((q) => progress.has(q.id))) continue;
    const rows = TOPIC_MAPS[s.id as SubjectId].map((t) => {
      const tagged = qs.filter((q) => q.question_tags?.some((x) => x.topic === tagId(s.id, t.code)));
      const done = tagged.filter((q) => progress.get(q.id)?.done);
      const scored = done.filter((q) => q.marks && progress.get(q.id)?.score != null);
      const pct = scored.length
        ? Math.round((100 * scored.reduce((a, q) => a + (progress.get(q.id)!.score ?? 0), 0)) / scored.reduce((a, q) => a + (q.marks ?? 0), 0))
        : null;
      return { t, total: tagged.length, done: done.length, pct };
    }).filter((r) => r.total);
    sections.push(h("section", { class: "card" }, h("h2", {}, subjectName(s.id)),
      h("table", { class: "progress-table" },
        h("thead", {}, h("tr", {}, h("th", {}, tr("Topic", "Tema")), h("th", {}, tr("Done", "Hechas")), h("th", {}, tr("Average score", "Nota media")))),
        h("tbody", {}, ...rows.map((r) => h("tr", {},
          h("td", {}, topicName(r.t)),
          h("td", {}, h("meter", { min: 0, max: r.total, value: r.done }), ` ${r.done}/${r.total}`),
          h("td", {}, r.pct == null ? "—" : `${r.pct}%`),
        ))),
      ),
    ));
  }
  root.replaceChildren(
    h("h1", {}, tr("My progress", "Mi progreso")),
    h("p", { class: "muted" }, tr("Only you can see your progress.", "Solo tú puedes ver tu progreso.")),
    ...(sections.length ? sections : [h("p", { class: "muted" }, tr("Mark questions as done to see your progress here.", "Marca preguntas como hechas para ver tu progreso aquí."))]),
  );
}
