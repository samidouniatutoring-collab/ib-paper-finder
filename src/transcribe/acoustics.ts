// Audio measurements that stand in for "listening": speaking speed, pauses, fillers and pitch movement.
// Everything here is pure maths on a mono Float32Array so it can be unit-tested without a browser.
// None of it is a pronunciation score. It is evidence for whoever grades (pace, hesitation, how monotone the voice is).

import type { Segment } from "./types";

export const FRAME_SEC = 0.02; // 20 ms analysis frames

/** Loudness of each 20 ms frame in dBFS. */
export function frameDb(samples: Float32Array, sr: number, frameSec = FRAME_SEC): Float32Array {
  const n = Math.max(1, Math.round(sr * frameSec));
  const frames = Math.floor(samples.length / n);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const off = f * n;
    for (let i = 0; i < n; i++) { const v = samples[off + i]; sum += v * v; }
    const rms = Math.sqrt(sum / n);
    out[f] = 20 * Math.log10(rms + 1e-9);
  }
  return out;
}

export function percentile(values: ArrayLike<number>, p: number): number {
  const arr = Array.from(values).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return NaN;
  const idx = Math.min(arr.length - 1, Math.max(0, (arr.length - 1) * p));
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo);
}

/**
 * Voice activity: a frame counts as speech when it is clearly louder than the room's noise floor.
 * The floor is the 10th percentile of loudness, so it adapts to classroom noise. A short hangover
 * stops single quiet frames inside words from being counted as pauses.
 */
export function voiceActivity(db: Float32Array, marginDb = 12, hangFrames = 4): Uint8Array {
  const floor = percentile(db, 0.1);
  const loud = percentile(db, 0.95);
  // In very compressed or noisy recordings the gap is small: never ask for more than half of it.
  const thr = floor + Math.min(marginDb, Math.max(4, (loud - floor) / 2));
  const out = new Uint8Array(db.length);
  let hang = 0;
  for (let i = 0; i < db.length; i++) {
    if (db[i] >= thr) { out[i] = 1; hang = hangFrames; }
    else if (hang > 0) { out[i] = 1; hang--; }
  }
  return out;
}

export interface Pause { start: number; end: number; }

/** Silent stretches of at least minSec, inside [from, to] (seconds). */
export function findPauses(vad: Uint8Array, from = 0, to = Infinity, minSec = 0.4, frameSec = FRAME_SEC): Pause[] {
  const out: Pause[] = [];
  const a = Math.max(0, Math.floor(from / frameSec));
  const b = Math.min(vad.length, Math.ceil(Math.min(to, vad.length * frameSec) / frameSec));
  let start = -1;
  for (let i = a; i < b; i++) {
    if (!vad[i]) { if (start < 0) start = i; }
    else if (start >= 0) {
      if ((i - start) * frameSec >= minSec) out.push({ start: start * frameSec, end: i * frameSec });
      start = -1;
    }
  }
  // A silence that runs into the end of the window is the gap before the next speaker, not a pause.
  return out;
}

/**
 * Fundamental frequency (pitch) with the YIN method, one value per hop. 0 = unvoiced.
 * Run it on 8 kHz audio: speech pitch (60–450 Hz) is well below 4 kHz and it is 4× faster.
 */
export function yinPitch(samples: Float32Array, sr: number, opts: { hopSec?: number; winSec?: number; fmin?: number; fmax?: number; threshold?: number } = {}): Float32Array {
  const hop = Math.round(sr * (opts.hopSec ?? 0.04));
  const win = Math.round(sr * (opts.winSec ?? 0.04));
  const tauMin = Math.floor(sr / (opts.fmax ?? 450));
  const tauMax = Math.min(win - 1, Math.ceil(sr / (opts.fmin ?? 60)));
  const thr = opts.threshold ?? 0.15;
  const frames = Math.max(0, Math.floor((samples.length - win - tauMax) / hop));
  const out = new Float32Array(frames);
  const d = new Float32Array(tauMax + 1);
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    let energy = 0;
    for (let i = 0; i < win; i++) energy += samples[off + i] * samples[off + i];
    if (energy / win < 1e-6) continue; // silence
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let i = 0; i < win; i++) { const x = samples[off + i] - samples[off + i + tau]; s += x * x; }
      running += s;
      d[tau] = running > 0 ? (s * tau) / running : 1;
    }
    let best = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < thr) {
        while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best <= 0) continue;
    // Parabolic interpolation for sub-sample accuracy.
    const a = d[best - 1] ?? d[best], b = d[best], c = d[best + 1] ?? d[best];
    const den = a + c - 2 * b;
    const shift = den !== 0 ? (a - c) / (2 * den) : 0;
    out[f] = sr / (best + shift);
  }
  return out;
}

/** Simple decimation by an integer factor with a moving-average low-pass (good enough for pitch). */
export function decimate(samples: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return samples;
  const out = new Float32Array(Math.floor(samples.length / factor));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += samples[i * factor + k];
    out[i] = s / factor;
  }
  return out;
}

const semis = (hz: number, ref: number) => 12 * Math.log2(hz / ref);

export interface PitchStats { medianHz: number; rangeSemitones: number; sdSemitones: number; voicedSec: number; }

