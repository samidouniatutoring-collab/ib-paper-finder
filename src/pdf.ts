// pdf.js helpers: text extraction (owner processing) and canvas rendering with a watermark.
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import "./lib/stream-polyfill";
import { BUCKET, SIGNED_URL_SECONDS, supabase } from "./config";
import { tr } from "./i18n";
import { deleteFile, getFile, isNetworkError, putFile } from "./offline";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let lib: Promise<PdfJs> | null = null;

function pdfjs(): Promise<PdfJs> {
  lib ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
    // Our own worker so the Safari stream fix runs inside it too.
    m.GlobalWorkerOptions.workerPort = new Worker(new URL("./pdfjs.worker.ts", import.meta.url), { type: "module" });
    return m;
  });
  return lib;
}

/** Opens a PDF from bytes. pdf.js takes ownership of the buffer, so we always pass a copy. */
export async function openPdf(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  const m = await pdfjs();
  return m.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
}

/** Text of every page, one line per text row. */
export async function extractPages(doc: PDFDocumentProxy): Promise<string[]> {
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let out = "";
    let lastY: number | null = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform[5] as number;
      if (lastY !== null && Math.abs(y - lastY) > 2 && !out.endsWith("\n")) out += "\n";
      out += item.str;
      if (item.hasEOL) out += "\n";
      lastY = y;
    }
    pages.push(out);
    page.cleanup();
  }
  return pages;
}

const bytesCache = new Map<string, Promise<ArrayBuffer>>();

/**
 * Downloads a paper through a 60-second signed URL (the bucket is private) and keeps an offline copy on
 * this device. Without a connection the offline copy is used. If the server refuses (access removed or
 * file deleted), the offline copy is deleted too. Cached in memory for this tab.
 */
export function loadPaperBytes(storagePath: string): Promise<ArrayBuffer> {
  let p = bytesCache.get(storagePath);
  if (!p) {
    p = (async () => {
      if (!supabase) throw new Error("Not configured");
      if (navigator.onLine === false) {
        const saved = await getFile(storagePath);
        if (saved) return saved;
      }
      try {
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_SECONDS);
        if (error || !data) throw error ?? new Error("Could not open the file");
        const res = await fetch(data.signedUrl);
        if (!res.ok) throw Object.assign(new Error(`Download failed (${res.status})`), { status: res.status });
        const bytes = await res.arrayBuffer();
        void putFile(storagePath, bytes);
        return bytes;
      } catch (e) {
        if (isNetworkError(e)) {
          const saved = await getFile(storagePath);
          if (saved) return saved;
          throw new Error(tr("You're offline, and this paper hasn't been opened on this device before.", "No tienes conexión y este examen no se ha abierto antes en este dispositivo."));
        }
        await deleteFile(storagePath);
        throw e;
      }
    })();
    p.catch(() => bytesCache.delete(storagePath));
    bytesCache.set(storagePath, p);
  }
  return p;
}

const docCache = new Map<string, Promise<PDFDocumentProxy>>();
export function loadPaperDoc(storagePath: string): Promise<PDFDocumentProxy> {
  let d = docCache.get(storagePath);
  if (!d) {
    d = loadPaperBytes(storagePath).then(openPdf);
    d.catch(() => docCache.delete(storagePath));
    docCache.set(storagePath, d);
  }
  return d;
}

/** Renders one page into a new canvas sized to `width` CSS pixels, with a light diagonal watermark. */
export async function renderPage(doc: PDFDocumentProxy, pageNumber: number, width: number, watermark: string): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: (width / base.width) * ratio });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
  canvas.className = "page";
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  await page.render({ canvas, viewport }).promise;
  drawWatermark(canvas, watermark);
  return canvas;
}

function drawWatermark(canvas: HTMLCanvasElement, text: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = Math.max(12, canvas.width / 40);
  ctx.save();
  ctx.font = `${size}px -apple-system, system-ui, sans-serif`;
  ctx.fillStyle = "rgba(30, 58, 138, 0.10)";
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(-Math.PI / 6);
  ctx.textAlign = "center";
  for (let y = -canvas.height; y < canvas.height; y += size * 8) ctx.fillText(text, 0, y);
  ctx.restore();
  ctx.font = `${size * 0.7}px -apple-system, system-ui, sans-serif`;
  ctx.fillStyle = "rgba(30, 58, 138, 0.35)";
  ctx.fillText(text, size, canvas.height - size);
}
