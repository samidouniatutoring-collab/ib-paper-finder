import { describe, expect, it } from "vitest";
import { analyse, countFillers, countRepetitions, encodeWav, findPauses, frameDb, pitchStats, voiceActivity, wordCount, yinPitch } from "../src/transcribe/acoustics";
import { mergeTurns, mimeFor, parseTranscribe, secs } from "../src/transcribe/gemini";
import { buildPacket, clock, guessCandidate, oralTimeline, transcriptText } from "../src/transcribe/packet";
import type { Job, Segment } from "../src/transcribe/types";

const SR = 8000;
function tone(hz: number, sec: number, amp = 0.3, sr = SR): Float32Array {
  const out = new Float32Array(Math.round(sec * sr));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr);
  return out;
}
const silence = (sec: number, sr = SR) => new Float32Array(Math.round(sec * sr)).map(() => (Math.random() - 0.5) * 0.0004);
const join = (...parts: Float32Array[]) => { const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

describe("voice activity and pauses", () => {
  it("finds a 1-second pause between two sounds", () => {
    const audio = join(tone(200, 2), silence(1), tone(200, 2));
    const vad = voiceActivity(frameDb(audio, SR));
    const pauses = findPauses(vad, 0, 5);
    expect(pauses).toHaveLength(1);
    expect(pauses[0].start).toBeGreaterThan(1.9);
    expect(pauses[0].end - pauses[0].start).toBeGreaterThan(0.8);
    expect(pauses[0].end - pauses[0].start).toBeLessThan(1.05);
  });
  it("ignores silence shorter than 0.4 s and trailing silence", () => {
    const audio = join(tone(200, 1), silence(0.2), tone(200, 1), silence(2));
    expect(findPauses(voiceActivity(frameDb(audio, SR)), 0, 10)).toHaveLength(0);
  });
});

describe("pitch", () => {
  it("measures a 180 Hz tone", () => {
    const f0 = yinPitch(tone(180, 2), SR);
    const voiced = Array.from(f0).filter((v) => v > 0);
    expect(voiced.length).toBeGreaterThan(30);
    const mean = voiced.reduce((a, b) => a + b, 0) / voiced.length;
    expect(Math.abs(mean - 180)).toBeLessThan(3);
  });
  it("a flat voice has a small range, a moving one a large range", () => {
    const flat = yinPitch(tone(150, 3), SR);
    const moving = yinPitch(join(tone(120, 1), tone(170, 1), tone(220, 1)), SR);
    const a = pitchStats(flat, 0.04, [{ start: 0, end: 3 }])!;
    const b = pitchStats(moving, 0.04, [{ start: 0, end: 3 }])!;
    expect(a.sdSemitones).toBeLessThan(0.5);
    expect(b.rangeSemitones).toBeGreaterThan(8);
  });
  it("returns null with too little voiced audio", () => {
    expect(pitchStats(new Float32Array(100), 0.04, [{ start: 0, end: 4 }])).toBeNull();
  });
});

describe("text measures", () => {
  it("counts Spanish, English and French fillers but not real words", () => {
    expect(countFillers("Pues eh creo que ehm es importante, euh, no sé. Um.").total).toBe(4);
    expect(countFillers("Este tema es bueno").total).toBe(0);
  });
  it("counts immediate repetitions and words", () => {
    expect(countRepetitions("el el problema es que que no")).toBe(2);
    expect(wordCount("¡Hola, qué tal!")).toBe(3);
  });
});

describe("Gemini response parsing", () => {
  it("reads speaker turns, offsets and words, merging same-speaker pieces", () => {
    const res = { candidates: [{ content: { parts: [
      { audioTranscription: { text: "Bueno, eh, veo una foto", speakerLabel: "spk_1", startOffset: "0.5s", endOffset: "3.0s", words: [{ word: "Bueno", startOffset: "0.5s", endOffset: "0.9s" }] } },
      { audioTranscription: { text: "de un encierro.", speakerLabel: "spk_1", startOffset: "3.4s", endOffset: "5s" } },
      { audioTranscription: { text: "¿Por qué?", speakerLabel: "spk_2", startOffset: "6s", endOffset: "7s" } },
      { text: "ignored" },
    ] } }] };
    const segs = parseTranscribe(res as never);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ speaker: "spk_1", start: 0.5, end: 5, text: "Bueno, eh, veo una foto de un encierro." });
    expect(segs[0].words?.[0]).toEqual({ w: "Bueno", s: 0.5, e: 0.9 });
    expect(segs[1].speaker).toBe("spk_2");
  });
  it("parses durations and keeps turns apart after a long gap", () => {
    expect(secs("1.250s")).toBe(1.25);
    expect(secs(undefined)).toBe(0);
    expect(mergeTurns([{ speaker: "a", start: 0, end: 1, text: "x" }, { speaker: "a", start: 4, end: 5, text: "y" }])).toHaveLength(2);
  });
  it("sends audio directly and converts video", () => {
    expect(mimeFor(new File([], "oral.m4a"))).toBe("audio/m4a");
    expect(mimeFor(new File([], "a.mp3", { type: "audio/mpeg" }))).toBe("audio/mpeg");
    expect(mimeFor(new File([], "class.mp4", { type: "video/mp4" }))).toBeNull();
  });
});

describe("WAV encoder", () => {
  it("writes a valid header", async () => {
    const b = encodeWav(new Float32Array(16000), 16000);
    const v = new DataView(await b.arrayBuffer());
    expect(b.size).toBe(44 + 32000);
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe("RIFF");
    expect(v.getUint32(24, true)).toBe(16000);
  });
});

describe("grading packet", () => {
  const segments: Segment[] = [
    { speaker: "spk_2", start: 0, end: 4, text: "Empieza cuando quieras." },
    { speaker: "spk_1", start: 5, end: 200, text: "Eh, en la foto veo un encierro. Los toros toros corren." },
    { speaker: "spk_2", start: 201, end: 205, text: "¿Has ido alguna vez?" },
    { speaker: "spk_1", start: 206, end: 240, text: "No, nunca he ido." },
  ];
  const job: Job = { id: "1", createdAt: "2026-11-23T10:00:00Z", fileName: "Sami-2.m4a", purpose: "oral", subject: "spanish-b-sl-io", languages: ["es-ES"], engine: "gemini-3.5-transcribe",
    segments, speakerNames: { spk_1: "Candidate", spk_2: "Examiner" }, candidate: "spk_1", pron: null,
    analysis: analyse(segments, new Uint8Array(12000).fill(1), new Float32Array(0), 0.04, 240, -55) };

  it("picks the person who talked most and finds Part 1", () => {
    expect(guessCandidate(segments)).toBe("spk_1");
    const tl = oralTimeline(segments, "spk_1");
    expect(tl.part1).toEqual({ start: 5, end: 200 });
    expect(tl.afterStart).toBe(201);
  });
  it("includes structure, measurements and the verbatim transcript with errors kept", () => {
    const p = buildPacket(job);
    expect(p).toContain("ib-oral-grader");
    expect(p).toContain("Part 1 presentation (first long candidate turn): 00:05–03:20 = 195 s");
    expect(p).toContain("Los toros toros corren.");
    expect(p).toContain("Candidate (graded)");
    expect(p).toContain("Immediate repetitions");
    expect(transcriptText(job)).toContain("[00:05] Candidate: Eh, en la foto");
    expect(clock(605)).toBe("10:05");
  });
});
