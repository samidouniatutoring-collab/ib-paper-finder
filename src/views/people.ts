import { db, fetchAll, loadGroups, state, subjectName, type Profile, type StudentGroup } from "../data";
import { SUBJECTS } from "../lib/detect";
import { tr } from "../i18n";
import { parsePracticeSettings } from "../lib/practice";
import { errorText, h, spinner, toast } from "../ui";

export async function peopleView(root: HTMLElement): Promise<void> {
  root.replaceChildren(spinner(tr("Loading…", "Cargando…")));
  const [people, groups] = await Promise.all([
    fetchAll<Profile>((a, b) => db().from("profiles").select("*").order("created_at", { ascending: false }).range(a, b)),
    loadGroups().catch(() => [] as StudentGroup[]),
  ]);

  const setStatus = async (p: Profile, status: Profile["status"]) => {
    const { error } = await db().from("profiles").update({ status }).eq("id", p.id);
    if (error) return toast(errorText(error), true);
    toast(tr("Saved", "Guardado"));
    void peopleView(root);
  };

  const domain = h("input", { type: "text", value: state.settings.allowed_domain ?? "", placeholder: "school.org", "aria-label": tr("Allowed email domain", "Dominio permitido") });
  const downloads = h("input", { type: "checkbox", checked: state.settings.allow_downloads });
  const practice = h("textarea", { rows: 3, class: "mono", "aria-label": tr("Practice timer settings (JSON)", "Ajustes del cronómetro (JSON)") });
  practice.value = JSON.stringify(parsePracticeSettings(state.settings.practice_settings), null, 1);
  const saveSettings = async () => {
    let practiceSettings: unknown;
    try {
      practiceSettings = parsePracticeSettings(JSON.parse(practice.value));
    } catch {
      return toast(tr("The practice settings aren't valid JSON.", "Los ajustes de práctica no son JSON válido."), true);
    }
    const update = { allowed_domain: domain.value.trim().replace(/^@/, "").toLowerCase() || null, allow_downloads: downloads.checked, practice_settings: practiceSettings };
    const { error } = await db().from("app_settings").update(update).eq("id", 1);
    if (error) return toast(errorText(error), true);
    state.settings = update;
    toast(tr("Saved", "Guardado"));
  };

  const group = (status: Profile["status"], title: string) => {
    const list = people.filter((p) => p.status === status && p.role !== "owner");
    return h("section", { class: "card" }, h("h2", {}, `${title} (${list.length})`),
      list.length
        ? h("ul", { class: "people" }, ...list.map((p) =>
            h("li", {},
              h("div", {}, h("strong", {}, p.full_name || p.email), h("div", { class: "small muted" }, `${p.email} · ${new Date(p.created_at).toLocaleDateString()}`)),
              status === "approved" ? accessControls(p) : "",
              h("div", { class: "row" },
                status !== "approved" ? h("button", { class: "btn btn-small", onclick: () => setStatus(p, "approved") }, tr("Approve", "Aprobar")) : "",
                status !== "removed" ? h("button", { class: "btn btn-small btn-danger", onclick: () => setStatus(p, "removed") }, tr("Remove", "Quitar")) : "",
              ),
            )))
        : h("p", { class: "muted small" }, tr("Nobody here.", "Nadie.")),
    );
  };

  root.replaceChildren(
    h("h1", {}, tr("People", "Personas")),
    group("pending", tr("Requests", "Solicitudes")),
    group("approved", tr("Approved", "Aprobados")),
    group("removed", tr("Removed", "Quitados")),
    groupsSection(root, groups, people.filter((p) => p.status === "approved" && p.role !== "owner")),
    h("section", { class: "card stack" }, h("h2", {}, tr("Settings", "Ajustes")),
      h("label", { class: "field" }, h("span", {}, tr("Only allow requests from this email domain (optional)", "Solo aceptar solicitudes de este dominio (opcional)")), domain),
      h("label", { class: "check" }, downloads, tr("Allow students to download practice-set PDFs", "Permitir a los alumnos descargar las prácticas en PDF")),

      h("button", { class: "btn", onclick: saveSettings }, tr("Save settings", "Guardar ajustes")),
    ),
  );
}

