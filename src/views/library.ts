import { withOffline } from "../offline";
import { db, fetchAll, isOwner, loadPapers, paperLabel, subjectName, type Paper } from "../data";
import { tr } from "../i18n";
import { pairKey, SUBJECTS } from "../lib/detect";
import { couldMatch, findDuplicates } from "../lib/duplicates";
import { expandFiles, linkMarkscheme, processFiles, reanalyse, redetect, refreshSearchText, type FileResult } from "../processing";
import { offlineFiles } from "../offline";
import { errorText, h, spinner, toast } from "../ui";

export async function libraryView(root: HTMLElement): Promise<void> {
  root.replaceChildren(spinner(tr("Loading library…", "Cargando biblioteca…")));
  const papers = await withOffline("library", loadPapers);
  const content = h("div");
  root.replaceChildren(h("h1", {}, tr("Library", "Biblioteca")), isOwner() ? uploadPanel(papers) : "", isOwner() ? toolsPanel(papers) : "", content);
  renderTree(content, papers, new Map());
  // Then check same-details papers by their actual text, and mark the real duplicates.
  if (isOwner()) void checkDuplicates(papers).then((d) => { if (d.size) renderTree(content, papers, d); }).catch(() => 0);
}

function uploadPanel(papers: Paper[]): HTMLElement {
  const files = h("input", { type: "file", multiple: true, accept: ".pdf,.zip,application/pdf,application/zip", id: "pf-files" });
  const folder = h("input", { type: "file", multiple: true, webkitdirectory: true, id: "pf-folder" });
  const bar = h("progress", { max: 1, value: 0, hidden: true });
  const status = h("p", { class: "muted" });
  const report = h("div");
  if (lastResults) showReport(report, lastResults);
  let busy = false;

  async function run(list: File[]) {
    if (busy || !list.length) return;
    busy = true;
    report.replaceChildren();
    try {
      const inputs = await expandFiles(list);
      if (!inputs.length) {
        status.textContent = tr("No PDF files found.", "No se han encontrado PDF.");
        return;
      }
      bar.hidden = false;
      bar.max = inputs.length;
      bar.value = 0;
      const results = await processFiles(inputs, papers.map((p) => p.file_hash), (done, total, last) => {
        bar.value = done;
        status.textContent = `${done} / ${total} · ${last.name}`;
      }, (msg) => { status.textContent = msg; });
      lastResults = results;
      showReport(report, results);
      toast(tr("Upload finished", "Subida terminada"));
      const main = document.getElementById("main");
      if (main) setTimeout(() => void libraryView(main), 800);
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      busy = false;
    }
  }

  files.addEventListener("change", () => run([...(files.files ?? [])]));
  folder.addEventListener("change", () => run([...(folder.files ?? [])]));
  const drop = h(
    "div",
    {
      class: "card drop",
      ondragover: (e: DragEvent) => e.preventDefault(),
      ondrop: (e: DragEvent) => {
        e.preventDefault();
        void run([...(e.dataTransfer?.files ?? [])]);
      },
    },
    h("h2", {}, tr("Add papers", "Añadir exámenes")),
    h("p", { class: "muted" }, tr(
      "Choose PDFs, a folder or .zip files (or drop them here). Files are processed in this browser and stored in the private bucket. Duplicates are skipped.",
      "Elige PDF, una carpeta o archivos .zip (o suéltalos aquí). Se procesan en este navegador y se guardan en el almacén privado. Los duplicados se omiten.",
    )),
    h("div", { class: "row" },
      h("label", { class: "btn", for: "pf-files" }, tr("Choose files", "Elegir archivos")),
      h("label", { class: "btn btn-secondary", for: "pf-folder" }, tr("Choose folder", "Elegir carpeta")),
    ),
    files, folder, bar, status, report,
  );
  files.hidden = true;
  folder.hidden = true;
  return drop;
}