/** Pitch summary over the given time ranges. Range = 10th→90th percentile, so odd spikes don't count. */
export function pitchStats(f0: Float32Array, hopSec: number, ranges: { start: number; end: number }[]): PitchStats | null {
  const vals: number[] = [];
  for (const r of ranges) {
    const a = Math.max(0, Math.floor(r.start / hopSec)), b = Math.min(f0.length, Math.ceil(r.end / hopSec));
    for (let i = a; i < b; i++) if (f0[i] > 0) vals.push(f0[i]);
  }
  if (vals.length < 25) return null; // under ~1 s of voiced speech: not enough to say anything
  const med = percentile(vals, 0.5);
  // Octave errors (a doubled or halved estimate) are the classic pitch-tracker mistake: drop them.
  const clean = vals.filter((v) => v > med / 1.8 && v < med * 1.8);
  const st = clean.map((v) => semis(v, med));
  const mean = st.reduce((a, b) => a + b, 0) / st.length;
  const sd = Math.sqrt(st.reduce((a, b) => a + (b - mean) ** 2, 0) / st.length);
  return { medianHz: Math.round(med), rangeSemitones: +(percentile(st, 0.9) - percentile(st, 0.1)).toFixed(1), sdSemitones: +sd.toFixed(1), voicedSec: +(clean.length * hopSec).toFixed(1) };
}

// Hesitation words per language. Kept short and unambiguous: "este" or "bueno" are often real words, so they aren't counted.
const FILLERS: Record<string, string[]> = {
  es: ["eh", "ehm", "em", "emm", "mm", "mmm", "este eh", "o sea", "pues eh"],
  en: ["uh", "um", "uhm", "erm", "er", "hmm", "mm", "you know", "i mean"],
  fr: ["euh", "heu", "bah", "ben", "hum", "euhm"],
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z\s']/g, " ").replace(/\s+/g, " ").trim();

export function countFillers(text: string): { total: number; byWord: Record<string, number> } {
  const t = ` ${norm(text)} `;
  const byWord: Record<string, number> = {};
  let total = 0;
  const all = [...new Set(Object.values(FILLERS).flat())].sort((a, b) => b.length - a.length);
  let rest = t;
  for (const f of all) {
    const re = new RegExp(` ${f.replace(/\s+/g, " ")}(?= )`, "g");
    const m = rest.match(re);
    if (m?.length) { byWord[f] = m.length; total += m.length; rest = rest.replace(re, " "); }
  }
  return { total, byWord };
}

/** Immediate word repetitions ("el el", "que que"): a sign of hesitation or self-correction. */
export function countRepetitions(text: string): number {
  const w = norm(text).split(" ").filter(Boolean);
  let n = 0;
  for (let i = 1; i < w.length; i++) if (w[i] === w[i - 1] && w[i].length > 0) n++;
  return n;
}

export const wordCount = (text: string) => norm(text).split(" ").filter((w) => w.length > 0).length;

export interface SpeakerMetrics {
  speaker: string;
  turns: number;
  talkSec: number;         // sum of this speaker's turn lengths
  words: number;
  wpm: number;             // words per minute of talk time (includes their own pauses)
  articulationWpm: number; // words per minute of actual sound (pauses removed)
  pauses: number;          // silences ≥ 0.4 s inside their turns
  longPauses: number;      // silences ≥ 1.5 s inside their turns
  meanPauseSec: number;
  longestPauseSec: number;
  fillers: number;
  fillersPerMin: number;
  fillerWords: Record<string, number>;
  repetitions: number;
  longestTurnSec: number;
  pitch: PitchStats | null;
}

export interface Analysis { durationSec: number; noiseFloorDb: number; speechRatio: number; speakers: SpeakerMetrics[]; }

/** Combine the transcript's speaker turns with the audio measurements. */
export function analyse(segments: Segment[], vad: Uint8Array, f0: Float32Array, f0HopSec: number, durationSec: number, noiseFloorDb: number): Analysis {
  const bySpk = new Map<string, Segment[]>();
  for (const s of segments) bySpk.set(s.speaker, [...(bySpk.get(s.speaker) ?? []), s]);
  const speakers: SpeakerMetrics[] = [];
  for (const [speaker, segs] of bySpk) {
    const talkSec = segs.reduce((a, s) => a + Math.max(0, s.end - s.start), 0);
    const text = segs.map((s) => s.text).join(" ");
    const words = wordCount(text);
    const pauses = segs.flatMap((s) => findPauses(vad, s.start, s.end));
    const pauseSec = pauses.reduce((a, p) => a + (p.end - p.start), 0);
    const f = countFillers(text);
    const mins = talkSec / 60;
    speakers.push({
      speaker, turns: segs.length, talkSec: +talkSec.toFixed(1), words,
      wpm: mins > 0 ? Math.round(words / mins) : 0,
      articulationWpm: talkSec - pauseSec > 1 ? Math.round(words / ((talkSec - pauseSec) / 60)) : 0,
      pauses: pauses.length,
      longPauses: pauses.filter((p) => p.end - p.start >= 1.5).length,
      meanPauseSec: pauses.length ? +(pauseSec / pauses.length).toFixed(2) : 0,
      longestPauseSec: pauses.length ? +Math.max(...pauses.map((p) => p.end - p.start)).toFixed(1) : 0,
      fillers: f.total, fillersPerMin: mins > 0 ? +(f.total / mins).toFixed(1) : 0, fillerWords: f.byWord,
      repetitions: countRepetitions(text),
      longestTurnSec: +Math.max(...segs.map((s) => s.end - s.start)).toFixed(1),
      pitch: pitchStats(f0, f0HopSec, segs),
    });
  }
  speakers.sort((a, b) => b.talkSec - a.talkSec);
  const speech = vad.reduce((a, v) => a + v, 0) * FRAME_SEC;
  return { durationSec: +durationSec.toFixed(1), noiseFloorDb: Math.round(noiseFloorDb), speechRatio: durationSec > 0 ? +(speech / durationSec).toFixed(2) : 0, speakers };
}

/** 16-bit PCM WAV, used when the original file type can't be sent to the transcriber (e.g. a video). */
export function encodeWav(samples: Float32Array, sr: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buf], { type: "audio/wav" });
}
