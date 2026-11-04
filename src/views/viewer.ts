import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { db, isOwner, loadPaper, loadQuestion, markschemeFor, saveMarkschemeRange, type MarkschemePart, loadMyProgress, paperLabel, saveProgress, subjectName, watermarkText, type Paper, type Question, type Tag } from "../data";
import { tr } from "../i18n";
import type { SubjectId } from "../lib/detect";
import { confidenceHint } from "../lib/tagger";
export { markschemeFor } from "../data";
import { TOPIC_MAPS, findTopic, tagId } from "../lib/topics";
import { offlineFiles } from "../offline";
import { loadPaperDoc, renderPage } from "../pdf";
import { errorText, h, spinner, toast } from "../ui";
import { clearQuestionCache, topicName } from "./finder";

export function pageWidth(sideBySide: boolean): number {
  const w = Math.min(window.innerWidth, 1400) - 48;
  return Math.max(280, Math.min(900, sideBySide && window.innerWidth >= 1000 ? w / 2 - 16 : w));
}

export async function renderRange(el: HTMLElement, doc: PDFDocumentProxy, from: number, to: number, width: number): Promise<void> {
  el.replaceChildren();
  for (let i = from; i <= Math.min(to, doc.numPages); i++) el.append(await renderPage(doc, i, width, watermarkText()));
}

export async function paperView(root: HTMLElement, id: string): Promise<void> {
  root.replaceChildren(spinner(tr("Opening…", "Abriendo…")));
  const p = await loadPaper(id);
  const pages = h("div", { class: "pages" });
  const badge = h("p");
  root.replaceChildren(
    h("p", {}, h("a", { href: "#/library" }, `← ${tr("Library", "Biblioteca")}`)),
    h("h1", {}, `${subjectName(p.subject)} · ${paperLabel(p)}${p.kind === "markscheme" ? " · " + tr("Markscheme", "Esquema") : ""}`),
    badge,
    pages,
  );
  const doc = await loadPaperDoc(p.storage_path);
  badge.replaceChildren(offlineBadge(offlineFiles.has(p.storage_path)));
  await renderRange(pages, doc, 1, doc.numPages, pageWidth(false));
}

export async function questionView(root: HTMLElement, id: string): Promise<void> {
  root.replaceChildren(spinner(tr("Opening…", "Abriendo…")));
  const q = await loadQuestion(id);
  const paper = q.papers!;
  const found = await markschemeFor(q);
  const left = h("div", { class: "pages" });
  const right = h("div", { class: "pages" });
  const badge = h("span");
  root.replaceChildren(
    h("p", {}, h("a", { href: "#/" }, `← ${tr("Finder", "Buscador")}`)),
    h("h1", {}, `${subjectName(paper.subject)} · ${paperLabel(paper)} · ${q.page_level ? tr("page", "pág.") + " " + q.start_page : tr("Question", "Pregunta") + " " + q.label}`),
    h("p", { class: "muted" }, `${tr("Pages", "Páginas")} ${q.start_page}–${q.end_page}${q.marks != null ? ` · ${q.marks} ${tr("marks", "puntos")}` : ""}`, badge),
    tagPanel(q),
    await progressPanel(q),
    h("div", { class: "side-by-side" },
      h("section", {}, h("h2", {}, tr("Question", "Pregunta")), left),
      h("section", {}, h("h2", {}, tr("Markscheme", "Esquema")), right),
    ),
  );
  const width = pageWidth(true);
  const doc = await loadPaperDoc(paper.storage_path);
  await renderRange(left, doc, q.start_page, q.end_page, width);
  await showMarkscheme(right, found, width).catch((e) => right.replaceChildren(h("p", { class: "muted" }, errorText(e))));
  badge.replaceChildren(offlineBadge(offlineFiles.has(paper.storage_path) && (!found || offlineFiles.has(found.ms.storage_path))));
  if (isOwner() && found) right.before(msRangeEditor(q, found, right, width));
}

/** Owner: correct which markscheme pages belong to this question. */
function msRangeEditor(q: Question, part: MarkschemePart, target: HTMLElement, width: number): HTMLElement {
  const max = part.ms.page_count || 999;
  const from = h("input", { type: "number", min: 1, max, value: part.start, class: "page-input", "aria-label": tr("First markscheme page", "Primera página del esquema") });
  const to = h("input", { type: "number", min: 1, max, value: part.end, class: "page-input", "aria-label": tr("Last markscheme page", "Última página del esquema") });
  const label = { owner: tr("set by you", "fijado por ti"), auto: tr("found automatically", "encontrado automáticamente"), split: tr("from the markscheme split", "de la división del esquema"), whole: tr("not found: whole markscheme", "no encontrado: esquema completo") }[part.source];
  const reload = async (p: MarkschemePart | null) => { await showMarkscheme(target, p, width); };
  const save = async () => {
    const a = Number(from.value), b = Number(to.value);
    if (!a || !b || a > b || b > max) return toast(tr("Check the page numbers.", "Revisa los números de página."), true);
    try {
      await saveMarkschemeRange(q, part.ms, { start: a, end: b });
      toast(tr("Saved", "Guardado"));
      await reload({ ...part, start: a, end: b, exact: true, source: "owner" });
    } catch (e) {
      toast(errorText(e), true);
    }
  };
  const reset = async () => {
    try {
      await saveMarkschemeRange(q, part.ms, null);
      toast(tr("Reset", "Restablecido"));
      await reload(await markschemeFor(q));
    } catch (e) {
      toast(errorText(e), true);
    }
  };
  return h("div", { class: "row small ms-editor" },
    h("span", { class: "muted" }, `${tr("Markscheme pages", "Páginas del esquema")} (${label}):`),
    from, "–", to,
    h("button", { class: "btn btn-small", onclick: save }, tr("Save", "Guardar")),
    part.source === "owner" ? h("button", { class: "btn btn-small btn-ghost", onclick: reset }, tr("Reset to automatic", "Volver a automático")) : "",
  );
}

