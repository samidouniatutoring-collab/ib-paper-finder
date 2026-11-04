import {
  db, isOwner, loadApprovedStudents, loadAssignments, loadGroups, loadHomework, loadHomeworkAnswers, paperLabel, state, subjectName,
  type HomeworkAnswer, type HomeworkItem, type HomeworkSet, type Profile, type Question,
} from "../data";
import { lang, tr } from "../i18n";
import { expandAssignees, homeworkSummary, type HomeworkSummary } from "../lib/homework";
import { errorText, h, spinner, toast } from "../ui";

export function dueText(d: string | null): string {
  if (!d) return tr("No due date", "Sin fecha de entrega");
  const date = new Date(`${d}T12:00:00`);
  return `${tr("Due", "Entrega")} ${date.toLocaleDateString(lang === "es" ? "es-ES" : "en-GB", { weekday: "short", day: "numeric", month: "short" })}`;
}

function statusBadge(s: HomeworkSummary): HTMLElement {
  const label = { not_started: tr("Not started", "Sin empezar"), in_progress: tr("In progress", "En curso"), done: tr("Done", "Hecha") }[s.status];
  return h("span", {},
    h("span", { class: `badge ${s.status === "done" ? "badge-ok" : s.status === "in_progress" ? "" : "badge-muted"}` }, `${label} · ${s.doneCount}/${s.total}`),
    s.overdue ? h("span", { class: "badge badge-warn" }, tr("Overdue", "Fuera de plazo")) : "",
  );
}

function scoreText(s: HomeworkSummary): string {
  if (s.score == null) return "—";
  return s.scoredMarks != null ? `${s.score}/${s.scoredMarks}` : String(s.score);
}

function questionTitle(q: Question): string {
  const p = q.papers!;
  return `${subjectName(p.subject)} · ${paperLabel(p)} · ${q.page_level ? tr("page", "pág.") + " " + q.start_page : "Q" + q.label}`;
}

const itemsOf = (items: HomeworkItem[], setId: string) => items.filter((i) => i.set_id === setId).sort((a, b) => a.position - b.position);
const marksOf = (items: HomeworkItem[]) => items.map((i) => ({ question_id: i.question_id, marks: i.questions?.marks ?? null }));

/** Small card at the top of the Finder for students with open homework. */
export async function homeworkBanner(): Promise<HTMLElement | ""> {
  if (isOwner()) return "";
  try {
    const { sets, items } = await loadHomework();
    if (!sets.length) return "";
    const answers = await loadHomeworkAnswers(sets.map((s) => s.id));
    const open = sets.filter((s) => homeworkSummary(marksOf(itemsOf(items, s.id)), answers, s.due_date).status !== "done");
    if (!open.length) return "";
    return h("a", { class: "card notice hw-banner", href: "#/homework" },
      h("strong", {}, tr("Homework", "Deberes")), ` · ${open.length} ${tr(open.length === 1 ? "set to do" : "sets to do", open.length === 1 ? "por hacer" : "por hacer")}`,
      h("span", { class: "muted small" }, ` · ${dueText(open[0].due_date)}`),
    );
  } catch {
    return "";
  }
}

export async function homeworkListView(root: HTMLElement): Promise<void> {
  root.replaceChildren(spinner(tr("Loading homework…", "Cargando deberes…")));
  const { sets, items } = await loadHomework();
  const ids = sets.map((s) => s.id);
  const [answers, assignments, people] = await Promise.all([
    loadHomeworkAnswers(ids),
    isOwner() ? loadAssignments(ids) : Promise.resolve([]),
    isOwner() ? loadApprovedStudents() : Promise.resolve([] as Profile[]),
  ]);

  const rows = sets.map((s) => {
    const its = marksOf(itemsOf(items, s.id));
    if (!isOwner()) {
      const sum = homeworkSummary(its, answers.filter((a) => a.set_id === s.id), s.due_date);
      return h("li", { class: "hw-row" },
        h("a", { href: `#/homework/${s.id}` }, h("strong", {}, s.title), h("span", { class: "muted small" }, ` · ${dueText(s.due_date)} · ${its.length} ${tr("questions", "preguntas")}`)),
        statusBadge(sum),
      );
    }
    const students = assignments.filter((a) => a.set_id === s.id);
    const sums = students.map((a) => homeworkSummary(its, answers.filter((x) => x.set_id === s.id && x.user_id === a.user_id), s.due_date));
    const count = (k: string) => sums.filter((x) => x.status === k).length;
    const overdue = sums.filter((x) => x.overdue).length;
    return h("li", { class: "hw-row" },
      h("a", { href: `#/homework/${s.id}` }, h("strong", {}, s.title), h("span", { class: "muted small" }, ` · ${dueText(s.due_date)} · ${its.length} ${tr("questions", "preguntas")} · ${students.length} ${tr("students", "alumnos")}`)),
      h("span", { class: "small" },
        h("span", { class: "badge badge-ok" }, `${tr("Done", "Hechas")} ${count("done")}`),
        h("span", { class: "badge" }, `${tr("In progress", "En curso")} ${count("in_progress")}`),
        h("span", { class: "badge badge-muted" }, `${tr("Not started", "Sin empezar")} ${count("not_started")}`),
        overdue ? h("span", { class: "badge badge-warn" }, `${tr("Overdue", "Fuera de plazo")} ${overdue}`) : "",
      ),
    );
  });

  root.replaceChildren(
    h("h1", {}, tr("Homework", "Deberes")),
    isOwner()
      ? h("p", { class: "muted" }, tr("To set homework, tick questions in the Finder, then “Set as homework”.", "Para poner deberes, marca preguntas en el Buscador y pulsa «Poner como deberes».") , people.length ? "" : ` ${tr("Approve students in People first.", "Primero aprueba alumnos en Personas.")}`)
      : "",
    rows.length ? h("ul", { class: "card hw-list" }, ...rows) : h("p", { class: "muted" }, isOwner() ? tr("No homework sets yet.", "Aún no hay deberes.") : tr("No homework right now.", "No tienes deberes ahora mismo.")),
  );
}

