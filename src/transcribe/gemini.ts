// Talks to Google's Gemini API with the person's own key (kept only in this browser).
// Gemini only writes down what was said. It never grades: grading happens in Claude with the packet.

import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import type { PronNotes, Segment } from "./types";

export interface EngineSettings {
  apiKey: string;
  engine: "transcribe" | "flash"; // transcribe = dedicated speech model; flash = general model, fallback
  transcribeModel: string;
  flashModel: string;
}

export const DEFAULT_SETTINGS: Omit<EngineSettings, "apiKey"> = {
  engine: "transcribe",
  transcribeModel: "gemini-3.5-transcribe",
  flashModel: "gemini-3.5-flash",
};

const KEY = "transcriber-settings";

export function loadSettings(): EngineSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, apiKey: "", ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS, apiKey: "" };
}

export function saveSettings(s: EngineSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
  void idb("put", JSON.stringify(s));
  // Ask the browser not to clear this site's storage (Safari otherwise may).
  try { void navigator.storage?.persist?.(); } catch { /* ignore */ }
}

/** Second copy of the settings in IndexedDB, so the key survives if the browser drops localStorage. */
function idb(op: "get" | "put", value?: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open("transcriber", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onerror = () => resolve(undefined);
      req.onsuccess = () => {
        const tx = req.result.transaction("kv", op === "get" ? "readonly" : "readwrite");
        const st = tx.objectStore("kv");
        const r = op === "get" ? st.get(KEY) : st.put(value, KEY);
        r.onsuccess = () => resolve(op === "get" ? (r.result as string | undefined) : value);
        r.onerror = () => resolve(undefined);
      };
    } catch { resolve(undefined); }
  });
}
/** If localStorage lost the key but IndexedDB still has it, restore it. Returns true if something was restored. */
export async function restoreSettings(): Promise<boolean> {
  if (loadSettings().apiKey) { void idb("put", JSON.stringify(loadSettings())); return false; }
  const raw = await idb("get");
  if (!raw) return false;
  try { const s = JSON.parse(raw) as EngineSettings; if (!s.apiKey) return false; localStorage.setItem(KEY, raw); return true; } catch { return false; }
}

/** "1.250s" → 1.25 */
export const secs = (v: string | number | undefined | null): number => (typeof v === "number" ? v : v ? parseFloat(String(v).replace(/s$/, "")) || 0 : 0);

/** File types the speech model accepts directly; anything else (video, unusual audio) is sent as WAV. */
export const DIRECT_TYPES = ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/aiff", "audio/aac", "audio/ogg", "audio/flac", "audio/x-m4a", "audio/m4a", "audio/mp4", "audio/webm", "audio/opus"];

export function mimeFor(file: File): string | null {
  const t = (file.type || "").toLowerCase();
  if (DIRECT_TYPES.includes(t)) return t === "audio/mp4" || t === "audio/x-m4a" ? "audio/m4a" : t;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const byExt: Record<string, string> = { m4a: "audio/m4a", mp3: "audio/mp3", wav: "audio/wav", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", flac: "audio/flac", webm: "audio/webm", opus: "audio/opus", aiff: "audio/aiff", aif: "audio/aiff" };
  return byExt[ext] ?? null; // mp4/mov video → null → convert to WAV
}

function client(s: EngineSettings): GoogleGenAI {
  if (!s.apiKey.trim()) throw new Error("Add your Google AI Studio API key in Settings first.");
  // v1beta: the version the speech-model docs use (transcription settings live there).
  return new GoogleGenAI({ apiKey: s.apiKey.trim(), apiVersion: "v1beta" });
}

export interface Uploaded { uri: string; mimeType: string; name: string; }

/** Upload once, then wait until Google has processed the file. */
export async function upload(s: EngineSettings, blob: Blob, mimeType: string, displayName: string): Promise<Uploaded> {
  const ai = client(s);
  let f = await ai.files.upload({ file: blob, config: { mimeType, displayName } });
  for (let i = 0; i < 90 && f.state === "PROCESSING"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    f = await ai.files.get({ name: f.name! });
  }
  if (f.state === "FAILED") throw new Error("Google could not process this file.");
  return { uri: f.uri!, mimeType: f.mimeType ?? mimeType, name: f.name! };
}

export async function removeUpload(s: EngineSettings, name: string): Promise<void> {
  try { await client(s).files.delete({ name }); } catch { /* the file expires by itself after 48 h */ }
}

/** Turn the speech model's answer into speaker turns. Exported for tests. */
export function parseTranscribe(res: GenerateContentResponse): Segment[] {
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  const segs: Segment[] = [];
  for (const p of parts) {
    const t = p.audioTranscription;
    if (!t) continue;
    const words = (t.words ?? []).map((w) => ({ w: w.word ?? "", s: secs(w.startOffset), e: secs(w.endOffset) })).filter((w) => w.w);
    const text = (t.text ?? words.map((w) => w.w).join(" ")).trim();
    if (!text) continue;
    const start = t.startOffset != null ? secs(t.startOffset) : words[0]?.s ?? 0;
    const end = t.endOffset != null ? secs(t.endOffset) : words[words.length - 1]?.e ?? start;
    segs.push({ speaker: t.speakerLabel || "spk_1", start, end, text, words: words.length ? words : undefined, language: t.languageCode });
  }
  return mergeTurns(segs);
}

/** Consecutive pieces from the same speaker with a gap under 1.5 s become one turn. */
export function mergeTurns(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of [...segs].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && last.speaker === s.speaker && s.start - last.end < 1.5) {
      last.end = Math.max(last.end, s.end);
      last.text = `${last.text} ${s.text}`.trim();
      if (s.words) last.words = [...(last.words ?? []), ...s.words];
    } else out.push({ ...s, words: s.words ? [...s.words] : undefined });
  }
  return out;
}

