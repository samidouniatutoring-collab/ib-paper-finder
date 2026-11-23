export interface Word { w: string; s: number; e: number; }

/** One speaker turn. Times in seconds from the start of the recording. */
export interface Segment { speaker: string; start: number; end: number; text: string; words?: Word[]; language?: string; }

/** What the recording is, which decides speaker roles and what goes into the grading packet. */
export type Purpose = "oral" | "solo" | "interview" | "other";

export interface PronNote { time: string; said: string; expected: string; issue: string; }

export interface PronNotes { notes: PronNote[]; intonation: string; overall: string; }

export interface Job {
  id: string;
  createdAt: string;
  fileName: string;
  purpose: Purpose;
  subject: string;           // e.g. "spanish-b-sl-io" (only for orals / solo practice)
  languages: string[];
  engine: string;
  segments: Segment[];
  speakerNames: Record<string, string>; // spk_1 → "Me"
  candidate: string | null;  // which speaker is graded
  analysis: import("./acoustics").Analysis | null;
  pron: PronNotes | null;
}
