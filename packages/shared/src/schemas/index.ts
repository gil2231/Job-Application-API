import { z } from "zod";
import {
  ANSWER_CATEGORIES,
  APPLICATION_OUTCOMES,
  APPLICATION_STATUSES,
  AUTOMATION_MODES,
  DOCUMENT_TYPES,
  EMPLOYMENT_TYPES,
  JOB_STATUSES,
  PLATFORMS,
  SKILL_CATEGORIES,
  WORK_ARRANGEMENTS,
} from "../enums";
import { MATCH_DIMENSIONS, sumWeights, type MatchWeights } from "../match-weights";
import { parseHttpUrl } from "../url";

/** Trims, and turns "" into null so optional form fields clear cleanly. */
const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const optionalUrl = z
  .string()
  .trim()
  .max(2048)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .refine((v) => v == null || parseHttpUrl(v) !== null, "Enter a full URL starting with https://");

/** Comma- or newline-separated text → trimmed, de-duplicated list. */
export const stringList = (maxItems = 100, maxLength = 200) =>
  z
    .union([z.array(z.string()), z.string()])
    .optional()
    .transform((value) => {
      const items = value == null ? [] : Array.isArray(value) ? value : value.split(/[\n,]/);
      const seen = new Set<string>();
      const out: string[] = [];
      for (const raw of items) {
        const item = raw.trim();
        if (!item || seen.has(item.toLowerCase())) continue;
        seen.add(item.toLowerCase());
        out.push(item.slice(0, maxLength));
      }
      return out.slice(0, maxItems);
    });

/** Newline-separated text → list (for bullet-like fields that may contain commas). */
export const lineList = (maxItems = 50, maxLength = 1000) =>
  z.union([z.array(z.string()), z.string()]).optional().transform((value) =>
    (value == null ? [] : Array.isArray(value) ? value : value.split("\n"))
      .map((s) => s.replace(/^\s*[-•*]\s*/, "").trim())
      .filter(Boolean)
      .map((s) => s.slice(0, maxLength))
      .slice(0, maxItems),
  );

const optionalDate = z
  .union([z.string(), z.date()])
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (v == null || v === "") return null;
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Invalid date" });
      return z.NEVER;
    }
    return d;
  });

const optionalNumber = (min: number, max: number) =>
  z
    .union([z.number(), z.string()])
    .nullable()
    .optional()
    .transform((v, ctx) => {
      if (v == null || v === "") return null;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `Must be between ${min} and ${max}` });
        return z.NEVER;
      }
      return n;
    });

const checkbox = z
  .union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
  .optional()
  .transform((v) => v === true || v === "on" || v === "true");

// ── Auth ────────────────────────────────────────────────────────────────────

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")).pipe(z.string().max(254));

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200, "Password is too long")
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), "Include at least one letter and one number");

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  email: emailSchema,
  password: passwordSchema,
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password").max(200),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });

// ── Master Profile ──────────────────────────────────────────────────────────

export const personalSchema = z.object({
  firstName: optionalText(100),
  lastName: optionalText(100),
  preferredName: optionalText(100),
  email: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v.toLowerCase()))
    .nullable()
    .optional()
    .refine((v) => v == null || z.email().safeParse(v).success, "Enter a valid email address"),
  phone: optionalText(40).refine((v) => v == null || /^[+()\d\s.-]{7,}$/.test(v), "Enter a valid phone number"),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(100),
  state: optionalText(100),
  postalCode: optionalText(20),
  country: optionalText(100),
  linkedinUrl: optionalUrl,
  portfolioUrl: optionalUrl,
  websiteUrl: optionalUrl,
  githubUrl: optionalUrl,
});
export type PersonalInput = z.infer<typeof personalSchema>;

export const professionalSchema = z.object({
  currentTitle: optionalText(150),
  targetTitles: stringList(20, 150),
  summary: optionalText(5000),
  industries: stringList(30, 100),
  yearsExperience: optionalNumber(0, 70),
  skills: stringList(200, 100),
  software: stringList(200, 100),
  technicalSkills: stringList(200, 100),
  languages: stringList(30, 100),
});
export type ProfessionalInput = z.infer<typeof professionalSchema>;

export const educationSchema = z
  .object({
    school: z.string().trim().min(1, "School is required").max(200),
    degree: optionalText(150),
    major: optionalText(150),
    concentrations: stringList(10, 150),
    minor: optionalText(150),
    gpa: optionalNumber(0, 10),
    gpaScale: optionalNumber(1, 10),
    startDate: optionalDate,
    graduationDate: optionalDate,
    coursework: stringList(60, 150),
  })
  .refine((v) => !v.startDate || !v.graduationDate || v.startDate <= v.graduationDate, {
    message: "Graduation date must be after the start date",
    path: ["graduationDate"],
  })
  .refine((v) => v.gpa == null || v.gpaScale == null || v.gpa <= v.gpaScale, {
    message: "GPA cannot exceed the GPA scale",
    path: ["gpa"],
  });
