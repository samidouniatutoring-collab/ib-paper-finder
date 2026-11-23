// Turns a finished job into (1) a clean transcript and (2) the grading packet Claude reads.
// No IB criteria text lives here: the grader skill in Claude holds the criteria.

import type { Analysis, SpeakerMetrics } from "./acoustics";
import type { Job, Purpose, Segment } from "./types";

export const SUBJECTS: { id: string; label: string; language: string }[] = [
  { id: "spanish-b-sl-io", label: "Spanish B SL · Individual oral", language: "Spanish" },
  { id: "spanish-b-hl-io", label: "Spanish B HL · Individual oral", language: "Spanish" },
  { id: "french-b-sl-io", label: "French B SL · Individual oral", language: "French" },
  { id: "french-b-hl-io", label: "French B HL · Individual oral", language: "French" },
  { id: "english-a-ll-io", label: "English A Lang & Lit · Individual oral", language: "English" },
  { id: "interview", label: "Interview practice (university / job)", language: "" },
  { id: "none", label: "Just a transcript", language: "" },
];

export const PURPOSES: { id: Purpose; label: string }[] = [
  { id: "oral", label: "Oral exam (examiner + me)" },
  { id: "solo", label: "Solo practice (only me)" },
  { id: "interview", label: "Interview / conversation" },
  { id: "other", label: "Lecture / anything else" },
];

export const clock = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export const nameOf = (job: Pick<Job, "speakerNames">, spk: string): string => job.speakerNames[spk] || spk.replace(/^spk_/, "Speaker ");

