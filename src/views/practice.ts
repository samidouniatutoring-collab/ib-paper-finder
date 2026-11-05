import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { canDownload, isOwner, markschemeFor, watermarkText, type Question } from "../data";
import { createHomeworkFrom } from "./homework";
import { tr } from "../i18n";
import { loadPaperBytes, openPdf, renderPage } from "../pdf";
import { errorText, h, toast } from "../ui";

/** Questions ticked for the practice set (kept while the tab is open). */
export const selection = new Map<string, Question>();

let bar: HTMLElement | null = null;

export function practiceBar(): HTMLElement {
  const el = bar ?? h("div", { class: "practice-bar" });
  bar = el;
  const n = selection.size;
  el.hidden = n === 0;
  const withMs = h("input", { type: "checkbox", checked: true });
  el.replaceChildren(
    h("span", {}, `${n} ${tr("selected", "seleccionadas")}`),
    h("label", { class: "check" }, withMs, tr("Markscheme too", "Con esquema")),
    h("button", { class: "btn", onclick: () => void build(withMs.checked) }, tr("Make practice set", "Crear práctica")),
    isOwner() ? h("button", { class: "btn btn-secondary", onclick: () => void createHomeworkFrom([...selection.values()]).then((ok) => { if (ok) { selection.clear(); practiceBar(); } }) }, tr("Set as homework", "Poner como deberes")) : "",
    h("button", { class: "btn btn-ghost", onclick: () => { selection.clear(); practiceBar(); document.querySelectorAll<HTMLInputElement>(".qrow input").forEach((b) => (b.checked = false)); } }, tr("Clear", "Vaciar")),
  );
  return el;
}

async function msQuestion(q: Question): Promise<{ path: string; start: number; end: number } | null> {
  const part = await markschemeFor(q);
  if (!part?.exact) return null;
  return { path: part.ms.storage_path, start: part.start, end: part.end };
}

async function makePdf(parts: { path: string; start: number; end: number }[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const mark = watermarkText().replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
  for (const part of parts) {
    const src = await PDFDocument.load(await loadPaperBytes(part.path), { ignoreEncryption: true });
    const idx = [];
    for (let i = part.start; i <= Math.min(part.end, src.getPageCount()); i++) idx.push(i - 1);
    for (const page of await out.copyPages(src, idx)) {
      out.addPage(page);
      page.drawText(mark, { x: 24, y: 14, size: 8, font, color: rgb(0.12, 0.23, 0.54), opacity: 0.6 });
    }
  }
  return out.save();
}

async function build(withMs: boolean): Promise<void> {
  const qs = [...selection.values()];
  try {
    toast(tr("Building practice set…", "Creando práctica…"));
    const paper = await makePdf(qs.map((q) => ({ path: q.papers!.storage_path, start: q.start_page, end: q.end_page })));
    let ms: Uint8Array | null = null;
    if (withMs) {
      const parts = (await Promise.all(qs.map(msQuestion))).filter((x): x is NonNullable<typeof x> => !!x);
      if (parts.length) ms = await makePdf(parts);
      if (parts.length < qs.length) toast(tr("Some markscheme pages were not found.", "No se encontraron algunas páginas del esquema."));
    }
    showSet(paper, ms);
  } catch (e) {
    toast(errorText(e), true);
  }
}

function download(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Shows the generated set in the app; download buttons only when allowed. */
function showSet(paper: Uint8Array, ms: Uint8Array | null): void {
  const pages = h("div", { class: "pages" });
  const dialog = h("dialog", { class: "wide" },
    h("div", { class: "row" },
      h("h2", {}, tr("Practice set", "Práctica")),
      canDownload() ? h("button", { class: "btn", onclick: () => download(paper, "practice-set.pdf") }, tr("Download PDF", "Descargar PDF")) : "",
      canDownload() && ms ? h("button", { class: "btn btn-secondary", onclick: () => download(ms, "practice-set-markscheme.pdf") }, tr("Download markscheme", "Descargar esquema")) : "",
      ms ? h("button", { class: "btn btn-secondary", onclick: () => void show(ms) }, tr("Show markscheme", "Ver esquema")) : "",
      h("button", { class: "btn btn-ghost", onclick: () => dialog.close() }, tr("Close", "Cerrar")),
    ),
    canDownload() ? "" : h("p", { class: "small muted" }, tr("Downloads are turned off: view the set here.", "Las descargas están desactivadas: mira la práctica aquí.")),
    pages,
  );
  async function show(bytes: Uint8Array) {
    pages.replaceChildren();
    const doc = await openPdf(bytes.slice().buffer);
    const width = Math.min(900, window.innerWidth - 48);
    for (let i = 1; i <= doc.numPages; i++) pages.append(await renderPage(doc, i, width, watermarkText()));
  }
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  void show(paper);
}
