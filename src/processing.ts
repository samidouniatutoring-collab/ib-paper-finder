// Owner-side processing: hash + analyse in a Web Worker, text via pdf.js (its own worker), upload to the private bucket.
import JSZip from "jszip";
import type { Analysis, WorkerRequest } from "./analyse.worker";
import { BUCKET } from "./config";
import { db, findMarkscheme, findPaperFor, type Paper } from "./data";
import { splitMarkscheme } from "./lib/markscheme";
import type { Detected } from "./lib/detect";
import { cleanBody } from "./lib/snippet";
import { extractPages, loadPaperBytes, openPdf } from "./pdf";

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

type Req = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;
function call<T>(msg: Req, transfer: Transferable[] = []): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL("./analyse.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const p = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (e.data.error) p?.reject(new Error(e.data.error));
      else p?.resolve(e.data.result);
    };
  }
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker!.postMessage({ ...msg, id }, transfer);
  });
}

export interface InputFile {
  name: string;
  bytes: () => Promise<ArrayBuffer>;
}

/** Expands chosen files/folders: PDFs as-is, .zip files unpacked (PDFs inside only). */
export async function expandFiles(files: File[]): Promise<InputFile[]> {
  const out: InputFile[] = [];
  for (const f of files) {
    const name = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    if (/\.zip$/i.test(f.name)) {
      const zip = await JSZip.loadAsync(f);
      zip.forEach((path, entry) => {
        if (!entry.dir && /\.pdf$/i.test(path) && !path.includes("__MACOSX")) {
          out.push({ name: path, bytes: () => entry.async("arraybuffer") });
        }
      });
    } else if (/\.pdf$/i.test(f.name)) {
      out.push({ name, bytes: () => f.arrayBuffer() });
    }
  }
  return out;
}

export type FileResult = { name: string; status: "added" | "duplicate" | "error"; message?: string; needsReview?: boolean };

/**
 * Saves a paper's questions, keeping the ids of questions that still exist (same number), so homework,
 * progress and markscheme mappings survive a re-split. Auto tags are replaced; questions that disappeared are deleted.
 */
async function saveQuestions(paperId: string, analysis: Analysis): Promise<void> {
  const client = db();
  const numbers = analysis.questions.map((q) => q.number);
  const { data: old, error: oldErr } = await client.from("questions").select("id, number").eq("paper_id", paperId);
  if (oldErr) throw oldErr;
  const gone = (old ?? []).filter((r: { number: number }) => !numbers.includes(r.number)).map((r: { id: string }) => r.id);
  if (gone.length) {
    const { error } = await client.from("questions").delete().in("id", gone);
    if (error) throw error;
  }
  if (!analysis.questions.length) return;
  const { data, error } = await client
    .from("questions")
    .upsert(
      analysis.questions.map((q) => ({
        paper_id: paperId,
        number: q.number,
        label: q.label,
        start_page: q.startPage,
        end_page: q.endPage,
        marks: q.marks,
        page_level: q.pageLevel,
        body: cleanBody(q.text),
      })),
      { onConflict: "paper_id,number" },
    )
    .select("id, number");
  if (error) throw error;
  const idByNumber = new Map((data ?? []).map((r: { id: string; number: number }) => [r.number, r.id]));
  const ids = [...idByNumber.values()];
  const { error: delTags } = await client.from("question_tags").delete().in("question_id", ids);
  if (delTags) throw delTags;
  const tags = analysis.questions.flatMap((q) =>
    q.tags.map((t) => ({ question_id: idByNumber.get(q.number), topic: t.topic, confidence: t.confidence, source: "auto" })),
  );
  if (tags.length) {
    const { error: tagErr } = await client.from("question_tags").insert(tags);
    if (tagErr) throw tagErr;
  }
}

function needsReview(d: Detected): boolean {
  return !d.subject || !d.year || !d.paperNumber || !d.session;
}