export async function homeworkSetView(root: HTMLElement, id: string): Promise<void> {
  root.replaceChildren(spinner(tr("Loading homework…", "Cargando deberes…")));
  const { sets, items } = await loadHomework(id);
  const set = sets[0];
  if (!set) throw new Error(tr("This homework set isn't available.", "Estos deberes no están disponibles."));
  const its = itemsOf(items, id);
  const answers = await loadHomeworkAnswers([id]);
  const header = [
    h("p", {}, h("a", { href: "#/homework" }, `← ${tr("Homework", "Deberes")}`)),
    h("h1", {}, set.title),
    h("p", { class: "muted" }, `${dueText(set.due_date)} · ${its.length} ${tr("questions", "preguntas")}`),
    set.note ? h("p", { class: "card notice" }, set.note) : "",
  ];
  if (isOwner()) return ownerSetView(root, set, its, answers, header);

  const mine = answers.filter((a) => a.user_id === state.profile!.id);
  const { data: asg } = await db().from("homework_assignments").select("*").eq("set_id", id).eq("user_id", state.profile!.id).maybeSingle();
  const summaryEl = h("div");
  const drawSummary = () => summaryEl.replaceChildren(statusBadge(homeworkSummary(marksOf(its), mine, set.due_date)));
  drawSummary();

  const list = h("ol", { class: "hw-questions" }, ...its.map((it) => {
    const q = it.questions!;
    const a = mine.find((x) => x.question_id === it.question_id);
    const done = h("input", { type: "checkbox", checked: a?.done ?? false });
    const score = h("input", { type: "number", min: 0, max: q.marks ?? 100, value: a?.score ?? "", class: "year-input", "aria-label": tr("Score", "Nota") });
    const comment = h("textarea", { rows: 2, placeholder: tr("Comment for your tutor (optional)", "Comentario para tu profesor (opcional)"), "aria-label": tr("Comment", "Comentario") });
    comment.value = a?.comment ?? "";
    const save = async () => {
      const wasDone = a?.done ?? false;
      const row: HomeworkAnswer = {
        set_id: id, question_id: it.question_id, user_id: state.profile!.id,
        done: done.checked,
        score: score.value === "" ? null : Number(score.value),
        comment: comment.value.trim(),
        finished_at: done.checked ? (wasDone && a?.finished_at ? a.finished_at : new Date().toISOString()) : null,
      };
      const { error } = await db().from("homework_answers").upsert({ ...row, updated_at: new Date().toISOString() });
      if (error) return toast(errorText(error), true);
      const i = mine.findIndex((x) => x.question_id === it.question_id);
      if (i >= 0) mine[i] = row; else mine.push(row);
      drawSummary();
      toast(tr("Saved", "Guardado"));
    };
    return h("li", { class: "card hw-question" },
      h("div", { class: "row" },
        h("a", { href: `#/q/${q.id}` }, h("strong", {}, questionTitle(q))),
        h("span", { class: "muted small" }, q.marks != null ? `${q.marks} ${tr("marks", "puntos")}` : ""),
        h("a", { class: "btn btn-small btn-secondary", href: `#/q/${q.id}` }, tr("Open question + markscheme", "Abrir pregunta y esquema")),
      ),
      h("div", { class: "row" },
        h("label", { class: "check" }, done, tr("Done", "Hecha")),
        h("label", { class: "check" }, tr("Score", "Nota"), score, q.marks != null ? `/ ${q.marks}` : ""),
      ),
      comment,
      h("button", { class: "btn btn-small", onclick: save }, tr("Save", "Guardar")),
    );
  }));

  root.replaceChildren(...header, summaryEl,
    asg?.owner_comment ? h("div", { class: "card notice" }, h("strong", {}, tr("Tutor's comment", "Comentario del profesor")), h("p", {}, asg.owner_comment)) : "",
    list);
}