export type EducationInput = z.infer<typeof educationSchema>;

export const employmentSchema = z
  .object({
    company: z.string().trim().min(1, "Company is required").max(200),
    title: z.string().trim().min(1, "Title is required").max(200),
    employmentType: z.enum(EMPLOYMENT_TYPES).default("FULL_TIME"),
    startDate: optionalDate.refine((v) => v != null, "Start date is required"),
    endDate: optionalDate,
    isCurrent: checkbox,
    location: optionalText(200),
    description: optionalText(5000),
    responsibilities: lineList(),
    achievements: lineList(),
    skills: stringList(60, 100),
  })
  .refine((v) => v.isCurrent || v.endDate != null, { message: "Add an end date or mark this as your current role", path: ["endDate"] })
  .refine((v) => !v.startDate || !v.endDate || v.isCurrent || v.startDate <= v.endDate, {
    message: "End date must be after the start date",
    path: ["endDate"],
  });
export type EmploymentInput = z.infer<typeof employmentSchema>;

export const skillCategorySchema = z.enum(SKILL_CATEGORIES);

// ── Documents ───────────────────────────────────────────────────────────────

export const documentTypeSchema = z.enum(DOCUMENT_TYPES);

export const documentMetaSchema = z.object({
  type: documentTypeSchema,
  name: z.string().trim().min(1, "Name is required").max(150),
  isDefault: checkbox,
  jobId: optionalText(40),
});

// ── Answer library ──────────────────────────────────────────────────────────

export const answerSchema = z.object({
  question: z.string().trim().min(3, "Enter the question").max(500),
  answer: z.string().trim().max(10000),
  category: z.enum(ANSWER_CATEGORIES),
  confidence: optionalNumber(0, 100).transform((v) => (v == null ? 100 : v)),
  autoSubmitAllowed: checkbox,
  requiresHumanReview: checkbox,
  questionKey: optionalText(120),
});
export type AnswerInput = z.infer<typeof answerSchema>;

// ── Jobs ────────────────────────────────────────────────────────────────────

export const manualJobSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "Paste the job URL")
    .max(2048)
    .refine((v) => parseHttpUrl(v) !== null, "Enter a full URL starting with https://"),
  title: z.string().trim().min(1, "Enter the job title").max(200),
  company: z.string().trim().min(1, "Enter the company").max(200),
  location: optionalText(200),
  workArrangement: z.enum(WORK_ARRANGEMENTS).default("UNKNOWN"),
  salaryText: optionalText(200),
  applicationUrl: optionalUrl,
  description: optionalText(50000),
});
export type ManualJobInput = z.infer<typeof manualJobSchema>;

/** Editing a stored job's details (the URL identifies the job and can't change). */
export const jobDetailsSchema = manualJobSchema.omit({ url: true });
export type JobDetailsFormInput = z.infer<typeof jobDetailsSchema>;

export const importUrlsSchema = z.object({
  text: z.string().trim().min(1, "Paste at least one job URL").max(100_000, "That's too much text. Paste up to 100 URLs at a time."),
});

export const boardSearchSchema = z.object({
  boards: z.string().trim().min(1, "Add at least one job board").max(10_000, "That's too many boards. Search up to 25 at a time."),
  query: z.string().trim().max(300, "Keep keywords under 300 characters"),
  location: optionalText(100),
  searchDescriptions: checkbox,
  /** Match postings with any of the keywords instead of all of them. */
  matchAny: checkbox,
});
export type BoardSearchFormInput = z.infer<typeof boardSearchSchema>;

export const boardImportSchema = boardSearchSchema.extend({
  urls: z.array(z.string().trim().max(2048)).min(1, "Choose at least one job to add").max(200),
});

/** A board search saved for daily job alerts. */
export const savedSearchSchema = boardSearchSchema.extend({
  name: z.string().trim().min(1, "Name this search").max(80, "Keep the name under 80 characters"),
  alertsEnabled: checkbox,
});
export type SavedSearchFormInput = z.infer<typeof savedSearchSchema>;

export const MAX_SAVED_SEARCHES = 10;

export const recommendationKeywordsSchema = z.object({
  keywords: stringList(30, 100),
});