async function processOne(file: InputFile, knownHashes: Set<string>): Promise<FileResult> {
  const bytes = await file.bytes();
  const hash = await call<string>({ type: "hash", bytes: bytes.slice(0) });
  if (knownHashes.has(hash)) return { name: file.name, status: "duplicate" };
  knownHashes.add(hash);

  const doc = await openPdf(bytes);
  const pages = await extractPages(doc);
  const pageCount = doc.numPages;
  await doc.destroy();
  const analysis = await call<Analysis>({ type: "analyse", name: file.name, pages });

  const path = `${hash}.pdf`;
  const client = db();
  const up = await client.storage.from(BUCKET).upload(path, new Blob([bytes], { type: "application/pdf" }), {
    upsert: true,
    contentType: "application/pdf",
  });
  if (up.error) throw up.error;

  const d = analysis.detected;
  const { data, error } = await client
    .from("papers")
    .insert({
      storage_path: path,
      file_hash: hash,
      original_name: file.name,
      subject: d.subject,
      level: d.level,
      year: d.year,
      session: d.session,
      timezone: d.timezone,
      paper_number: d.paperNumber,
      kind: d.kind,
      page_count: pageCount,
      needs_review: needsReview(d),
    })
    .select("*")
    .single();
  if (error) throw error;
  await saveQuestions(data.id, analysis);
  // Pair with the markscheme (or paper) if it is already in the library; never fails the upload.
  await linkMarkscheme(data as Paper, pages).catch(() => 0);
  return { name: file.name, status: "added", needsReview: needsReview(d) };
}

/** Processes files two at a time; calls onProgress after each file. */
export async function processFiles(
  files: InputFile[],
  existingHashes: string[],
  onProgress: (done: number, total: number, last: FileResult) => void,
): Promise<FileResult[]> {
  const known = new Set(existingHashes);
  const results: FileResult[] = [];
  let next = 0;
  const runner = async () => {
    while (next < files.length) {
      const f = files[next++];
      let r: FileResult;
      try {
        r = await processOne(f, known);
      } catch (e) {
        console.error("Upload failed:", f.name, e);
        const msg =
          e instanceof Error
            ? e.message
            : e && typeof e === "object" && "message" in e
              ? String((e as { message: unknown }).message)
              : (() => { try { return JSON.stringify(e); } catch { return String(e); } })();
        r = { name: f.name, status: "error", message: msg || "unknown error" };
      }
      results.push(r);
      onProgress(results.length, files.length, r);
    }
  };
  await Promise.all([runner(), runner()]);
  return results;
}

/** Re-splits and re-tags a paper with its current (owner-corrected) details. Replaces its questions and tags. */
export async function reanalyse(p: Paper): Promise<number> {
  const bytes = await loadPaperBytes(p.storage_path);
  const doc = await openPdf(bytes);
  const pages = await extractPages(doc);
  await doc.destroy();
  const analysis = await call<Analysis>({
    type: "analyse",
    name: p.original_name,
    pages,
    override: {
      subject: p.subject as Detected["subject"],
      paperNumber: p.paper_number,
      kind: p.kind,
    },
  });
  await saveQuestions(p.id, analysis);
  return analysis.questions.length;
}

/** Fills in the search text of a paper's existing questions (no re-split, tags and ids untouched). */
export async function refreshSearchText(p: Paper): Promise<number> {
  const bytes = await loadPaperBytes(p.storage_path);
  const doc = await openPdf(bytes);
  const pages = await extractPages(doc);
  await doc.destroy();
  const analysis = await call<Analysis>({ type: "analyse", name: p.original_name, pages, override: { subject: p.subject as Detected["subject"], paperNumber: p.paper_number, kind: p.kind } });
  let n = 0;
  for (const q of analysis.questions) {
    const { error, count } = await db().from("questions").update({ body: cleanBody(q.text) }, { count: "exact" }).eq("paper_id", p.id).eq("number", q.number);
    if (error) throw error;
    n += count ?? 0;
  }
  return n;
}

