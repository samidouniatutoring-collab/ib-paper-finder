// Homework submissions: photos (or PDFs) of a student's answers, uploaded to the private "submissions" bucket.
import JSZip from "jszip";
import { db, state, type Submission } from "./data";

export const SUB_BUCKET = "submissions";

/** Shrinks a photo to at most 1600 px on its longest side as a JPEG (about 200–400 KB). PDFs pass through. */
export async function shrink(file: File): Promise<Blob> {
  if (file.type === "application/pdf") return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't read the photo"))), "image/jpeg", 0.72));
}

export async function submit(setId: string, files: File[], note: string, onStep?: (i: number, n: number) => void): Promise<void> {
  const uid = state.profile!.id;
  const stamp = Date.now();
  const paths: string[] = [];
  for (let i = 0; i < files.length; i++) {
    onStep?.(i + 1, files.length);
    const blob = await shrink(files[i]);
    const ext = blob.type === "application/pdf" ? "pdf" : "jpg";
    const path = `${uid}/${setId}/${stamp}-${String(i + 1).padStart(2, "0")}.${ext}`;
    const { error } = await db().storage.from(SUB_BUCKET).upload(path, blob, { contentType: blob.type || "image/jpeg" });
    if (error) {
      if (paths.length) await db().storage.from(SUB_BUCKET).remove(paths);
      throw error;
    }
    paths.push(path);
  }
  const { error } = await db().from("homework_submissions").insert({ set_id: setId, user_id: uid, files: paths, note });
  if (error) {
    await db().storage.from(SUB_BUCKET).remove(paths);
    throw error;
  }
}

export async function signedUrls(paths: string[]): Promise<string[]> {
  if (!paths.length) return [];
  const { data, error } = await db().storage.from(SUB_BUCKET).createSignedUrls(paths, 600);
  if (error) throw error;
  return (data ?? []).map((d) => d.signedUrl ?? "");
}

/** A .zip of the submission's files, named so it can go straight into the student's folder. */
export async function zipSubmission(s: Submission, name: string): Promise<Blob> {
  const zip = new JSZip();
  for (const path of s.files) {
    const { data, error } = await db().storage.from(SUB_BUCKET).download(path);
    if (error) throw error;
    zip.file(path.split("/").pop()!, data);
  }
  void name;
  return zip.generateAsync({ type: "blob" });
}

export async function deleteSubmission(s: Submission): Promise<void> {
  if (s.files.length) {
    const { error } = await db().storage.from(SUB_BUCKET).remove(s.files);
    if (error) throw error;
  }
  const { error } = await db().from("homework_submissions").delete().eq("id", s.id);
  if (error) throw error;
}
