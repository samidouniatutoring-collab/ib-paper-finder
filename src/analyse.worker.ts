/// <reference lib="webworker" />
// Runs off the main thread: file hashing and paper analysis (detection, question split, tagging).
import { detectPaper, type Detected, type SubjectId } from "./lib/detect";
import { splitQuestions } from "./lib/split";
import { tagQuestion } from "./lib/tagger";
import { TOPIC_MAPS, tagId } from "./lib/topics";

export type WorkerRequest =
  | { id: number; type: "hash"; bytes: ArrayBuffer }
  | { id: number; type: "analyse"; name: string; pages: string[]; override?: Partial<Detected> };

export interface AnalysedQuestion {
  number: number;
  label: string;
  startPage: number;
  endPage: number;
  marks: number | null;
  pageLevel: boolean;
  text: string;
  tags: { topic: string; confidence: number }[];
}

export interface Analysis {
  detected: Detected;
  questions: AnalysedQuestion[];
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === "hash") {
      const digest = await crypto.subtle.digest("SHA-256", msg.bytes);
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      self.postMessage({ id: msg.id, result: hex });
      return;
    }
    const detected = { ...detectPaper(msg.name, msg.pages.slice(0, 3).join("\n")), ...msg.override };
    const topics = detected.subject ? TOPIC_MAPS[detected.subject as SubjectId] : [];
    // Pre-release statements are never split into questions (and so never tagged).
    const parts = detected.kind === "prerelease" ? [] : splitQuestions(msg.pages);
    const questions: AnalysedQuestion[] = parts.map((q) => ({
      number: q.number,
      label: q.label,
      startPage: q.startPage,
      endPage: q.endPage,
      marks: q.marks,
      pageLevel: q.pageLevel,
      text: q.text,
      // Markschemes are not tagged; their questions are matched to the paper's by number.
      tags:
        detected.kind === "markscheme"
          ? []
          : tagQuestion(q.text, topics, { paperNumber: detected.paperNumber, marks: q.marks, pageLevel: q.pageLevel }).map((t) => ({
              topic: tagId(detected.subject!, t.code),
              confidence: t.confidence,
            })),
    }));
    self.postMessage({ id: msg.id, result: { detected, questions } satisfies Analysis });
  } catch (err) {
    self.postMessage({ id: msg.id, error: String(err) });
  }
};
