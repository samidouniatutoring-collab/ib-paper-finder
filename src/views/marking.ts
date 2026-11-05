// Owner: homework submissions to mark. Look at the photos next to the markscheme, give a score and feedback
// (shown to the student in the app, and optionally emailed), download the photos for the student's folder, then delete.
import { db, loadHomework, type HomeworkAssignment, type Profile, type Submission } from "../data";
import { lang, tr } from "../i18n";
import { deleteSubmission, signedUrls, zipSubmission } from "../submissions";
import { errorText, h, spinner, toast } from "../ui";
import { questionTitle } from "./homework";

const fmt = (d: string) => new Date(d).toLocaleString(lang === "es" ? "es-ES" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function people(ids: string[]): Promise<Map<string, Profile>> {
  if (!ids.length) return new Map();
  const { data } = await db().from("profiles").select("id, full_name, email").in("id", ids);
  return new Map(((data ?? []) as Profile[]).map((p) => [p.id, p]));
}
const nameOf = (p?: Profile) => (p ? p.full_name || p.email : "?");

export async function markingView(root: HTMLElement, id?: string): Promise<void> {
  root.replaceChildren(spinner(tr("Loading…", "Cargando…")));
  if (id) return submissionView(root, id);
  const { data, error } = await db().from("homework_submissions").select("*").order("created_at");
  if (error) throw error;
  const subs = (data ?? []) as Submission[];
  const [who, hw] = await Promise.all([people([...new Set(subs.map((s) => s.user_id))]), loadHomework()]);
  root.replaceChildren(
    h("h1", {}, tr("Marking", "Corregir")),
    h("p", { class: "muted" }, tr("Answers your students sent for their homework, oldest first.", "Respuestas que tus alumnos enviaron de sus deberes, de la más antigua a la más reciente.")),
    subs.length
      ? h("ul", { class: "qlist" }, ...subs.map((s) => {
          const set = hw.sets.find((x) => x.id === s.set_id);
          return h("li", { class: "card row", style: "justify-content: space-between" },
            h("div", {}, h("strong", {}, nameOf(who.get(s.user_id))), h("div", { class: "small muted" }, `${set?.title ?? "?"} · ${fmt(s.created_at)} · ${s.files.length} ${tr("files", "archivos")}`)),
            h("a", { class: "btn btn-small", href: `#/marking/${s.id}` }, tr("Mark", "Corregir")));
        }))
      : h("p", { class: "card muted" }, tr("Nothing to mark.", "Nada que corregir.")),
  );
}

async function submissionView(root: HTMLElement, id: string): Promise<void> {
  const { data, error } = await db().from("homework_submissions").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) {
    root.replaceChildren(h("p", {}, h("a", { href: "#/marking" }, `← ${tr("Marking", "Corregir")}`)), h("p", { class: "card" }, tr("This submission has been deleted.", "Esta entrega se ha eliminado.")));
    return;
  }
  const s = data as Submission;
  const [who, hw, urls, asgRes] = await Promise.all([
    people([s.user_id]),
    loadHomework(),
    signedUrls(s.files),
    db().from("homework_assignments").select("*").eq("set_id", s.set_id).eq("user_id", s.user_id).maybeSingle(),
  ]);
  const student = who.get(s.user_id);
  const set = hw.sets.find((x) => x.id === s.set_id);
  const items = hw.items.filter((it) => it.set_id === s.set_id).sort((a, b) => a.position - b.position);
  const total = items.reduce((a, it) => a + (it.questions?.marks ?? 0), 0) || null;
  const asg = asgRes.data as HomeworkAssignment | null;

  const score = h("input", { type: "number", min: 0, max: total ?? undefined, step: "0.5", class: "year-input", value: asg?.owner_score ?? "", "aria-label": tr("Score", "Nota") });
  const feedback = h("textarea", { rows: 6, placeholder: tr("Feedback for the student", "Comentario para el alumno") });
  feedback.value = asg?.owner_comment ?? "";
  const save = async (): Promise<boolean> => {
    const { error: e } = await db().from("homework_assignments")
      .update({ owner_score: score.value === "" ? null : Number(score.value), owner_comment: feedback.value.trim(), owner_comment_at: new Date().toISOString() })
      .eq("set_id", s.set_id).eq("user_id", s.user_id);
    if (e) { toast(errorText(e), true); return false; }
    toast(tr("Saved: the student sees it in the app", "Guardado: el alumno lo ve en la app"));
    return true;
  };
  const email = () => {
    if (!student?.email) return;
    const subject = `${tr("Feedback", "Comentarios")}: ${set?.title ?? ""}`;
    const body = `${score.value !== "" ? `${tr("Score", "Nota")}: ${score.value}${total ? " / " + total : ""}\n\n` : ""}${feedback.value.trim()}`;
    location.href = `mailto:${encodeURIComponent(student.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };
  const download = async () => {
    try {
      const blob = await zipSubmission(s, nameOf(student));
      const a = h("a", { href: URL.createObjectURL(blob), download: `${nameOf(student)} - ${set?.title ?? "homework"} - ${s.created_at.slice(0, 10)}.zip`.replace(/[\\/:*?"<>|]/g, "-") });
      document.body.append(a);
      a.click();
      a.remove();
      saved = true;
      delBtn.textContent = tr("Delete submission", "Eliminar entrega");
    } catch (e) { toast(errorText(e), true); }
  };
  let saved = false;
  const delBtn = h("button", { class: "btn btn-danger" }, tr("Delete submission", "Eliminar entrega"));
  delBtn.addEventListener("click", async () => {
    const warn = saved
      ? tr("Delete these files from the app? Your score and feedback stay.", "¿Eliminar estos archivos de la app? La nota y el comentario se quedan.")
      : tr("You haven't downloaded these yet. Save them to the student's folder first, or they're gone for good. Delete anyway?", "Aún no los has descargado. Guárdalos primero en la carpeta del alumno o se perderán. ¿Eliminar de todas formas?");
    if (!confirm(warn)) return;
    try { await deleteSubmission(s); toast(tr("Submission deleted", "Entrega eliminada")); location.hash = "#/marking"; }
    catch (e) { toast(errorText(e), true); }
  });

  root.replaceChildren(
    h("p", {}, h("a", { href: "#/marking" }, `← ${tr("Marking", "Corregir")}`)),
    h("h1", {}, `${nameOf(student)} · ${set?.title ?? ""}`),
    h("p", { class: "muted" }, `${tr("Sent", "Enviado")} ${fmt(s.created_at)} · ${s.files.length} ${tr("files", "archivos")}`),
    s.note ? h("p", { class: "card notice" }, s.note) : "",
    h("div", { class: "card" }, h("h2", {}, tr("Questions and markschemes", "Preguntas y esquemas")),
      h("ol", {}, ...items.map((it) => h("li", {}, h("a", { href: `#/q/${it.question_id}`, target: "_blank" }, it.questions ? questionTitle(it.questions) : "?"),
        it.questions?.marks != null ? h("span", { class: "muted small" }, ` · ${it.questions.marks} ${tr("marks", "puntos")}`) : "")))),
    h("div", { class: "pages" }, ...s.files.map((path, i) => path.endsWith(".pdf")
      ? h("p", {}, h("a", { href: urls[i], target: "_blank" }, `${tr("Open PDF", "Abrir PDF")} ${i + 1}`))
      : h("img", { src: urls[i], class: "page", alt: `${tr("Page", "Página")} ${i + 1}`, loading: "lazy", style: "max-width: 100%" }))),
    h("div", { class: "card stack" },
      h("h2", {}, tr("Score and feedback", "Nota y comentario")),
      h("label", { class: "check" }, tr("Score", "Nota"), score, total ? `/ ${total}` : ""),
      feedback,
      h("div", { class: "row" },
        h("button", { class: "btn", onclick: () => void save() }, tr("Save (student sees it in the app)", "Guardar (el alumno lo ve en la app)")),
        student?.email ? h("button", { class: "btn btn-secondary", onclick: async () => { if (await save()) email(); } }, tr("Save and email it", "Guardar y enviar por email")) : ""),
    ),
    h("div", { class: "card stack" },
      h("h2", {}, tr("When you're done", "Cuando termines")),
      h("p", { class: "small" }, tr(`Download the photos and put them in ${nameOf(student)}'s folder, so you can see how they improve over your tutoring. Then delete the submission to free up space.`,
        `Descarga las fotos y guárdalas en la carpeta de ${nameOf(student)} para ver cómo mejora durante las clases. Después elimina la entrega para liberar espacio.`)),
      h("div", { class: "row" },
        h("button", { class: "btn btn-secondary", onclick: () => void download() }, tr("Download photos (.zip)", "Descargar fotos (.zip)")),
        delBtn),
    ),
  );
}