/** Who to grade by default: whoever talked most. */
export function guessCandidate(segments: Segment[]): string | null {
  const t = new Map<string, number>();
  for (const s of segments) t.set(s.speaker, (t.get(s.speaker) ?? 0) + (s.end - s.start));
  return [...t.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Rough map of an IB individual oral. Part 1 = the candidate's opening presentation (their first long turn).
 * After that, examiner questions begin; the Part 2 → Part 3 change is a change of topic, which only the grader
 * can judge from the content, so it is left to the grader.
 */
export function oralTimeline(segments: Segment[], candidate: string | null): { part1: { start: number; end: number } | null; afterStart: number | null; total: number } {
  const total = segments.length ? Math.max(...segments.map((s) => s.end)) - Math.min(...segments.map((s) => s.start)) : 0;
  if (!candidate) return { part1: null, afterStart: null, total };
  const first = segments.find((s) => s.speaker === candidate && s.end - s.start >= 45);
  if (!first) return { part1: null, afterStart: null, total };
  const next = segments.find((s) => s.start >= first.end - 0.1 && s.speaker !== candidate);
  return { part1: { start: first.start, end: first.end }, afterStart: next?.start ?? null, total };
}

export function transcriptText(job: Job, withTimes = true): string {
  return job.segments.map((s) => `${withTimes ? `[${clock(s.start)}] ` : ""}${nameOf(job, s.speaker)}: ${s.text}`).join("\n\n");
}

const band = (v: number, cuts: [number, string][], last: string) => { for (const [c, l] of cuts) if (v < c) return l; return last; };

/** Plain-words reading of the numbers, so the grader (and the student) don't have to interpret raw values. */
export function describeSpeaker(m: SpeakerMetrics, solo: boolean): string[] {
  const out: string[] = [];
  out.push(`Pace: ${m.wpm} words/min including pauses, ${m.articulationWpm} words/min of actual speech (${band(m.wpm, [[80, "slow, hesitant"], [110, "steady but careful"], [150, "fluent conversational pace"], [190, "fast"]], "very fast")} for a learner).`);
  out.push(`Pauses inside their own turns: ${m.pauses} (≥0.4 s), of which ${m.longPauses} long (≥1.5 s); average ${m.meanPauseSec} s, longest ${m.longestPauseSec} s.`);
  out.push(`Fillers (eh/ehm/euh/um…): ${m.fillers} (${m.fillersPerMin}/min)${Object.keys(m.fillerWords).length ? ` → ${Object.entries(m.fillerWords).map(([w, n]) => `"${w}"×${n}`).join(", ")}` : ""}. Immediate repetitions ("el el"): ${m.repetitions}.`);
  if (m.pitch) out.push(`Pitch: median ${m.pitch.medianHz} Hz, range ${m.pitch.rangeSemitones} semitones (10th–90th pct), variation SD ${m.pitch.sdSemitones} st → ${band(m.pitch.sdSemitones, [[1.5, "quite flat / monotone"], [2.5, "moderate movement"], [4.5, "lively, expressive"]], "very wide")} intonation. (Measured, not judged by ear.)`);
  else out.push("Pitch: not enough clean voiced audio to measure.");
  out.push(`${solo ? "Talk time" : "Talk time"}: ${Math.round(m.talkSec)} s over ${m.turns} turn(s); longest uninterrupted turn ${Math.round(m.longestTurnSec)} s.`);
  return out;
}

export function buildPacket(job: Job): string {
  const subj = SUBJECTS.find((s) => s.id === job.subject);
  const solo = job.purpose === "solo";
  const cand = job.candidate;
  const lines: string[] = [];
  lines.push(`# Recording packet: ${subj?.label ?? "Recording"}`);
  lines.push("");
  lines.push("> For Claude: grade this with the **ib-oral-grader** skill. The transcript is verbatim (learner errors kept on purpose). Audio numbers are machine measurements; pronunciation notes are machine observations to verify against the transcript, not a score.");
  lines.push("");
  lines.push("## Recording");
  lines.push(`- File: ${job.fileName}`);
  lines.push(`- Date transcribed: ${job.createdAt.slice(0, 10)}`);
  lines.push(`- Type: ${({ oral: "Oral exam (examiner + candidate)", solo: "Solo practice (candidate only, no examiner)", interview: "Interview / conversation", other: "Other" } as Record<Purpose, string>)[job.purpose]}`);
  if (job.analysis) lines.push(`- Length: ${clock(job.analysis.durationSec)} (${job.analysis.durationSec} s); background noise floor ${job.analysis.noiseFloorDb} dBFS; speech in ${Math.round(job.analysis.speechRatio * 100)}% of the recording`);
  lines.push(`- Engine: ${job.engine}; languages hinted: ${job.languages.join(", ") || "auto"}`);
  lines.push(`- Speakers: ${[...new Set(job.segments.map((s) => s.speaker))].map((s) => `${s} = ${nameOf(job, s)}${s === cand ? " (GRADED)" : ""}`).join("; ")}`);
  lines.push("");

  if (job.purpose === "oral" || solo) {
    const tl = oralTimeline(job.segments, cand);
    lines.push("## Structure (automatic, check it)");
    lines.push(`- Total length: ${clock(tl.total)}`);
    if (tl.part1) lines.push(`- Part 1 presentation (first long candidate turn): ${clock(tl.part1.start)}–${clock(tl.part1.end)} = ${Math.round(tl.part1.end - tl.part1.start)} s`);
    else lines.push("- Part 1: no candidate turn of 45 s or more found.");
    if (!solo && tl.afterStart != null) lines.push(`- Examiner questions start at ${clock(tl.afterStart)}. Where Part 2 (questions on the stimulus) becomes Part 3 (general conversation on another theme) must be judged from the content.`);
    if (solo) lines.push("- Solo practice: only Part 1 (and Criterion A/B1 evidence) can be judged. B2 and C need an examiner.");
    lines.push("");
  }

  if (job.analysis) {
    lines.push("## Audio measurements");
    for (const m of job.analysis.speakers) {
      lines.push(`### ${nameOf(job, m.speaker)}${m.speaker === cand ? " (graded)" : ""}`);
      for (const l of describeSpeaker(m, solo)) lines.push(`- ${l}`);
      lines.push("");
    }
    if (job.analysis.noiseFloorDb > -45) lines.push("_Note: noisy recording; pause counts may be slightly under-counted._\n");
  }

  if (job.pron) {
    lines.push(`## Pronunciation and intonation observations (machine, ${nameOf(job, cand ?? "")})`);
    lines.push(`- Intonation: ${job.pron.intonation}`);
    lines.push(`- Overall intelligibility: ${job.pron.overall}`);
    if (job.pron.notes.length) {
      lines.push("");
      lines.push("| Time | Said | Expected | Issue |");
      lines.push("|---|---|---|---|");
      for (const n of job.pron.notes) lines.push(`| ${n.time} | ${n.said.replace(/\|/g, "/")} | ${n.expected.replace(/\|/g, "/")} | ${n.issue.replace(/\|/g, "/")} |`);
    } else lines.push("- No clear deviations noted.");
    lines.push("");
  }

  lines.push("## Verbatim transcript");
  lines.push("");
  for (const s of job.segments) lines.push(`**[${clock(s.start)}–${clock(s.end)}] ${nameOf(job, s.speaker)}${s.speaker === cand ? " (graded)" : ""}:** ${s.text}\n`);
  return lines.join("\n");
}

export function safeName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[^\w\-]+/g, "_").slice(0, 60) || "recording";
}

/** Transcript as a Word file (Arial), built on demand so the library only loads when used. */
export async function transcriptDocx(job: Job): Promise<Blob> {
  const d = await import("docx");
  const font = "Arial";
  const subj = SUBJECTS.find((s) => s.id === job.subject);
  const children = [
    new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, children: [new d.TextRun({ text: `Transcript: ${job.fileName}`, font })] }),
    new d.Paragraph({ children: [new d.TextRun({ text: `${subj && subj.id !== "none" ? subj.label + " · " : ""}${job.createdAt.slice(0, 10)}${job.analysis ? ` · ${clock(job.analysis.durationSec)}` : ""} · verbatim (errors kept)`, font, color: "666666", size: 18 })], spacing: { after: 240 } }),
    ...job.segments.map((s) => new d.Paragraph({ spacing: { after: 140 }, children: [
      new d.TextRun({ text: `[${clock(s.start)}] `, font, color: "888888", size: 18 }),
      new d.TextRun({ text: `${nameOf(job, s.speaker)}: `, font, bold: true }),
      new d.TextRun({ text: s.text, font }),
    ] })),
  ];
  const doc = new d.Document({ styles: { default: { document: { run: { font, size: 22 } } }, paragraphStyles: [{ id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { font, size: 30, bold: true }, paragraph: { spacing: { before: 0, after: 120 }, keepNext: true } }] }, sections: [{ children }] });
  return d.Packer.toBlob(doc);
}

export type { Analysis };
