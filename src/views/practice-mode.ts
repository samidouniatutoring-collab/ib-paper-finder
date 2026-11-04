import { findPrerelease, loadMyProgress, paperLabel, saveProgress, state, subjectName, type Question } from "../data";
import { tr } from "../i18n";
import { SUBJECTS, type SubjectId } from "../lib/detect";
import { formatClock, parsePracticeSettings, pickPracticeQuestion, practicePool, timerSeconds, type PracticeFilter } from "../lib/practice";
import { TOPIC_MAPS, tagId } from "../lib/topics";
import { loadPaperDoc } from "../pdf";
import { errorText, h, spinner, toast } from "../ui";
import { subjectQuestions, topicName } from "./finder";
import { markschemeFor, pageWidth, prereleaseButton, renderRange, showMarkscheme } from "./viewer";

const choice = { subject: "", topics: [] as string[], paper: "", level: "", includeDone: false };
let timer: number | undefined;

export async function practiceModeView(root: HTMLElement): Promise<void> {
  clearInterval(timer);
  const subject = h("select", { "aria-label": tr("Subject", "Asignatura") }, h("option", { value: "" }, tr("Choose a subject", "Elige una asignatura")),
    ...SUBJECTS.map((s) => h("option", { value: s.id, selected: choice.subject === s.id }, subjectName(s.id))));
  const topicsBox = h("div");
  const paper = h("select", { "aria-label": tr("Paper", "Prueba") }, h("option", { value: "" }, tr("Any paper", "Cualquier prueba")),
    ...["1", "2", "3"].map((n) => h("option", { value: n, selected: choice.paper === n }, `${tr("Paper", "Prueba")} ${n}`)));
  const level = h("select", { "aria-label": tr("Level", "Nivel") }, h("option", { value: "" }, tr("Any level", "Cualquier nivel")),
    ...["HL", "SL"].map((n) => h("option", { value: n, selected: choice.level === n }, n)));
  const includeDone = h("input", { type: "checkbox", checked: choice.includeDone });
  const drawTopics = () => {
    if (!subject.value) return topicsBox.replaceChildren();
    const topics = TOPIC_MAPS[subject.value as SubjectId];
    const groups = new Map<string, typeof topics>();
    for (const t of topics) groups.set(t.group, [...(groups.get(t.group) ?? []), t]);
    topicsBox.replaceChildren(h("fieldset", { class: "stack pick topics-pick" }, h("legend", {}, tr("Topics (none ticked = all)", "Temas (ninguno marcado = todos)")),
      ...[...groups.entries()].map(([g, ts]) => h("div", {}, h("h3", {}, g), ...ts.map((t) => {
        const id = tagId(subject.value, t.code);
        const box = h("input", { type: "checkbox", value: id, checked: choice.topics.includes(id) });
        return h("label", { class: "check" }, box, topicName(t));
      })))));
  };
  subject.addEventListener("change", () => { choice.topics = []; drawTopics(); });
  drawTopics();
  const start = () => {
    if (!subject.value) return toast(tr("Choose a subject.", "Elige una asignatura."), true);
    choice.subject = subject.value;
    choice.topics = [...topicsBox.querySelectorAll<HTMLInputElement>("input:checked")].map((b) => b.value);
    choice.paper = paper.value;
    choice.level = level.value;
    choice.includeDone = includeDone.checked;
    void runSession(root);
  };
  root.replaceChildren(
    h("h1", {}, tr("Practice", "Práctica")),
    h("p", { class: "muted" }, tr("Random questions you haven't done yet, with a timer. Show the markscheme, score yourself, then go to the next one.",
      "Preguntas al azar que aún no has hecho, con cronómetro. Mira el esquema, ponte nota y pasa a la siguiente.")),
    h("div", { class: "card stack" },
      h("div", { class: "row" }, subject, paper, level),
      topicsBox,
      h("label", { class: "check" }, includeDone, tr("Include questions I've already done", "Incluir preguntas ya hechas")),
      h("div", {}, h("button", { class: "btn", onclick: start }, tr("Start", "Empezar"))),
    ),
  );
}

