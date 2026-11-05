// Full-paper practice: the whole paper with the official exam time, then the whole markscheme and a score out of the total.
import { db, findMarkscheme, findPrerelease, loadPaper, paperLabel, subjectName } from "../data";
import { tr } from "../i18n";
import { COURSES } from "../lib/courses";
import type { SubjectId } from "../lib/detect";
import { formatClock } from "../lib/practice";
import { loadPaperDoc } from "../pdf";
import { h, spinner } from "../ui";
import { pageWidth, prereleaseButton, renderRange } from "./viewer";

let timer: ReturnType<typeof setInterval> | undefined;

export async function fullPaperView(root: HTMLElement, id: string): Promise<void> {
  clearInterval(timer);
  root.replaceChildren(spinner(tr("Opening…", "Abriendo…")));
  const p = await loadPaper(id);
  const [ms, pre, marksRes] = await Promise.all([
    findMarkscheme(p).catch(() => null),
    findPrerelease(p).catch(() => null),
    db().from("questions").select("marks").eq("paper_id", p.id),
  ]);
  const totalMarks = (marksRes.data ?? []).reduce((a: number, q: { marks: number | null }) => a + (q.marks ?? 0), 0) || null;
  const minutes = p.subject && p.paper_number ? COURSES[p.subject as SubjectId]?.examMinutes[p.paper_number] : undefined;
  const total = minutes ? minutes * 60 : null;

  const clock = h("span", { class: "clock", role: "timer", "aria-live": "off" });
  let startedAt = 0;
  let pausedAt = 0;
  let pausedFor = 0;
  const tick = () => {
    const elapsed = ((pausedAt || Date.now()) - startedAt - pausedFor) / 1000;
    if (total == null) clock.textContent = formatClock(elapsed);
    else {
      clock.textContent = formatClock(total - elapsed);
      clock.classList.toggle("clock-over", total - elapsed < 0);
    }
  };
  const pages = h("div", { class: "pages" });
  const msBox = h("div", { class: "pages" });
  const score = h("input", { type: "number", min: 0, max: totalMarks ?? undefined, class: "year-input", "aria-label": tr("Your score", "Tu nota") });
  const result = h("span", { class: "muted" });
  score.addEventListener("input", () => {
    const n = Number(score.value);
    result.textContent = totalMarks && score.value !== "" ? `${Math.round((n / totalMarks) * 100)}%` : "";
  });
  const pause = h("button", { class: "btn btn-small btn-secondary" }, tr("Pause", "Pausa"));
  pause.addEventListener("click", () => {
    if (pausedAt) { pausedFor += Date.now() - pausedAt; pausedAt = 0; pause.textContent = tr("Pause", "Pausa"); }
    else { pausedAt = Date.now(); pause.textContent = tr("Resume", "Seguir"); }
    tick();
  });
  const showMs = h("button", { class: "btn" }, tr("Finish and show markscheme", "Terminar y ver el esquema"));
  showMs.addEventListener("click", async () => {
    clearInterval(timer);
    showMs.disabled = true;
    if (!ms) {
      msBox.replaceChildren(h("p", { class: "muted" }, tr("This paper has no markscheme in the library yet.", "Este examen aún no tiene esquema en la biblioteca.")));
      return;
    }
    msBox.replaceChildren(spinner(tr("Opening markscheme…", "Abriendo esquema…")));
    const msDoc = await loadPaperDoc(ms.storage_path);
    await renderRange(msBox, msDoc, 1, msDoc.numPages, pageWidth(false));
    scoreRow.hidden = false;
    scoreRow.scrollIntoView({ behavior: "smooth" });
  });
  const scoreRow = h("div", { class: "card row", hidden: true },
    h("strong", {}, tr("Your score", "Tu nota")), score, totalMarks ? `/ ${totalMarks}` : "", result);

  root.replaceChildren(
    h("div", { class: "row", style: "justify-content: space-between" },
      h("a", { href: "#/" }, `← ${tr("Full papers", "Exámenes completos")}`),
      h("div", { class: "row" }, pause, clock)),
    h("h1", {}, `${subjectName(p.subject)} · ${paperLabel(p)}`),
    h("p", { class: "muted" },
      [totalMarks ? `${totalMarks} ${tr("marks", "puntos")}` : "", minutes ? `${tr("Time", "Tiempo")} ${formatClock(minutes * 60)}` : tr("No official time set: the clock counts up", "Sin tiempo oficial: el reloj cuenta hacia arriba")].filter(Boolean).join(" · ")),
    pre ? prereleaseButton(pre) : "",
    pages,
    h("div", { class: "card" }, showMs),
    scoreRow,
    msBox,
  );
  const doc = await loadPaperDoc(p.storage_path);
  await renderRange(pages, doc, 1, doc.numPages, pageWidth(false));
  startedAt = Date.now();
  tick();
  timer = setInterval(tick, 1000);
}
window.addEventListener("hashchange", () => clearInterval(timer));
