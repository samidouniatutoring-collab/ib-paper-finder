import { db, paperLabel, subjectName, type Paper } from "../data";
import { tr } from "../i18n";
import { SUBJECTS } from "../lib/detect";
import { snippetParts } from "../lib/snippet";
import { errorText, h, spinner } from "../ui";

interface Hit {
  question_id: string;
  subject: string | null;
  level: string | null;
  year: number | null;
  session: string | null;
  timezone: string | null;
  paper_number: number | null;
  label: string;
  page_level: boolean;
  start_page: number;
  marks: number | null;
  snippet: string;
}

export function searchHref(q: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ q, ...extra });
  for (const [k, v] of [...params.entries()]) if (!v) params.delete(k);
  return `#/search?${params.toString()}`;
}

/** Search box shown in the header on every screen. */
export function searchBox(): HTMLElement {
  const current = new URLSearchParams(location.hash.split("?")[1] ?? "").get("q") ?? "";
  const input = h("input", { type: "search", name: "q", value: current, placeholder: tr("Search questions…", "Buscar preguntas…"), "aria-label": tr("Search questions", "Buscar preguntas"), class: "search-input" });
  return h("form", { class: "search-form", role: "search", onsubmit: (e: Event) => {
    e.preventDefault();
    if (input.value.trim()) location.hash = searchHref(input.value.trim());
  } }, input);
}

export async function searchView(root: HTMLElement, params: URLSearchParams): Promise<void> {
  const q = params.get("q")?.trim() ?? "";
  const subject = h("select", { "aria-label": tr("Subject", "Asignatura") }, h("option", { value: "" }, tr("All subjects", "Todas las asignaturas")),
    ...SUBJECTS.map((s) => h("option", { value: s.id, selected: params.get("subject") === s.id }, subjectName(s.id))));
  const paper = h("select", { "aria-label": tr("Paper", "Prueba") }, h("option", { value: "" }, tr("Any paper", "Cualquier prueba")),
    ...["1", "2", "3"].map((n) => h("option", { value: n, selected: params.get("paper") === n }, `${tr("Paper", "Prueba")} ${n}`)));
  const year = h("input", { type: "number", min: 1990, max: 2100, value: params.get("year") ?? "", placeholder: tr("Year", "Año"), class: "year-input", "aria-label": tr("Year", "Año") });
  const apply = () => { location.hash = searchHref(q, { subject: subject.value, paper: paper.value, year: year.value }); };
  subject.addEventListener("change", apply);
  paper.addEventListener("change", apply);
  year.addEventListener("change", apply);
  const results = h("div");
  root.replaceChildren(
    h("h1", {}, q ? `${tr("Search", "Búsqueda")}: “${q}”` : tr("Search", "Búsqueda")),
    h("div", { class: "row filters" }, subject, paper, year),
    results,
  );
  if (!q) {
    results.replaceChildren(h("p", { class: "muted" }, tr("Type words from a question in the search box at the top.", "Escribe palabras de una pregunta en el buscador de arriba.")));
    return;
  }
  results.replaceChildren(spinner(tr("Searching…", "Buscando…")));
  const { data, error } = await db().rpc("search_questions", {
    p_query: q,
    p_subject: subject.value || null,
    p_paper: paper.value ? Number(paper.value) : null,
    p_year: year.value ? Number(year.value) : null,
    p_limit: 100,
  });
  if (error) {
    results.replaceChildren(h("p", { class: "muted" }, errorText(error)));
    return;
  }
  const hits = (data ?? []) as Hit[];
  if (!hits.length) {
    results.replaceChildren(h("p", { class: "muted" }, tr("No questions found. Try fewer or different words.", "No se han encontrado preguntas. Prueba con menos palabras u otras.")));
    return;
  }
  results.replaceChildren(
    h("p", { class: "muted small" }, `${hits.length}${hits.length === 100 ? "+" : ""} ${tr("results", "resultados")}`),
    h("ul", { class: "qlist" }, ...hits.map((hit) => h("li", { class: "search-hit" },
      h("a", { href: `#/q/${hit.question_id}` },
        h("strong", {}, `${subjectName(hit.subject)} · ${paperLabel(hit as unknown as Paper)} · ${hit.page_level ? tr("page", "pág.") + " " + hit.start_page : "Q" + hit.label}`),
        hit.marks != null ? h("span", { class: "muted small" }, ` · ${hit.marks} ${tr("marks", "puntos")}`) : "",
      ),
      h("p", { class: "snippet" }, ...snippetParts(hit.snippet).map((p) => (p.hit ? h("mark", {}, p.text) : p.text))),
    ))),
  );
}
