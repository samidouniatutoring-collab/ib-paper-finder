import { loadMyProgress, loadPrereleases, loadSubjectQuestions, paperLabel, type Paper, subjectName, type Progress, type Question } from "../data";
import { lang, tr } from "../i18n";
import { pairKey, SUBJECTS, type SubjectId } from "../lib/detect";
import { confidenceHint } from "../lib/tagger";
import { TOPIC_MAPS, tagId, type Topic } from "../lib/topics";
import { practiceBar, selection } from "./practice";
import { h, spinner } from "../ui";
import { homeworkBanner } from "./homework";
import { offlineFiles } from "../offline";

const filters = { subject: "" as string, topic: "" as string, paper: "", level: "", from: "", to: "", hideLow: false };
const cache = new Map<string, Question[]>();
const preCache = new Map<string, Map<string, Paper>>();

export function topicName(t: Topic): string {
  return lang === "es" && t.nameEs ? t.nameEs : t.name;
}

export async function subjectQuestions(subject: string): Promise<Question[]> {
  if (!cache.has(subject)) cache.set(subject, await loadSubjectQuestions(subject));
  return cache.get(subject)!;
}
/** Pre-release statements of a subject by their Paper 1 key (one request per subject). */
async function subjectPrereleases(subject: string): Promise<Map<string, Paper>> {
  if (!preCache.has(subject)) {
    const list = await loadPrereleases(subject).catch(() => [] as Paper[]);
    preCache.set(subject, new Map(list.map((p) => [pairKey({ ...p, paper_number: 1 }), p])));
  }
  return preCache.get(subject)!;
}
export function clearQuestionCache(): void {
  cache.clear();
  preCache.clear();
}

export async function finderView(root: HTMLElement): Promise<void> {
  const subjectSelect = h("select", { "aria-label": tr("Subject", "Asignatura") },
    h("option", { value: "" }, tr("Choose a subject", "Elige una asignatura")),
    ...SUBJECTS.map((s) => h("option", { value: s.id, selected: filters.subject === s.id }, subjectName(s.id))),
  );
  const body = h("div");
  subjectSelect.addEventListener("change", () => {
    filters.subject = subjectSelect.value;
    filters.topic = "";
    void renderSubject(body);
  });
  const banner = h("div");
  void homeworkBanner().then((b) => banner.replaceChildren(b));
  root.replaceChildren(banner, h("h1", {}, tr("Find questions by topic", "Buscar preguntas por tema")), h("div", { class: "row" }, subjectSelect), body, practiceBar());
  await renderSubject(body);
}

async function renderSubject(body: HTMLElement): Promise<void> {
  if (!filters.subject) {
    body.replaceChildren(h("p", { class: "muted" }, tr("Pick a subject to see its syllabus topics.", "Elige una asignatura para ver los temas del programa.")));
    return;
  }
  body.replaceChildren(spinner(tr("Loading questions…", "Cargando preguntas…")));
  const [questions, progress, pre] = await Promise.all([subjectQuestions(filters.subject), loadMyProgress(), subjectPrereleases(filters.subject)]);
  const topics = TOPIC_MAPS[filters.subject as SubjectId];
  const side = h("nav", { class: "topics card" });
  const list = h("div", { class: "questions" });
  const draw = () => {
    side.replaceChildren(...topicList(topics, questions, progress, draw));
    list.replaceChildren(...questionList(questions, progress, topics, draw, pre));
  };
  draw();
  body.replaceChildren(h("div", { class: "finder" }, side, list));
}

function tagsFor(q: Question, code: string) {
  return (q.question_tags ?? []).find((t) => t.topic === tagId(filters.subject, code));
}

function topicList(topics: Topic[], qs: Question[], progress: Map<string, Progress>, redraw: () => void): HTMLElement[] {
  const groups = new Map<string, Topic[]>();
  for (const t of topics) groups.set(t.group, [...(groups.get(t.group) ?? []), t]);
  return [...groups.entries()].map(([group, ts]) =>
    h("div", { class: "topic-group" }, h("h3", {}, group),
      ...ts.map((t) => {
        const matching = qs.filter((q) => tagsFor(q, t.code));
        const done = matching.filter((q) => progress.get(q.id)?.done).length;
        return h("button", {
          class: `topic${filters.topic === t.code ? " active" : ""}`,
          onclick: () => { filters.topic = t.code; redraw(); },
        }, h("span", {}, `${t.code.includes(".") && /^\d/.test(t.code) ? t.code + " " : ""}${topicName(t)}`), h("span", { class: "muted small" }, matching.length ? `${done}/${matching.length}` : "0"));
      }),
    ),
  );
}