/** Owner maintenance jobs that run over every paper in this browser. */
function toolsPanel(papers: Paper[]): HTMLElement {
  const status = h("p", { class: "small muted" });
  let busy = false;
  const runAll = async (label: string, list: Paper[], job: (p: Paper) => Promise<unknown>) => {
    if (busy) return;
    busy = true;
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      status.textContent = `${label}: ${i + 1} / ${list.length} · ${list[i].original_name}`;
      try {
        await job(list[i]);
      } catch {
        failed++;
      }
    }
    status.textContent = `${label}: ${tr("finished", "terminado")}${failed ? ` · ${failed} ${tr("failed", "con error")}` : ""}`;
    busy = false;
  };
  return h("details", { class: "card" },
    h("summary", {}, h("strong", {}, tr("Library tools", "Herramientas"))),
    h("div", { class: "stack" },
      h("div", { class: "row" },
        h("button", { class: "btn btn-small btn-secondary", onclick: () => void runAll(tr("Search text", "Texto de búsqueda"), papers.filter((p) => p.kind === "paper"), refreshSearchText) },
          tr("Fill search text for all papers", "Rellenar texto de búsqueda de todos los exámenes")),
        h("span", { class: "small muted" }, tr("Needed once for papers added before search existed. Keeps tags, homework and progress.", "Hace falta una vez para exámenes subidos antes de la búsqueda. Mantiene etiquetas, deberes y progreso.")),
      ),
      h("div", { class: "row" },
        h("button", { class: "btn btn-small", onclick: async () => {
            // Also every paper with no markscheme and every markscheme with no paper: one of them may be filed as the
            // wrong kind because of its file name.
            const keysOf = (kind: string) => new Set(papers.filter((p) => p.kind === kind).map((p) => pairKey(p)));
            const paperKeys = keysOf("paper");
            const msKeys = keysOf("markscheme");
            const unpaired = (p: Paper) =>
              (p.kind === "paper" && !msKeys.has(pairKey(p))) || (p.kind === "markscheme" && !paperKeys.has(pairKey(p)));
            await runAll(tr("Re-read details", "Releer datos"), papers.filter((p) => p.needs_review || !p.year || unpaired(p)), redetect);
            const main = document.getElementById("main");
            if (main) setTimeout(() => void libraryView(main), 800);
          } },
          tr("Re-read details from the PDFs", "Releer datos de los PDF")),
        h("span", { class: "small muted" }, tr("For files marked \u201cCheck details\u201d, with no year, or without their paper/markscheme: checks inside the PDF whether it is a paper or a markscheme (file names can be wrong), reads the year, session, paper and timezone from inside the PDF and pairs markschemes. Details you set by hand are kept.", "Para archivos con \u201cRevisar datos\u201d, sin año o sin su examen/esquema: comprueba en el PDF si es examen o esquema (el nombre puede estar mal), lee año, convocatoria, prueba y zona del PDF y empareja los esquemas. Se mantienen los datos que fijaste a mano.")),
      ),
      h("div", { class: "row" },
        h("button", { class: "btn btn-small btn-secondary", onclick: () => void runAll(tr("Re-split questions", "Volver a dividir"), papers.filter((p) => p.kind === "paper"), async (p) => { await reanalyse(p); await linkMarkscheme(p); }) },
          tr("Re-split questions for all papers", "Volver a dividir las preguntas de todos los exámenes")),
        h("span", { class: "small muted" }, tr("Re-finds where each question starts and ends, then re-matches markscheme pages. Homework and progress are kept; automatic topic tags are redone.", "Vuelve a buscar dónde empieza y acaba cada pregunta y empareja el esquema. Se mantienen deberes y progreso; las etiquetas automáticas se rehacen.")),
      ),
      h("div", { class: "row" },
        h("button", { class: "btn btn-small btn-secondary", onclick: () => void runAll(tr("Markscheme pages", "Páginas del esquema"), papers.filter((p) => p.kind === "paper"), (p) => linkMarkscheme(p)) },
          tr("Match markscheme pages for all papers", "Emparejar páginas del esquema de todos los exámenes")),
        h("span", { class: "small muted" }, tr("Finds each question's part of its markscheme. Pages you corrected by hand are kept.", "Encuentra la parte del esquema de cada pregunta. Se mantienen las páginas corregidas a mano.")),
      ),
      status,
    ),
  );
}

