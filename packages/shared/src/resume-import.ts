import { z } from "zod";
import { educationSchema, employmentSchema, personalSchema, stringList } from "./schemas";

/**
 * Resume import: a resume is read into a draft of Master Profile fields, the
 * person reviews and edits the draft, and only what they confirm is saved.
 * Every value in a draft is text found in the resume itself.
 */

export const RESUME_PERSONAL_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "city",
  "state",
  "postalCode",
  "country",
  "linkedinUrl",
  "githubUrl",
  "portfolioUrl",
  "websiteUrl",
] as const;
export type ResumePersonalField = (typeof RESUME_PERSONAL_FIELDS)[number];

export const RESUME_SKILL_LISTS = ["skills", "software", "technicalSkills", "languages"] as const;
export type ResumeSkillList = (typeof RESUME_SKILL_LISTS)[number];

/** A month as "YYYY-MM". */
export type YearMonth = string;

export interface DraftEmployment {
  company: string;
  title: string;
  location: string | null;
  startDate: YearMonth | null;
  endDate: YearMonth | null;
  isCurrent: boolean;
  /** False when the resume gives only years, so the month shown is a placeholder to check. */
  monthsKnown: boolean;
  responsibilities: string[];
  achievements: string[];
}

export interface DraftEducation {
  school: string;
  degree: string | null;
  major: string | null;
  minor: string | null;
  gpa: number | null;
  gpaScale: number | null;
  startDate: YearMonth | null;
  graduationDate: YearMonth | null;
  monthsKnown: boolean;
}

export interface ResumeDraft {
  personal: Record<ResumePersonalField, string | null>;
  currentTitle: string | null;
  summary: string | null;
  skills: Record<ResumeSkillList, string[]>;
  employment: DraftEmployment[];
  education: DraftEducation[];
}

export interface ResumeReading {
  draft: ResumeDraft;
  /** "ai" when a model read the resume, "builtin" for the deterministic parser. */
  method: "ai" | "builtin";
  model?: string;
  /** Why AI wasn't used or didn't work, when it was asked for. */
  fallbackReason?: string;
  /** Values the AI suggested that aren't in the resume, so they were left out. */
  removed: string[];
}

export function emptyResumeDraft(): ResumeDraft {
  return {
    personal: Object.fromEntries(RESUME_PERSONAL_FIELDS.map((k) => [k, null])) as ResumeDraft["personal"],
    currentTitle: null,
    summary: null,
    skills: { skills: [], software: [], technicalSkills: [], languages: [] },
    employment: [],
    education: [],
  };
}

/**
 * What the review page sends back. Only fields present are written: personal
 * and professional fields replace the profile's value, skills are added to the
 * existing lists, and jobs and schools are added as new records.
 */
export const resumeImportSchema = z.object({
  personal: personalSchema.partial().default({}),
  currentTitle: z.string().trim().min(1).max(150).optional(),
  summary: z.string().trim().min(1).max(5000).optional(),
  skills: z
    .object({
      skills: stringList(200, 100),
      software: stringList(200, 100),
      technicalSkills: stringList(200, 100),
      languages: stringList(30, 100),
    })
    .default({ skills: [], software: [], technicalSkills: [], languages: [] }),
  employment: z.array(employmentSchema).max(40).default([]),
  education: z.array(educationSchema).max(20).default([]),
  /** Also keep the uploaded file as a resume in Documents. */
  saveResume: z.boolean().default(false),
});
export type ResumeImportInput = z.infer<typeof resumeImportSchema>;
