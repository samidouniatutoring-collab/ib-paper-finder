// OCR for scanned PDFs (pages that are pictures, with no text inside). Runs in this browser with tesseract.js;
// the engine and the English + Spanish language data are downloaded once and then cached by the browser.
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Worker as OcrWorker } from "tesseract.js";

let worker: Promise<OcrWorker> | null = null;

function ocrWorker(): Promise<OcrWorker> {
  worker ??= import("tesseract.js").then(({ createWorker }) => createWorker(["eng", "spa"]));
  return worker;
}

/** Reads the text of one page by rendering it as an image (about 2000 px wide) and running OCR on it. */
export async function ocrPage(doc: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(3, 2000 / base.width) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
  const w = await ocrWorker();
  const { data } = await w.recognize(canvas);
  canvas.width = canvas.height = 0;
  return data.text ?? "";
}