export const AI_PROVIDER_OPTIONS = ["anthropic", "openai"] as const;
export const aiSettingsSchema = z.object({
  aiProvider: z
    .string()
    .trim()
    .transform((v) => (v === "" || v === "none" ? null : v))
    .refine((v) => v === null || (AI_PROVIDER_OPTIONS as readonly string[]).includes(v), "Unknown AI provider"),
  aiModel: optionalText(100),
});
export type AiSettingsInput = z.infer<typeof aiSettingsSchema>;

const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter((x): x is T[number] => (values as readonly string[]).includes(x)) : []));

export const jobFiltersSchema = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  company: z.string().trim().max(200).optional().catch(undefined),
  location: z.string().trim().max(200).optional().catch(undefined),
  status: csvEnum([...JOB_STATUSES, ...APPLICATION_STATUSES] as unknown as readonly [string, ...string[]]).catch([]),
  platform: csvEnum(PLATFORMS).catch([]),
  remote: z.enum(WORK_ARRANGEMENTS).optional().catch(undefined),
  minMatch: z.coerce.number().int().min(0).max(100).optional().catch(undefined),
  minSalary: z.coerce.number().int().min(0).optional().catch(undefined),
  savedFrom: z.coerce.date().optional().catch(undefined),
  savedTo: z.coerce.date().optional().catch(undefined),
  sort: z.enum(["savedAt", "matchScore", "company", "appliedAt", "salary"]).default("savedAt").catch("savedAt"),
  dir: z.enum(["asc", "desc"]).default("desc").catch("desc"),
  page: z.coerce.number().int().min(1).default(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25).catch(25),
});
export type JobFilters = z.infer<typeof jobFiltersSchema>;

export const applicationFiltersSchema = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  status: csvEnum(APPLICATION_STATUSES).catch([]),
  platform: csvEnum(PLATFORMS).catch([]),
  sort: z.enum(["updatedAt", "createdAt", "submittedAt", "matchScore"]).default("updatedAt").catch("updatedAt"),
  dir: z.enum(["asc", "desc"]).default("desc").catch("desc"),
  page: z.coerce.number().int().min(1).default(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25).catch(25),
});
export type ApplicationFilters = z.infer<typeof applicationFiltersSchema>;

export const applicationOutcomeSchema = z.enum(APPLICATION_OUTCOMES);
export const automationModeSchema = z.enum(AUTOMATION_MODES);

// ── Rules & settings ────────────────────────────────────────────────────────

const weightsShape = Object.fromEntries(MATCH_DIMENSIONS.map((d) => [d, z.coerce.number().int().min(0).max(100)])) as Record<
  (typeof MATCH_DIMENSIONS)[number],
  z.ZodCoercedNumber
>;

export const matchWeightsSchema = z
  .object(weightsShape)
  .refine((w) => sumWeights(w as MatchWeights) === 100, { message: "Weights must add up to 100%" });

export const automationRuleSchema = z.object({
  minMatchScore: z.coerce.number().int().min(0).max(100),
  minSalary: optionalNumber(0, 10_000_000),
  preferredLocations: stringList(30, 100),
  workArrangements: z.array(z.enum(WORK_ARRANGEMENTS)).default([]),
  employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).default([]),
  excludedIndustries: stringList(50, 100),
  excludedCompanies: stringList(200, 150),
  excludedKeywords: stringList(50, 100),
  requiredKeywords: stringList(50, 100),
  requiresSponsorship: checkbox,
  maxApplicationsPerDay: z.coerce.number().int().min(1).max(500),
  maxConcurrentApplications: z.coerce.number().int().min(1).max(10),
  autoSubmitEnabled: checkbox,
  defaultMode: z.enum(AUTOMATION_MODES),
  matchWeights: matchWeightsSchema,
});
export type AutomationRuleInput = z.infer<typeof automationRuleSchema>;

export const userSettingsSchema = z.object({
  timezone: z.string().trim().min(1).max(64),
  fieldConfidenceThreshold: z.coerce.number().int().min(50).max(100),
  answerConfidenceThreshold: z.coerce.number().int().min(50).max(100),
  screenshotRetentionDays: z.coerce.number().int().min(1).max(365),
});
export type UserSettingsInput = z.infer<typeof userSettingsSchema>;

export const notificationSettingsSchema = z.object({
  /** Needs Attention emails. */
  emailNotifications: checkbox,
  jobAlertEmails: checkbox,
  jobAlertHour: z.coerce.number().int().min(0).max(23),
});
export type NotificationSettingsInput = z.infer<typeof notificationSettingsSchema>;

/** Flatten zod issues into a { field: message } map for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