async function ownerSetView(root: HTMLElement, set: HomeworkSet, its: HomeworkItem[], answers: HomeworkAnswer[], header: (HTMLElement | string)[]): Promise<void> {
  const [assignments, students] = await Promise.all([loadAssignments([set.id]), loadApprovedStudents()]);
  const uids = assignments.map((a) => a.user_id);
  const { data: allPeople } = uids.length ? await db().from("profiles").select("id, full_name, email").in("id", uids) : { data: [] };
  const nameOf = (uid: string) => {
    const p = (allPeople ?? []).find((x: { id: string }) => x.id === uid) as Profile | undefined;
    return p ? p.full_name || p.email : uid;
  };
  const marks = marksOf(its);

  const rows = assignments.map((asg) => {
    const mine = answers.filter((a) => a.user_id === asg.user_id);
    const s = homeworkSummary(marks, mine, set.due_date);
    const reply = h("textarea", { rows: 2, placeholder: tr("Reply to this student", "Responder a este alumno"), "aria-label": tr("Reply", "Respuesta") });
    reply.value = asg.owner_comment;
    const saveReply = async () => {
      const { error } = await db().from("homework_assignments")
        .update({ owner_comment: reply.value.trim(), owner_comment_at: new Date().toISOString() })
        .eq("set_id", set.id).eq("user_id", asg.user_id);
      if (error) return toast(errorText(error), true);
      toast(tr("Reply saved", "Respuesta guardada"));
    };
    const unassign = async () => {
      if (!confirm(tr("Remove this student from the set?", "¿Quitar a este alumno de los deberes?"))) return;
      const { error } = await db().from("homework_assignments").delete().eq("set_id", set.id).eq("user_id", asg.user_id);
      if (error) return toast(errorText(error), true);
      void homeworkSetView(root, set.id);
    };
    return h("details", { class: "card" },
      h("summary", {}, h("strong", {}, nameOf(asg.user_id)), " ", statusBadge(s),
        h("span", { class: "muted small" }, ` · ${tr("Score", "Nota")} ${scoreText(s)}${s.finishedAt ? ` · ${tr("Finished", "Terminada")} ${new Date(s.finishedAt).toLocaleDateString(lang === "es" ? "es-ES" : "en-GB")}` : ""}`)),
      h("table", { class: "progress-table" },
        h("thead", {}, h("tr", {}, h("th", {}, tr("Question", "Pregunta")), h("th", {}, tr("Done", "Hecha")), h("th", {}, tr("Score", "Nota")), h("th", {}, tr("Comment", "Comentario")))),
        h("tbody", {}, ...its.map((it) => {
          const a = mine.find((x) => x.question_id === it.question_id);
          return h("tr", {},
            h("td", {}, h("a", { href: `#/q/${it.question_id}` }, questionTitle(it.questions!))),
            h("td", {}, a?.done ? `✓ ${a.finished_at ? new Date(a.finished_at).toLocaleDateString(lang === "es" ? "es-ES" : "en-GB") : ""}` : "—"),
            h("td", {}, a?.score != null ? `${a.score}${it.questions?.marks != null ? "/" + it.questions.marks : ""}` : "—"),
            h("td", {}, a?.comment || ""),
          );
        })),
      ),
      reply,
      h("div", { class: "row" },
        h("button", { class: "btn btn-small", onclick: saveReply }, tr("Save reply", "Guardar respuesta")),
        h("button", { class: "btn btn-small btn-danger", onclick: unassign }, tr("Remove from set", "Quitar de los deberes")),
      ),
    );
  });

  const addStudents = async () => {
    const assigned = new Set(assignments.map((a) => a.user_id));
    const picked = await pickAssignees(students.filter((s) => !assigned.has(s.id)));
    if (!picked?.length) return;
    const { error } = await db().from("homework_assignments").upsert(picked.map((p) => ({ ...p, set_id: set.id })), { ignoreDuplicates: true });
    if (error) return toast(errorText(error), true);
    void homeworkSetView(root, set.id);
  };
  const remove = async () => {
    if (!confirm(tr("Delete this homework set and every student's answers?", "¿Eliminar estos deberes y las respuestas de todos?"))) return;
    const { error } = await db().from("homework_sets").delete().eq("id", set.id);
    if (error) return toast(errorText(error), true);
    location.hash = "#/homework";
  };

  root.replaceChildren(...header,
    h("div", { class: "row" },
      h("button", { class: "btn btn-small btn-secondary", onclick: addStudents }, tr("Assign to more students", "Asignar a más alumnos")),
      h("button", { class: "btn btn-small btn-danger", onclick: remove }, tr("Delete set", "Eliminar deberes")),
    ),
    h("h2", {}, tr("Students", "Alumnos")),
    ...(rows.length ? rows : [h("p", { class: "muted" }, tr("Nobody is assigned yet.", "Aún no hay nadie asignado."))]),
    h("h2", {}, tr("Questions", "Preguntas")),
    h("ol", {}, ...its.map((it) => h("li", {}, h("a", { href: `#/q/${it.question_id}` }, questionTitle(it.questions!))))),
  );
}