/** Saved named groups (e.g. "BM group Tue") for assigning homework to several students at once. */
function groupsSection(root: HTMLElement, groups: StudentGroup[], students: Profile[]): HTMLElement {
  const edit = (g: StudentGroup | null) => {
    const name = h("input", { required: true, value: g?.name ?? "", placeholder: tr("e.g. BM group Tue", "p. ej. Grupo BM martes") });
    const boxes = students.map((s) => ({ s, box: h("input", { type: "checkbox", checked: g?.members.includes(s.id) ?? false }) }));
    const form = h("form", { method: "dialog", class: "stack" },
      h("h2", {}, g ? tr("Edit group", "Editar grupo") : tr("New group", "Nuevo grupo")),
      h("label", { class: "field" }, h("span", {}, tr("Name", "Nombre")), name),
      h("fieldset", { class: "stack pick" }, h("legend", {}, tr("Members", "Miembros")),
        ...boxes.map(({ s, box }) => h("label", { class: "check" }, box, s.full_name || s.email))),
      h("div", { class: "row" },
        h("button", { class: "btn", value: "save" }, tr("Save", "Guardar")),
        h("button", { class: "btn btn-secondary", value: "cancel", formnovalidate: true }, tr("Cancel", "Cancelar")),
        g ? h("button", { class: "btn btn-danger", value: "delete", formnovalidate: true }, tr("Delete group", "Eliminar grupo")) : "",
      ),
    );
    const dialog = h("dialog", {}, form);
    document.body.append(dialog);
    dialog.addEventListener("close", async () => {
      dialog.remove();
      try {
        if (dialog.returnValue === "delete" && g) {
          const { error } = await db().from("student_groups").delete().eq("id", g.id);
          if (error) throw error;
        } else if (dialog.returnValue === "save" && name.value.trim()) {
          let id = g?.id;
          if (id) {
            const { error } = await db().from("student_groups").update({ name: name.value.trim() }).eq("id", id);
            if (error) throw error;
            const { error: e2 } = await db().from("student_group_members").delete().eq("group_id", id);
            if (e2) throw e2;
          } else {
            const { data, error } = await db().from("student_groups").insert({ name: name.value.trim() }).select("id").single();
            if (error) throw error;
            id = (data as { id: string }).id;
          }
          const members = boxes.filter((b) => b.box.checked).map((b) => ({ group_id: id, user_id: b.s.id }));
          if (members.length) {
            const { error } = await db().from("student_group_members").insert(members);
            if (error) throw error;
          }
        } else return;
        toast(tr("Saved", "Guardado"));
        void peopleView(root);
      } catch (e) {
        toast(errorText(e), true);
      }
    });
    dialog.showModal();
  };
  return h("section", { class: "card" },
    h("h2", {}, `${tr("Groups", "Grupos")} (${groups.length})`),
    h("p", { class: "muted small" }, tr("Save a group of students to assign homework to all of them at once.", "Guarda un grupo de alumnos para asignarles deberes a todos a la vez.")),
    groups.length ? h("ul", { class: "people" }, ...groups.map((g) => h("li", {},
      h("div", {}, h("strong", {}, g.name), h("div", { class: "small muted" }, students.filter((s) => g.members.includes(s.id)).map((s) => s.full_name || s.email).join(", ") || tr("No members", "Sin miembros"))),
      h("button", { class: "btn btn-small btn-secondary", onclick: () => edit(g) }, tr("Edit", "Editar")),
    ))) : "",
    h("button", { class: "btn btn-small", onclick: () => edit(null) }, tr("New group", "Nuevo grupo")),
  );
}

/** Homework only, or the full app in the ticked subjects. Saved straight away; enforced by the database. */
function accessControls(p: Profile): HTMLElement {
  const mode = h("select", { "aria-label": tr("Access", "Acceso") },
    h("option", { value: "homework", selected: (p.access ?? "homework") === "homework" }, tr("Homework only", "Solo deberes")),
    h("option", { value: "full", selected: p.access === "full" }, tr("Full app", "App completa")));
  const boxes = SUBJECTS.map((s) => {
    const box = h("input", { type: "checkbox", value: s.id, checked: !p.subjects || p.subjects.includes(s.id) });
    return { box, label: h("label", { class: "check small" }, box, subjectName(s.id)) };
  });
  const subjectsRow = h("div", { class: "row", hidden: mode.value !== "full" }, ...boxes.map((b) => b.label));
  const save = async () => {
    subjectsRow.hidden = mode.value !== "full";
    const ticked = boxes.filter((b) => b.box.checked).map((b) => b.box.value);
    const subjects = ticked.length === SUBJECTS.length ? null : ticked;
    const { error } = await db().from("profiles").update({ access: mode.value, subjects }).eq("id", p.id);
    if (error) return toast(errorText(error), true);
    p.access = mode.value as Profile["access"];
    p.subjects = subjects;
    toast(tr("Access saved", "Acceso guardado"));
  };
  mode.addEventListener("change", () => void save());
  for (const b of boxes) b.box.addEventListener("change", () => void save());
  return h("div", { class: "stack" }, mode, subjectsRow);
}
