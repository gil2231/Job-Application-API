import { z } from "zod";

/**
 * Structured content of a generated, job-specific resume or cover letter. It is
 * stored as JSON with the Resume / CoverLetter row and rendered to PDF or DOCX
 * on demand, so the person can review and edit it before anything is sent.
 * Every fact in it comes from the Master Profile.
 */

export const GENERATION_METHODS = ["ai", "template"] as const;
export type GenerationMethod = (typeof GENERATION_METHODS)[number];

export const generationInfoSchema = z.object({
  method: z.enum(GENERATION_METHODS),
  model: z.string().nullable(),
  /** Why AI output wasn't used, when it wasn't. */
  fallbackReason: z.string().nullable(),
  generatedAt: z.string(),
  /** Job skills the document highlights because the profile has them. */
  matchedSkills: z.array(z.string()),
  /** True once the person has edited the generated text. */
  edited: z.boolean().default(false),
});
export type GenerationInfo = z.infer<typeof generationInfoSchema>;

const jobRefSchema = z.object({ id: z.string(), title: z.string(), company: z.string() });

export const resumeHeaderSchema = z.object({
  name: z.string(),
  headline: z.string().nullable(),
  /** Email, phone, location and links, in display order. */
  contact: z.array(z.string()),
});
export type ResumeHeader = z.infer<typeof resumeHeaderSchema>;

export const resumeContentSchema = z.object({
  version: z.literal(1),
  header: resumeHeaderSchema,
  summary: z.string().nullable(),
  skills: z.array(z.string()),
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      location: z.string().nullable(),
      dates: z.string(),
      bullets: z.array(z.string()),
    }),
  ),
  education: z.array(
    z.object({
      school: z.string(),
      credential: z.string().nullable(),
      dates: z.string().nullable(),
      details: z.array(z.string()),
    }),
  ),
  job: jobRefSchema,
  generation: generationInfoSchema,
});
export type ResumeContent = z.infer<typeof resumeContentSchema>;

export const coverLetterContentSchema = z.object({
  version: z.literal(1),
  header: resumeHeaderSchema,
  /** Paragraphs, greeting and sign-off included. */
  paragraphs: z.array(z.string()),
  job: jobRefSchema,
  generation: generationInfoSchema,
});
export type CoverLetterContent = z.infer<typeof coverLetterContentSchema>;

/** Longest summary and cover letter the editors accept. */
export const MAX_SUMMARY_CHARS = 1200;
export const MAX_COVER_LETTER_CHARS = 6000;

/** Split edited cover letter text back into paragraphs. */
export function toParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}
