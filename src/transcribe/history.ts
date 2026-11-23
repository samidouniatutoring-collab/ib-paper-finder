// Finished transcripts are kept on this device only (text and numbers, never the audio).
import type { Job } from "./types";

const KEY = "transcriber-history";
const MAX = 25;

export function loadHistory(): Job[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Job[]; } catch { return []; }
}

export function saveJob(job: Job): void {
  const list = [job, ...loadHistory().filter((j) => j.id !== job.id)].slice(0, MAX);
  // Word timings are the bulk of the data; drop them from older entries if storage gets tight.
  for (let i = 0; i < 3; i++) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return; }
    catch { list.forEach((j, k) => { if (k > 0) j.segments.forEach((s) => delete s.words); }); list.splice(Math.max(5, list.length - 5)); }
  }
}

export function deleteJob(id: string): void {
  try { localStorage.setItem(KEY, JSON.stringify(loadHistory().filter((j) => j.id !== id))); } catch { /* ignore */ }
}