async function runSession(root: HTMLElement): Promise<void> {
  root.replaceChildren(spinner(tr("Loading questions…", "Cargando preguntas…")));
  let qs: Question[];
  let progress: Awaited<ReturnType<typeof loadMyProgress>>;
  try {
    [qs, progress] = await Promise.all([subjectQuestions(choice.subject), loadMyProgress()]);
  } catch (e) {
    root.replaceChildren(h("p", {}, errorText(e)));
    return;
  }
  const filter: PracticeFilter = { topics: choice.topics, paper: choice.paper ? Number(choice.paper) : null, level: choice.level || null, includeDone: choice.includeDone };
  const settings = parsePracticeSettings(state.settings.practice_settings);
  const seen = new Set<string>();
  const done = () => new Set([...progress.values()].filter((p) => p.done).map((p) => p.question_id));
  let count = 0;

  const next = async () => {
    clearInterval(timer);
    const q = pickPracticeQuestion(qs, filter, done(), seen);
    if (!q) {
      root.replaceChildren(h("div", { class: "card" },
        h("h2", {}, count ? tr("That's all for this selection", "No quedan más preguntas en esta selección") : tr("No questions match", "Ninguna pregunta coincide")),
        h("p", { class: "muted" }, count ? `${count} ${tr("questions practised.", "preguntas practicadas.")}` : tr("Try other topics, or include questions you've already done.", "Prueba otros temas o incluye las preguntas ya hechas.")),
        h("button", { class: "btn", onclick: () => void practiceModeView(root) }, tr("Change selection", "Cambiar selección")),
      ));
      return;
    }
    seen.add(q.id);
    count++;
    const left = practicePool(qs, filter, done(), seen).length;
    const total = timerSeconds(q.marks, q.papers!.subject, settings);
    const startedAt = Date.now();
    const clock = h("span", { class: "clock", role: "timer", "aria-live": "off" });
    const tick = () => {
      const elapsed = (Date.now() - startedAt) / 1000;
      if (total == null) clock.textContent = formatClock(elapsed);
      else {
        const rest = total - elapsed;
        clock.textContent = formatClock(rest);
        clock.classList.toggle("clock-over", rest < 0);
      }
    };
    tick();
    timer = window.setInterval(() => { if (!document.body.contains(clock)) clearInterval(timer); else tick(); }, 1000);

    const pages = h("div", { class: "pages" });
    const pre = h("div");
    void findPrerelease(q.papers!).then((p) => { if (p) pre.replaceChildren(prereleaseButton(p)); }).catch(() => 0);
    const msBox = h("div");
    const score = h("input", { type: "number", min: 0, max: q.marks ?? 100, class: "year-input", "aria-label": tr("Your score", "Tu nota") });
    const scorePanel = h("div", { class: "card row", hidden: true },
      h("label", { class: "check" }, tr("Your score", "Tu nota"), score, q.marks != null ? `/ ${q.marks}` : ""),
      h("button", { class: "btn", onclick: async () => {
        try {
          const old = progress.get(q.id);
          const row = { question_id: q.id, done: true, score: score.value === "" ? null : Number(score.value), note: old?.note ?? "" };
          await saveProgress(row);
          progress.set(q.id, row);
          void next();
        } catch (e) {
          toast(errorText(e), true);
        }
      } }, tr("Save and next", "Guardar y siguiente")),
    );
    const showMs = h("button", { class: "btn btn-secondary", onclick: async () => {
      showMs.hidden = true;
      scorePanel.hidden = false;
      clearInterval(timer);
      try {
        await showMarkscheme(msBox, await markschemeFor(q), pageWidth(false));
      } catch (e) {
        msBox.replaceChildren(h("p", { class: "muted" }, errorText(e)));
      }
    } }, tr("Show markscheme", "Ver esquema"));

    root.replaceChildren(
      h("div", { class: "row practice-head" },
        h("button", { class: "btn btn-ghost btn-small", onclick: () => void practiceModeView(root) }, `← ${tr("Change selection", "Cambiar selección")}`),
        h("span", { class: "muted small" }, `${tr("Question", "Pregunta")} ${count} · ${left} ${tr("left", "restantes")}`),
        clock,
      ),
      h("h1", {}, `${subjectName(q.papers!.subject)} · ${paperLabel(q.papers!)} · ${q.page_level ? tr("page", "pág.") + " " + q.start_page : "Q" + q.label}`),
      h("p", { class: "muted" }, `${q.marks != null ? `${q.marks} ${tr("marks", "puntos")} · ` : ""}${total != null ? `${tr("Time", "Tiempo")} ${formatClock(total)}` : tr("Marks unknown: the clock counts up", "Puntos desconocidos: el reloj cuenta hacia arriba")}`),
      pre,
      pages,
      h("div", { class: "row" }, showMs, h("button", { class: "btn btn-ghost", onclick: () => void next() }, tr("Skip", "Saltar"))),
      msBox,
      scorePanel,
    );
    try {
      const doc = await loadPaperDoc(q.papers!.storage_path);
      await renderRange(pages, doc, q.start_page, q.end_page, pageWidth(false));
    } catch (e) {
      pages.replaceChildren(h("p", { class: "muted" }, errorText(e)));
    }
  };
  await next();
}