export function offlineBadge(on: boolean): HTMLElement | string {
  return on ? h("span", { class: "badge badge-offline", title: tr("Saved on this device", "Guardado en este dispositivo") }, tr("Available offline", "Disponible sin conexión")) : "";
}

export async function showMarkscheme(el: HTMLElement, part: MarkschemePart | null, width: number): Promise<void> {
  if (!part) {
    el.replaceChildren(h("p", { class: "muted" }, tr("No markscheme in the library for this paper.", "No hay esquema para este examen.")));
    return;
  }
  el.replaceChildren(spinner(tr("Opening…", "Abriendo…")));
  const doc = await loadPaperDoc(part.ms.storage_path);
  const pages = h("div", { class: "pages" });
  await renderRange(pages, doc, part.start, part.end, width);
  el.replaceChildren(
    part.exact ? "" : h("p", { class: "muted small" }, tr("This question wasn't found in the markscheme, so the whole markscheme is shown.", "No se encontró la pregunta en el esquema; se muestra el esquema completo.")),
    pages,
  );
}

function tagPanel(q: Question): HTMLElement {
  const subject = q.papers!.subject as SubjectId | null;
  const el = h("div", { class: "tags" });
  const draw = () => {
    const tags = q.question_tags ?? [];
    el.replaceChildren(
      ...tags.map((t) => {
        const topic = findTopic(t.topic);
        const hint = t.source === "owner" ? tr("checked", "revisado") : tr(confidenceHint(t.confidence), { high: "alta", medium: "media", low: "baja" }[confidenceHint(t.confidence)]);
        return h("span", { class: "chip" }, topic ? topicName(topic) : t.topic, h("span", { class: "muted small" }, ` · ${hint}`),
          isOwner() ? h("button", { class: "chip-x", "aria-label": tr("Remove tag", "Quitar etiqueta"), onclick: () => void remove(t) }, "×") : "");
      }),
      !tags.length ? h("span", { class: "muted small" }, tr("No topic tags yet.", "Aún sin temas.")) : "",
      isOwner() && subject ? addTag(subject) : "",
    );
  };
  const remove = async (t: Tag) => {
    const { error } = await db().from("question_tags").delete().eq("question_id", q.id).eq("topic", t.topic);
    if (error) return toast(errorText(error), true);
    q.question_tags = (q.question_tags ?? []).filter((x) => x.topic !== t.topic);
    clearQuestionCache();
    draw();
  };
  const addTag = (subject: SubjectId) => {
    const sel = h("select", { "aria-label": tr("Add topic", "Añadir tema") }, h("option", { value: "" }, `+ ${tr("Add topic", "Añadir tema")}`),
      ...TOPIC_MAPS[subject].map((t) => h("option", { value: t.code }, `${t.group} — ${topicName(t)}`)));
    sel.addEventListener("change", async () => {
      if (!sel.value) return;
      const row: Tag = { question_id: q.id, topic: tagId(subject, sel.value), confidence: 1, source: "owner" };
      const { error } = await db().from("question_tags").upsert(row);
      if (error) return toast(errorText(error), true);
      q.question_tags = [...(q.question_tags ?? []).filter((x) => x.topic !== row.topic), row];
      clearQuestionCache();
      draw();
    });
    return sel;
  };
  draw();
  return el;
}

async function progressPanel(q: Question): Promise<HTMLElement> {
  const current = (await loadMyProgress()).get(q.id) ?? { question_id: q.id, done: false, score: null, note: "" };
  const done = h("input", { type: "checkbox", checked: current.done });
  const score = h("input", { type: "number", min: 0, max: q.marks ?? 100, value: current.score ?? "", class: "year-input", "aria-label": tr("Score", "Nota") });
  const note = h("textarea", { rows: 2, placeholder: tr("Private note", "Nota privada"), "aria-label": tr("Private note", "Nota privada") });
  note.value = current.note;
  const save = async () => {
    try {
      await saveProgress({ question_id: q.id, done: done.checked, score: score.value === "" ? null : Number(score.value), note: note.value });
      toast(tr("Saved", "Guardado"));
    } catch (e) {
      toast(errorText(e), true);
    }
  };
  return h("div", { class: "card progress-panel" },
    h("label", { class: "check" }, done, tr("Done", "Hecha")),
    h("label", { class: "check" }, tr("Score", "Nota"), score, q.marks != null ? `/ ${q.marks}` : ""),
    note,
    h("button", { class: "btn btn-small", onclick: save }, tr("Save", "Guardar")),
    h("span", { class: "small muted" }, tr("Only you can see this.", "Solo tú puedes verlo.")),
  );
}