/** Last upload report, kept so it stays visible after the library reloads. */
let lastResults: FileResult[] | null = null;

function showReport(el: HTMLElement, results: FileResult[]): void {
  const count = (s: FileResult["status"]) => results.filter((r) => r.status === s).length;
  el.replaceChildren(
    h("p", {}, `${tr("Added", "Añadidos")}: ${count("added")} · ${tr("Duplicates skipped", "Duplicados omitidos")}: ${count("duplicate")} · ${tr("Errors", "Errores")}: ${count("error")}`),
    h("ul", { class: "small" },
      ...results
        .filter((r) => r.status !== "added" || r.needsReview)
        .map((r) => h("li", {}, `${r.name}: ${r.status === "duplicate" ? tr("duplicate (same file already in library)", "duplicado (ya está en la biblioteca)") : r.status === "error" ? r.message ?? "error" : tr("added, needs review", "añadido, revisar")}`)),
    ),
  );
}

/** Compares the question text of papers that share their details; returns duplicate id → copy to keep. */
async function checkDuplicates(papers: Paper[]): Promise<Map<string, Paper>> {
  const cands = papers.filter((p) => p.kind === "paper" && papers.some((o) => o.id !== p.id && couldMatch(p, o)));
  if (cands.length < 2) return new Map();
  const ids = cands.map((p) => p.id);
  const rows = await fetchAll<{ paper_id: string; body: string | null }>((a, b) => db().from("questions").select("paper_id, body").in("paper_id", ids).range(a, b));
  const text = new Map<string, string>();
  for (const r of rows) text.set(r.paper_id, `${text.get(r.paper_id) ?? ""} ${r.body ?? ""}`);
  return findDuplicates(cands, text);
}

async function deletePaper(p: Paper): Promise<void> {
  await db().storage.from("papers").remove([p.storage_path]);
  const { error } = await db().from("papers").delete().eq("id", p.id);
  if (error) throw error;
}