const VERBATIM_RULES = `Write EXACTLY what is said, word for word, like a court reporter. Never correct grammar, vocabulary, gender or verb agreement, even when it is wrong (the speakers may be language learners and their mistakes must stay). Keep fillers (eh, ehm, um, euh), repetitions, false starts and self-corrections; mark a cut-off word with a hyphen ("compr-"). If a word is unclear, write your best guess followed by [?]. Never translate: write each word in the language it was spoken.`;

/** Speech model: verbatim mode with speaker labels and word times. */
export async function transcribeSpeech(s: EngineSettings, file: Uploaded, languages: string[]): Promise<Segment[]> {
  const res = await client(s).models.generateContent({
    model: s.transcribeModel,
    contents: [{ role: "user", parts: [{ fileData: { fileUri: file.uri, mimeType: file.mimeType } }] }],
    config: { audioTranscriptionConfig: { mode: "VERBATIM" as never, diarization: true, wordTimestamp: true, ...(languages.length ? { languageCodes: languages } : {}) } },
  });
  const segs = parseTranscribe(res);
  if (!segs.length) throw new Error("The transcriber returned nothing. Try the Flash engine in Settings.");
  return segs;
}

/** Fallback: the general model, asked for verbatim JSON. No word times, but works on more free plans. */
export async function transcribeFlash(s: EngineSettings, file: Uploaded, languages: string[], speakersHint: string): Promise<Segment[]> {
  const res = await client(s).models.generateContent({
    model: s.flashModel,
    contents: [{ role: "user", parts: [
      { fileData: { fileUri: file.uri, mimeType: file.mimeType } },
      { text: `Transcribe this recording. ${VERBATIM_RULES}\nLanguages likely present: ${languages.join(", ") || "detect"}. ${speakersHint}\nSplit into turns each time the speaker changes. Label speakers spk_1, spk_2… in order of first appearance. Give start and end in seconds.` },
    ] }],
    config: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: { type: "array" as never, items: { type: "object" as never, properties: { speaker: { type: "string" as never }, start: { type: "number" as never }, end: { type: "number" as never }, text: { type: "string" as never } }, required: ["speaker", "start", "end", "text"] } },
    },
  });
  const arr = JSON.parse(res.text ?? "[]") as Segment[];
  return mergeTurns(arr.filter((x) => x.text?.trim()).map((x) => ({ speaker: x.speaker || "spk_1", start: +x.start || 0, end: +x.end || +x.start || 0, text: x.text.trim() })));
}

/**
 * Pronunciation and intonation OBSERVATIONS for one speaker (no marks, no levels).
 * This is the only part that needs ears; Claude turns it into a grade together with everything else.
 */
export async function pronunciationNotes(s: EngineSettings, file: Uploaded, targetLanguage: string, who: string, transcript: string): Promise<PronNotes> {
  const res = await client(s).models.generateContent({
    model: s.flashModel,
    contents: [{ role: "user", parts: [
      { fileData: { fileUri: file.uri, mimeType: file.mimeType } },
      { text: `You are a phonetics note-taker, not an examiner. Listen to ${who} speaking ${targetLanguage}. Do NOT give a score, band, level or opinion of quality.
List up to 40 specific moments where pronunciation clearly differs from a standard native accent: give the time (mm:ss), the word as said (approximate spelling), the expected form, and the issue (e.g. vowel, rolled r, stress on wrong syllable, French/English transfer, unclear). Only include clear cases.
Then describe intonation factually in 2–3 sentences (e.g. rising questions, flat stretches, sentence-final falls, rhythm).
Then one factual sentence on how easy the speech is to follow.
Transcript for reference (do not correct it):\n${transcript.slice(0, 12000)}` },
    ] }],
    config: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: { type: "object" as never, properties: {
        notes: { type: "array" as never, items: { type: "object" as never, properties: { time: { type: "string" as never }, said: { type: "string" as never }, expected: { type: "string" as never }, issue: { type: "string" as never } }, required: ["time", "said", "expected", "issue"] } },
        intonation: { type: "string" as never }, overall: { type: "string" as never },
      }, required: ["notes", "intonation", "overall"] },
    },
  });
  return JSON.parse(res.text ?? "{}") as PronNotes;
}

/** Turn Google's errors into something a student can act on. */
export function friendlyError(e: unknown): string {
  const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
  if (/API key not valid|API_KEY_INVALID|401|403/i.test(msg)) return "Google refused the API key. Check it in Settings (aistudio.google.com → Get API key).";
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) return "Google's free limit was reached for now. Wait a minute (or until tomorrow for the daily limit), or switch the engine in Settings.";
  if (/not found|404|is not supported/i.test(msg)) return `Google doesn't offer that model to this key (${msg.slice(0, 120)}). In Settings, switch engine or change the model name.`;
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return "No connection to Google. Check your internet and try again.";
  return msg;
}