function questionList(qs: Question[], progress: Map<string, Progress>, topics: Topic[], redraw: () => void, pre: Map<string, Paper>): HTMLElement[] {
  if (!filters.topic) return [h("p", { class: "muted" }, tr("Choose a topic.", "Elige un tema."))];
  const topic = topics.find((t) => t.code === filters.topic)!;
  const input = (key: "from" | "to", ph: string) => {
    const el = h("input", { type: "number", placeholder: ph, value: filters[key], class: "year-input", "aria-label": ph });
    el.addEventListener("change", () => { filters[key] = el.value; redraw(); });
    return el;
  };
  const sel = (key: "paper" | "level", label: string, opts: string[]) => {
    const el = h("select", { "aria-label": label }, h("option", { value: "" }, label), ...opts.map((o) => h("option", { value: o, selected: filters[key] === o }, o)));
    el.addEventListener("change", () => { filters[key] = el.value; redraw(); });
    return el;
  };
  const low = h("input", { type: "checkbox", checked: filters.hideLow });
  low.addEventListener("change", () => { filters.hideLow = low.checked; redraw(); });

  const matches = qs
    .map((q) => ({ q, tag: tagsFor(q, topic.code) }))
    .filter(({ q, tag }) => {
      const p = q.papers!;
      if (!tag) return false;
      if (filters.hideLow && tag.source === "auto" && confidenceHint(tag.confidence) === "low") return false;
      if (filters.paper && String(p.paper_number) !== filters.paper) return false;
      if (filters.level && !(p.level ?? "").includes(filters.level)) return false;
      if (filters.from && (p.year ?? 0) < Number(filters.from)) return false;
      if (filters.to && (p.year ?? 9999) > Number(filters.to)) return false;
      return true;
    })
    .sort((a, b) => (b.q.papers!.year ?? 0) - (a.q.papers!.year ?? 0) || a.q.number - b.q.number);

  return [
    h("h2", {}, topicName(topic)),
    h("div", { class: "row filters" },
      sel("paper", tr("Any paper", "Cualquier prueba"), ["1", "2", "3"]),
      sel("level", tr("Any level", "Cualquier nivel"), ["HL", "SL"]),
      input("from", tr("From year", "Desde")),
      input("to", tr("To year", "Hasta")),
      h("label", { class: "check" }, low, tr("Hide low-confidence", "Ocultar baja confianza")),
    ),
    matches.length
      ? h("ul", { class: "qlist" }, ...matches.map(({ q, tag }) => {
          const box = h("input", { type: "checkbox", checked: selection.has(q.id), "aria-label": tr("Add to practice set", "Añadir a la práctica") });
          box.addEventListener("change", () => {
            if (box.checked) selection.set(q.id, q);
            else selection.delete(q.id);
            practiceBar();
          });
          const hint = tag!.source === "owner" ? "owner" : confidenceHint(tag!.confidence);
          const pr = progress.get(q.id);
          const statement = q.papers!.paper_number === 1 ? pre.get(pairKey(q.papers!)) : undefined;
          return h("li", { class: "qrow" }, box,
            h("a", { href: `#/q/${q.id}` },
              h("strong", {}, `${paperLabel(q.papers!)} · ${q.page_level ? tr("page", "pág.") + " " + q.start_page : "Q" + q.label}`),
              h("span", { class: "muted small" }, ` · ${q.marks != null ? `${q.marks} ${tr("marks", "puntos")}` : ""}`),
            ),
            h("span", { class: `badge conf-${hint}`, title: tr("How sure the tag is", "Seguridad de la etiqueta") }, hint === "owner" ? tr("checked", "revisado") : tr(hint, { high: "alta", medium: "media", low: "baja" }[hint])),
            offlineFiles.has(q.papers!.storage_path) ? h("span", { class: "badge badge-offline" }, tr("Offline", "Sin conexión")) : "",
            pr?.done ? h("span", { class: "badge badge-ok" }, pr.score != null ? `✓ ${pr.score}${q.marks ? "/" + q.marks : ""}` : "✓") : "",
            statement ? h("a", { class: "btn btn-small btn-secondary", href: `#/paper/${statement.id}`, target: "_blank", rel: "noopener" }, tr("Open pre-release statement", "Abrir declaración de pre-publicación")) : "",
          );
        }))
      : h("p", { class: "muted" }, tr("No questions match.", "Ninguna pregunta coincide.")),
  ];
}