/** Dialog: pick students and/or saved groups. Resolves with the expanded list (or null if cancelled). */
async function pickAssignees(students: Profile[], extra?: HTMLElement): Promise<{ user_id: string; group_id: string | null }[] | null> {
  const groups = await loadGroups();
  return new Promise((resolve) => {
    const groupBoxes = groups.map((g) => ({ g, box: h("input", { type: "checkbox", value: g.id }) }));
    const studentBoxes = students.map((s) => ({ s, box: h("input", { type: "checkbox", value: s.id }) }));
    const form = h("form", { method: "dialog", class: "stack" },
      extra ?? h("h2", {}, tr("Assign to", "Asignar a")),
      groups.length ? h("fieldset", { class: "stack pick" }, h("legend", {}, tr("Groups", "Grupos")),
        ...groupBoxes.map(({ g, box }) => h("label", { class: "check" }, box, `${g.name} (${g.members.length})`))) : "",
      h("fieldset", { class: "stack pick" }, h("legend", {}, tr("Students", "Alumnos")),
        ...(studentBoxes.length ? studentBoxes.map(({ s, box }) => h("label", { class: "check" }, box, s.full_name || s.email, h("span", { class: "muted small" }, s.full_name ? ` ${s.email}` : "")))
          : [h("p", { class: "muted small" }, tr("No approved students.", "No hay alumnos aprobados."))])),
      h("div", { class: "row" },
        h("button", { class: "btn", value: "ok" }, tr("Save", "Guardar")),
        h("button", { class: "btn btn-secondary", value: "cancel", formnovalidate: true }, tr("Cancel", "Cancelar")),
      ),
    );
    const dialog = h("dialog", {}, form);
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (dialog.returnValue !== "ok") return resolve(null);
      resolve(expandAssignees(
        studentBoxes.filter((x) => x.box.checked).map((x) => x.s.id),
        groups,
        groupBoxes.filter((x) => x.box.checked).map((x) => x.g.id),
      ));
    });
    dialog.showModal();
  });
}

/** Owner: create a homework set from the ticked questions (in the order they were ticked). */
export async function createHomeworkFrom(questions: Question[]): Promise<boolean> {
  if (!questions.length) return false;
  const students = await loadApprovedStudents();
  const title = h("input", { name: "title", required: true, placeholder: tr("e.g. Unit 2 practice", "p. ej. Práctica tema 2") });
  const due = h("input", { name: "due", type: "date" });
  const note = h("textarea", { name: "note", rows: 2, placeholder: tr("Note for students (optional)", "Nota para los alumnos (opcional)") });
  const top = h("div", { class: "stack" },
    h("h2", {}, `${tr("Set as homework", "Poner como deberes")} · ${questions.length} ${tr("questions", "preguntas")}`),
    h("label", { class: "field" }, h("span", {}, tr("Title", "Título")), title),
    h("label", { class: "field" }, h("span", {}, tr("Due date (optional)", "Fecha de entrega (opcional)")), due),
    h("label", { class: "field" }, h("span", {}, tr("Note", "Nota")), note),
    h("h3", {}, tr("Assign to", "Asignar a")),
  );
  const picked = await pickAssignees(students, top);
  if (picked === null) return false;
  if (!title.value.trim()) {
    toast(tr("Give the set a title.", "Ponle un título."), true);
    return false;
  }
  try {
    const { data, error } = await db().from("homework_sets")
      .insert({ title: title.value.trim(), due_date: due.value || null, note: note.value.trim() }).select("id").single();
    if (error) throw error;
    const setId = (data as { id: string }).id;
    const { error: e1 } = await db().from("homework_items").insert(questions.map((q, i) => ({ set_id: setId, question_id: q.id, position: i + 1 })));
    if (e1) throw e1;
    if (picked.length) {
      const { error: e2 } = await db().from("homework_assignments").insert(picked.map((p) => ({ ...p, set_id: setId })));
      if (e2) throw e2;
    }
    toast(tr("Homework set created", "Deberes creados"));
    location.hash = `#/homework/${setId}`;
    return true;
  } catch (e) {
    toast(errorText(e), true);
    return false;
  }
}
