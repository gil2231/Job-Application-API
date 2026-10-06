import { z } from "zod";
import {
  canonicalSkill,
  canonicalSkillKey,
  EMPLOYMENT_TYPES,
  EDUCATION_LEVELS,
  SENIORITY_LEVELS,
  WORK_ARRANGEMENTS,
  type JobAnalysis,
} from "@autoapply/shared";
import type { AIProvider } from "../provider";
import { analyzeJobHeuristically, COMMISSION_ONLY, detectSalary } from "./heuristic";
import { htmlToText } from "./text";
import type { JobAnalysisInput } from "./types";

/** Longest description sent to a model. Longer postings are cut at a line break with a note. */
const MAX_DESCRIPTION_CHARS = 40_000;

const nullableString = { type: ["string", "null"] } as const;
const nullableEnum = (values: readonly string[]) => ({ anyOf: [{ type: "string", enum: [...values] }, { type: "null" }] });

/** JSON Schema the model's answer must match (structured outputs). */
export const JOB_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "department",
    "seniority",
    "workArrangement",
    "employmentType",
    "commissionOnly",
    "salaryText",
    "requiredQualifications",
    "preferredQualifications",
    "experienceYearsMin",
    "educationLevel",
    "educationText",
    "equivalentExperienceAccepted",
    "skills",
    "industry",
    "sponsorshipAvailable",
    "sponsorshipText",
    "travelRequired",
    "travelPercent",
    "travelText",
  ],
  properties: {
    department: nullableString,
    seniority: nullableEnum(SENIORITY_LEVELS),
    workArrangement: { type: "string", enum: [...WORK_ARRANGEMENTS] },
    employmentType: nullableEnum(EMPLOYMENT_TYPES),
    commissionOnly: { type: "boolean" },
    salaryText: nullableString,
    requiredQualifications: { type: "array", items: { type: "string" } },
    preferredQualifications: { type: "array", items: { type: "string" } },
    experienceYearsMin: { type: ["integer", "null"] },
    educationLevel: nullableEnum(EDUCATION_LEVELS),
    educationText: nullableString,
    equivalentExperienceAccepted: { type: "boolean" },
    skills: { type: "array", items: { type: "string" } },
    industry: nullableString,
    sponsorshipAvailable: { type: ["boolean", "null"] },
    sponsorshipText: nullableString,
    travelRequired: { type: ["boolean", "null"] },
    travelPercent: { type: ["integer", "null"] },
    travelText: nullableString,
  },
} as const;

const clean = (max: number) => z.string().trim().max(max * 4).transform((s) => s.slice(0, max));
const aiAnswerSchema = z.object({
  department: clean(80).nullable(),
  seniority: z.enum(SENIORITY_LEVELS).nullable(),
  workArrangement: z.enum(WORK_ARRANGEMENTS),
  employmentType: z.enum(EMPLOYMENT_TYPES).nullable(),
  commissionOnly: z.boolean(),
  salaryText: clean(200).nullable(),
  requiredQualifications: z.array(clean(300)).transform((a) => a.filter(Boolean).slice(0, 25)),
  preferredQualifications: z.array(clean(300)).transform((a) => a.filter(Boolean).slice(0, 25)),
  experienceYearsMin: z.number().int().min(0).max(40).nullable(),
  educationLevel: z.enum(EDUCATION_LEVELS).nullable(),
  educationText: clean(300).nullable(),
  equivalentExperienceAccepted: z.boolean(),
  skills: z.array(clean(80)).transform((a) => a.filter(Boolean).slice(0, 40)),
  industry: clean(80).nullable(),
  sponsorshipAvailable: z.boolean().nullable(),
  sponsorshipText: clean(300).nullable(),
  travelRequired: z.boolean().nullable(),
  travelPercent: z.number().int().min(0).max(100).nullable(),
  travelText: clean(300).nullable(),
});