function renderTree(el: HTMLElement, papers: Paper[], dupes: Map<string, Paper>): void {
  if (!papers.length) {
    el.replaceChildren(h("p", { class: "muted" }, tr("No papers yet.", "Aún no hay exámenes.")));
    return;
  }
  const ms = new Map<string, Paper[]>();
  const counts = new Map<string, number>();
  for (const p of papers) {
    const k = pairKey(p);
    // Pre-release statements are kept out of paper/markscheme pairing (they share Paper 1's key).
    if (p.kind === "markscheme") ms.set(k, [...(ms.get(k) ?? []), p]);
    else if (p.kind === "paper") counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const bySubject = new Map<string, Paper[]>();
  for (const p of papers) {
    if (p.kind === "markscheme" && counts.has(pairKey(p))) continue;
    const s = p.subject ?? "";
    bySubject.set(s, [...(bySubject.get(s) ?? []), p]);
  }
  const order = [...SUBJECTS.map((s) => s.id as string), ""];
  const sections = order.filter((s) => bySubject.has(s)).map((s) => {
    const list = bySubject.get(s)!;
    const byYear = new Map<string, Paper[]>();
    for (const p of list) byYear.set(String(p.year ?? "?"), [...(byYear.get(String(p.year ?? "?")) ?? []), p]);
    return h("details", { class: "card", open: list.length < 40 },
      h("summary", {}, h("strong", {}, s ? subjectName(s) : tr("Unknown subject", "Asignatura desconocida")), h("span", { class: "muted" }, ` · ${list.length}`)),
      ...[...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([year, ps]) =>
        h("div", { class: "year" }, h("h3", {}, year),
          ...ps
            .sort((a, b) => (a.session ?? "").localeCompare(b.session ?? "") || (a.timezone ?? "").localeCompare(b.timezone ?? "") || (a.paper_number ?? 0) - (b.paper_number ?? 0) || (a.paper_part ?? "").localeCompare(b.paper_part ?? ""))
            .map((p) => {
              const k = pairKey(p);
              const pairs = p.kind === "paper" ? ms.get(k) ?? [] : [];
              const flags = [
                p.kind === "markscheme" ? tr("Markscheme without paper", "Esquema sin examen") : "",
                p.kind === "paper" && !pairs.length ? tr("No markscheme", "Sin esquema") : "",
                dupes.has(p.id) ? `${tr("Duplicate of", "Duplicado de")} ${dupes.get(p.id)!.original_name.split("/").pop()}` : "",
                p.needs_review ? tr("Check details", "Revisar datos") : "",
              ].filter(Boolean);
              const row = paperRow(p, pairs[0], flags, p.kind === "prerelease");
              if (dupes.has(p.id)) {
                row.append(h("button", { class: "btn btn-small btn-danger", onclick: async () => {
                  if (!confirm(tr("Delete this copy? The other copy stays.", "¿Eliminar esta copia? La otra se queda."))) return;
                  try { await deletePaper(p); toast(tr("Copy deleted", "Copia eliminada")); const main = document.getElementById("main"); if (main) void libraryView(main); }
                  catch (e) { toast(errorText(e), true); }
                } }, tr("Delete this copy", "Eliminar esta copia")));
              }
              return row;
            }),
        ),
      ),
    );
  });
  el.replaceChildren(...sections);
}

function paperRow(p: Paper, ms: Paper | undefined, flags: string[], prerelease = false): HTMLElement {
  const row = h("div", { class: "paper-row" },
    h("div", {},
      h("a", { href: `#/paper/${p.id}` }, paperLabel(p)),
      ms ? h("a", { class: "ms-link", href: `#/paper/${ms.id}` }, tr("Markscheme", "Esquema")) : "",
      prerelease ? h("span", { class: "badge" }, tr("Pre-release", "Pre-publicación")) : "",
      ...flags.map((f) => h("span", { class: "badge badge-warn" }, f)),
      offlineFiles.has(p.storage_path) ? h("span", { class: "badge badge-offline" }, tr("Available offline", "Disponible sin conexión")) : "",
      isOwner() ? h("div", { class: "small muted" }, p.original_name) : "",
    ),
    isOwner() ? h("div", { class: "row" },
      h("button", { class: "btn btn-small btn-secondary", onclick: () => editPaper(p) }, tr("Edit", "Editar")),
      ms ? h("button", { class: "btn btn-small btn-secondary", onclick: () => editPaper(ms) }, tr("Edit markscheme", "Editar esquema")) : "",
    ) : "",
  );
  return row;
}

function field(label: string, input: HTMLElement): HTMLElement {
  return h("label", { class: "field" }, h("span", {}, label), input);
}

function select(name: string, options: [string, string][], value: string | number | null): HTMLSelectElement {
  return h("select", { name }, h("option", { value: "" }, "—"), ...options.map(([v, l]) => h("option", { value: v, selected: String(value ?? "") === v }, l)));
}

function editPaper(p: Paper): void {
  const form = h("form", { method: "dialog", class: "stack" },
    h("h2", {}, tr("Edit details", "Editar datos")),
    h("p", { class: "small muted" }, p.original_name),
    field(tr("Subject", "Asignatura"), select("subject", SUBJECTS.map((s) => [s.id, subjectName(s.id)]), p.subject)),
    field(tr("Level", "Nivel"), select("level", [["HL", "HL"], ["SL", "SL"], ["HL/SL", "HL/SL"]], p.level)),
    field(tr("Year", "Año"), h("input", { name: "year", type: "number", min: 1990, max: 2100, value: p.year ?? "" })),
    field(tr("Session", "Convocatoria"), select("session", [["May", tr("May", "Mayo")], ["November", tr("November", "Noviembre")]], p.session)),
    field(tr("Timezone", "Zona horaria"), select("timezone", [["TZ0", "TZ0"], ["TZ1", "TZ1"], ["TZ2", "TZ2"], ["TZ3", "TZ3"]], p.timezone)),
    field(tr("Paper number", "Número de prueba"), select("paper", [["1", "1"], ["1A", "1A"], ["1B", "1B"], ["2", "2"], ["3", "3"]], p.paper_number ? `${p.paper_number}${p.paper_part ?? ""}` : null)),
    field(tr("Type", "Tipo"), select("kind", [["paper", tr("Paper", "Examen")], ["markscheme", tr("Markscheme", "Esquema")], ["prerelease", tr("Pre-release statement", "Declaración de pre-publicación")]], p.kind)),
    h("label", { class: "check" }, h("input", { type: "checkbox", name: "reanalyse" }), tr("Re-split and re-tag questions now (replaces manual tags)", "Volver a dividir y etiquetar ahora (sustituye las etiquetas manuales)")),
    h("div", { class: "row" },
      h("button", { class: "btn", value: "save" }, tr("Save", "Guardar")),
      h("button", { class: "btn btn-secondary", value: "cancel", formnovalidate: true }, tr("Cancel", "Cancelar")),
      h("button", { class: "btn btn-danger", value: "delete", formnovalidate: true }, tr("Delete paper", "Eliminar examen")),
    ),
  );
  const dialog = h("dialog", {}, form);
  document.body.append(dialog);
  dialog.addEventListener("close", async () => {
    const action = dialog.returnValue;
    const fd = new FormData(form);
    dialog.remove();
    try {
      if (action === "delete") {
        if (!confirm(tr("Delete this file and its questions for everyone?", "¿Eliminar este archivo y sus preguntas para todos?"))) return;
        await db().storage.from("papers").remove([p.storage_path]);
        const { error } = await db().from("papers").delete().eq("id", p.id);
        if (error) throw error;
      } else if (action === "save") {
        const v = (k: string) => (fd.get(k) as string) || null;
        const kind = v("kind") ?? "paper";
        const update = {
          subject: v("subject"),
          level: v("level"),
          year: v("year") ? Number(v("year")) : null,
          session: v("session"),
          timezone: v("timezone"),
          // A pre-release statement always belongs to Paper 1.
          paper_number: kind === "prerelease" ? 1 : v("paper") ? Number(v("paper")!.charAt(0)) : null,
          paper_part: kind === "prerelease" ? null : ((v("paper") ?? "").charAt(1) || null),
          kind,
          needs_review: false,
        };
        const { error } = await db().from("papers").update(update).eq("id", p.id);
        if (error) throw error;
        if (kind === "prerelease" && p.kind !== "prerelease") {
          // Not split into questions: drop any questions (their tags and markscheme ranges cascade).
          const { error: qErr } = await db().from("questions").delete().eq("paper_id", p.id);
          if (qErr) throw qErr;
        } else if (fd.get("reanalyse")) {
          toast(tr("Re-analysing…", "Analizando…"));
          const n = await reanalyse({ ...p, ...update } as Paper);
          await linkMarkscheme({ ...p, ...update } as Paper).catch(() => 0);
          toast(`${n} ${tr("questions", "preguntas")}`);
        }
      } else return;
      toast(tr("Saved", "Guardado"));
      const main = document.getElementById("main");
      if (main) void libraryView(main);
    } catch (e) {
      toast(errorText(e), true);
    }
  });
  dialog.showModal();
}