async function pageTexts(p: Paper): Promise<string[]> {
  const doc = await openPdf(await loadPaperBytes(p.storage_path));
  const pages = await extractPages(doc);
  await doc.destroy();
  return pages;
}

/**
 * Splits the markscheme of a paper/markscheme pair by the paper's question numbers and stores each question's
 * markscheme pages. Ranges the owner corrected by hand are kept. Returns how many questions were mapped.
 */
export async function linkMarkscheme(p: Paper, pages?: string[]): Promise<number> {
  if (p.kind === "prerelease") return 0;
  const paper = p.kind === "paper" ? p : await findPaperFor(p);
  const ms = p.kind === "markscheme" ? p : await findMarkscheme(p);
  if (!paper || !ms) return 0;
  const msPages = p.kind === "markscheme" && pages ? pages : await pageTexts(ms);
  const client = db();
  const { data: qs, error } = await client.from("questions").select("id, number, page_level").eq("paper_id", paper.id);
  if (error) throw error;
  const numbered = (qs ?? []).filter((q: { page_level: boolean }) => !q.page_level) as { id: string; number: number }[];
  if (!numbered.length) return 0;
  const ids = numbered.map((q) => q.id);
  const { data: existing, error: exErr } = await client.from("markscheme_ranges").select("question_id, source").in("question_id", ids);
  if (exErr) throw exErr;
  const byOwner = new Set((existing ?? []).filter((r: { source: string }) => r.source === "owner").map((r: { question_id: string }) => r.question_id));
  const { error: delErr } = await client.from("markscheme_ranges").delete().in("question_id", ids).eq("source", "auto");
  if (delErr) throw delErr;
  const map = splitMarkscheme(msPages, numbered.map((q) => q.number));
  const rows = numbered
    .filter((q) => map.has(q.number) && !byOwner.has(q.id))
    .map((q) => ({ question_id: q.id, markscheme_id: ms.id, start_page: map.get(q.number)!.start, end_page: map.get(q.number)!.end, source: "auto" }));
  if (rows.length) {
    const { error: upErr } = await client.from("markscheme_ranges").upsert(rows);
    if (upErr) throw upErr;
  }
  return rows.length;
}

/**
 * Re-reads a paper's details (year, session, level, paper number, timezone, subject) from the PDF itself and fills in
 * the ones that are still empty. Details you set by hand are kept. Then pairs it with its markscheme.
 * Returns true when something was filled in.
 */
export async function redetect(p: Paper): Promise<boolean> {
  const bytes = await loadPaperBytes(p.storage_path);
  const doc = await openPdf(bytes);
  const pages = await extractPages(doc);
  await doc.destroy();
  const a = await call<Analysis>({ type: "analyse", name: p.original_name, pages });
  const d = a.detected;
  const merged: Detected = {
    subject: (p.subject as Detected["subject"]) ?? d.subject,
    level: (p.level as Detected["level"]) ?? d.level,
    year: p.year ?? d.year,
    session: (p.session as Detected["session"]) ?? d.session,
    timezone: (p.timezone as Detected["timezone"]) ?? d.timezone,
    paperNumber: p.paper_number ?? d.paperNumber,
    kind: p.kind === "paper" && d.kind !== "paper" ? d.kind : p.kind,
  };
  const changed =
    merged.subject !== p.subject || merged.level !== p.level || merged.year !== p.year || merged.session !== p.session ||
    merged.timezone !== p.timezone || merged.paperNumber !== p.paper_number || merged.kind !== p.kind;
  const row = {
    subject: merged.subject, level: merged.level, year: merged.year, session: merged.session, timezone: merged.timezone,
    paper_number: merged.paperNumber, kind: merged.kind, needs_review: needsReview(merged),
  };
  const { data, error } = await db().from("papers").update(row).eq("id", p.id).select("*").single();
  if (error) throw error;
  await linkMarkscheme(data as Paper, merged.kind === "markscheme" ? pages : undefined).catch(() => 0);
  return changed;
}