const SYSTEM_PROMPT = `You extract structured facts from a job posting for a job seeker's application tracker.

Report only what the posting itself states. When the posting does not say something, return null (or an empty list, or UNKNOWN for workArrangement) rather than inferring it from the company, the title, or typical roles. These values decide which jobs the user applies to, so a missing value is far better than a guessed one.

Field notes:
- requiredQualifications and preferredQualifications: short phrases copied or tightly paraphrased from the posting's own requirement and nice-to-have lists. Keep them separate; anything labeled preferred, bonus, or nice to have is preferred.
- experienceYearsMin: the smallest number of years of experience the posting requires, if it states one.
- educationLevel: the minimum degree the posting requires, not one it merely prefers. Use NONE only when the posting says no degree is required.
- salaryText: the pay range exactly as written, including currency and period.
- skills: concrete skills, tools and methods the posting asks for, with their usual names.
- sponsorshipAvailable: false only if the posting says it cannot sponsor work visas; true only if it says it can.
- commissionOnly: true only if pay is described as commission-only with no base salary.`;

function truncateDescription(text: string): string {
  if (text.length <= MAX_DESCRIPTION_CHARS) return text;
  const cut = text.lastIndexOf("\n", MAX_DESCRIPTION_CHARS);
  return `${text.slice(0, cut > 0 ? cut : MAX_DESCRIPTION_CHARS)}\n\n[The rest of this posting was omitted for length.]`;
}

/**
 * Analyze a job with an AI provider. Falls back to the heuristic analyzer when
 * the provider fails or returns something that doesn't validate, recording why.
 */
export async function analyzeJobWithAI(provider: AIProvider, input: JobAnalysisInput, now: Date = new Date()): Promise<JobAnalysis> {
  const heuristic = analyzeJobHeuristically(input, now);
  const description = input.description ? htmlToText(input.description) : "";
  // A model can't extract more than the heuristic from a title alone.
  if (!heuristic.hasDescription) return heuristic;

  let answer: z.infer<typeof aiAnswerSchema>;
  let model = provider.model;
  try {
    const posting = [
      `Title: ${input.title}`,
      `Company: ${input.company}`,
      input.location ? `Location: ${input.location}` : null,
      input.salaryText ? `Listed pay: ${input.salaryText}` : null,
      "",
      "<posting>",
      truncateDescription(description),
      "</posting>",
    ]
      .filter((line) => line !== null)
      .join("\n");
    const result = await provider.complete({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: posting },
      ],
      jsonSchema: JOB_ANALYSIS_JSON_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 16000,
    });
    model = result.model;
    answer = aiAnswerSchema.parse(JSON.parse(result.text));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ...heuristic, fallbackReason: reason.slice(0, 300) };
  }

  // Salary is re-parsed deterministically so annualized values are consistent across analyzers.
  const salary = detectSalary(answer.salaryText ?? input.salaryText, "") ?? heuristic.salary;
  // Skills: the model's list, plus any of the user's own skills that appear verbatim.
  const skills: string[] = [];
  const seen = new Set<string>();
  for (const skill of [...answer.skills.map(canonicalSkill), ...heuristic.skills]) {
    const key = canonicalSkillKey(skill);
    if (!seen.has(key)) {
      seen.add(key);
      skills.push(skill);
    }
  }

  return {
    ...heuristic,
    method: "ai",
    model,
    department: answer.department ?? heuristic.department,
    seniority: answer.seniority ?? heuristic.seniority,
    workArrangement: input.workArrangement && input.workArrangement !== "UNKNOWN" ? input.workArrangement : answer.workArrangement,
    employmentType: answer.employmentType,
    commissionOnly: answer.commissionOnly || COMMISSION_ONLY.test(input.salaryText ?? ""),
    salary,
    requiredQualifications: answer.requiredQualifications,
    preferredQualifications: answer.preferredQualifications,
    experienceYearsMin: answer.experienceYearsMin,
    education: answer.educationLevel
      ? { level: answer.educationLevel, text: answer.educationText ?? "", equivalentExperienceAccepted: answer.equivalentExperienceAccepted }
      : null,
    skills: skills.slice(0, 40),
    industry: answer.industry,
    sponsorship: { available: answer.sponsorshipAvailable, text: answer.sponsorshipText },
    travel: { required: answer.travelRequired, percent: answer.travelPercent, text: answer.travelText },
  };
}
