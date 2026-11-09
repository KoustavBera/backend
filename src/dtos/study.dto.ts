export type Tone =
  | "blue"
  | "emerald"
  | "amber"
  | "violet"
  | "rose"
  | "teal"
  | "indigo"
  | "warm";

export const TONE_LIST: Tone[] = [
  "blue",
  "emerald",
  "amber",
  "violet",
  "rose",
  "teal",
  "indigo",
  "warm",
];

export type SubjectDTO = {
  id: string; // Slug used by frontend in route URLs
  classId: string;
  name: string;
  bn?: string;
  icon: string;
  tone: Tone;
};

export type SubjectSummaryDTO = SubjectDTO & {
  resourceCount: number;
};

export type StudyResourceDTO = {
  id: string;
  classId: string;
  subjectId: string; // Parent subject slug matching frontend routing
  category: "video" | "notes" | "book" | "pyq";
  format: "youtube" | "pdf" | "image";
  title: string;
  chapter?: string;
  url: string;
  uploadedAt: string;
  uploadedBy?: string;
};

