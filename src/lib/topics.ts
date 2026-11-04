import type { SubjectId } from "./detect";
import business from "./topics/business.json";
import mathAi from "./topics/math-ai.json";
import psychology from "./topics/psychology.json";
import sehs from "./topics/sehs.json";
import spanishB from "./topics/spanish-b.json";
import englishA from "./topics/english-a-ll.json";

export interface Topic {
  code: string;
  name: string;
  nameEs?: string;
  group: string;
  keywords: string[];
  papers?: number[];
  level?: string;
  marks?: number[];
}

export const TOPIC_MAPS: Record<SubjectId, Topic[]> = {
  business: business.topics,
  "math-ai": mathAi.topics,
  psychology: psychology.topics,
  sehs: sehs.topics,
  "spanish-b": spanishB.topics,
  "english-a-ll": englishA.topics,
};

/** Tags are stored as "<subject>:<code>" so codes never clash between subjects. */
export function tagId(subject: string, code: string): string {
  return `${subject}:${code}`;
}

export function findTopic(tag: string): Topic | undefined {
  const [subject, ...rest] = tag.split(":");
  return TOPIC_MAPS[subject as SubjectId]?.find((t) => t.code === rest.join(":"));
}
