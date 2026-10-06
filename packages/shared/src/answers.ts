import type { AnswerCategory } from "./enums";

export interface StandardQuestion {
  key: string;
  question: string;
  category: AnswerCategory;
  /** Answers that vary by employer must be reviewed before they are submitted. */
  requiresHumanReview: boolean;
  /** Whether a stored answer may be submitted without a human looking at it. */
  autoSubmitAllowed: boolean;
  /** Stored encrypted and never shown in logs. */
  sensitive: boolean;
}

/** Questions most applications ask. Users answer these once in the Answer Library. */
export const STANDARD_QUESTIONS: StandardQuestion[] = [
  { key: "why_company", question: "Why do you want to work here?", category: "MOTIVATION", requiresHumanReview: true, autoSubmitAllowed: false, sensitive: false },
  { key: "why_role", question: "Why are you interested in this role?", category: "MOTIVATION", requiresHumanReview: true, autoSubmitAllowed: false, sensitive: false },
  { key: "why_fit", question: "Why are you a good fit for this position?", category: "FIT", requiresHumanReview: true, autoSubmitAllowed: false, sensitive: false },
  { key: "salary_expectations", question: "What are your salary expectations?", category: "COMPENSATION", requiresHumanReview: true, autoSubmitAllowed: false, sensitive: false },
  { key: "work_authorization", question: "Are you legally authorized to work in this country?", category: "WORK_AUTHORIZATION", requiresHumanReview: false, autoSubmitAllowed: true, sensitive: false },
  { key: "sponsorship", question: "Will you now or in the future require visa sponsorship?", category: "SPONSORSHIP", requiresHumanReview: false, autoSubmitAllowed: true, sensitive: false },
  { key: "relocation", question: "Are you willing to relocate?", category: "RELOCATION", requiresHumanReview: false, autoSubmitAllowed: true, sensitive: false },
  { key: "travel", question: "Are you willing to travel? If so, what percentage?", category: "TRAVEL", requiresHumanReview: false, autoSubmitAllowed: true, sensitive: false },
  { key: "years_experience", question: "How many years of professional experience do you have?", category: "EXPERIENCE", requiresHumanReview: false, autoSubmitAllowed: true, sensitive: false },
  { key: "sales_experience", question: "How many years of sales experience do you have?", category: "EXPERIENCE", requiresHumanReview: false, autoSubmitAllowed: true, sensitive: false },
  { key: "management_experience", question: "How many years of people management experience do you have?", category: "EXPERIENCE", requiresHumanReview: false, autoSubmitAllowed: true, sensitive: false },
  { key: "linkedin_url", question: "LinkedIn profile URL", category: "LINKS", requiresHumanReview: false, autoSubmitAllowed: true, sensitive: false },
  { key: "portfolio_url", question: "Portfolio URL", category: "LINKS", requiresHumanReview: false, autoSubmitAllowed: true, sensitive: false },
  { key: "start_date", question: "When can you start?", category: "AVAILABILITY", requiresHumanReview: false, autoSubmitAllowed: true, sensitive: false },
  { key: "demographic_gender", question: "Gender (voluntary self-identification)", category: "DEMOGRAPHIC", requiresHumanReview: false, autoSubmitAllowed: true, sensitive: true },
  { key: "demographic_race", question: "Race / ethnicity (voluntary self-identification)", category: "DEMOGRAPHIC", requiresHumanReview: false, autoSubmitAllowed: true, sensitive: true },
  { key: "demographic_veteran", question: "Veteran status (voluntary self-identification)", category: "DEMOGRAPHIC", requiresHumanReview: false, autoSubmitAllowed: true, sensitive: true },
  { key: "demographic_disability", question: "Disability status (voluntary self-identification)", category: "DEMOGRAPHIC", requiresHumanReview: false, autoSubmitAllowed: true, sensitive: true },
];

export const SENSITIVE_ANSWER_CATEGORIES: readonly AnswerCategory[] = ["DEMOGRAPHIC"];

/** Stable key for matching a free-text question to a stored answer. */
export function normalizeQuestionKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

export interface ProfileFacts {
  linkedinUrl?: string | null;
  portfolioUrl?: string | null;
  websiteUrl?: string | null;
  yearsExperience?: number | null;
  employment?: Array<{ startDate: Date | string; endDate?: Date | string | null; isCurrent?: boolean }>;
}

export interface DerivedAnswer {
  answer: string;
  /** 0..1. Only facts stated directly in the profile reach 1. */
  confidence: number;
  explanation: string;
}

/** Total years covered by employment records, merging overlapping periods. */
export function computeYearsOfExperience(
  employment: NonNullable<ProfileFacts["employment"]>,
  now: Date = new Date(),
): number {
  const ranges = employment
    .map((e) => {
      const start = new Date(e.startDate).getTime();
      const end = e.isCurrent || !e.endDate ? now.getTime() : new Date(e.endDate).getTime();
      return [start, Math.max(start, end)] as [number, number];
    })
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e))
    .sort((a, b) => a[0] - b[0]);

  let total = 0;
  let current: [number, number] | null = null;
  for (const range of ranges) {
    if (!current) current = [...range];
    else if (range[0] <= current[1]) current[1] = Math.max(current[1], range[1]);
    else {
      total += current[1] - current[0];
      current = [...range];
    }
  }
  if (current) total += current[1] - current[0];
  return Math.round((total / (365.25 * 24 * 3600 * 1000)) * 10) / 10;
}

/**
 * Derive an answer to a standard question purely from Master Profile facts.
 * Returns null whenever the profile does not state the fact, so the question
 * is flagged for the user instead of being guessed.
 */
export function deriveAnswerFromProfile(key: string, profile: ProfileFacts): DerivedAnswer | null {
  switch (key) {
    case "linkedin_url":
      return profile.linkedinUrl
        ? { answer: profile.linkedinUrl, confidence: 1, explanation: "LinkedIn URL from your Master Profile." }
        : null;
    case "portfolio_url": {
      const url = profile.portfolioUrl ?? profile.websiteUrl;
      return url ? { answer: url, confidence: profile.portfolioUrl ? 1 : 0.7, explanation: profile.portfolioUrl ? "Portfolio URL from your Master Profile." : "Personal website from your Master Profile (no portfolio URL set)." } : null;
    }
    case "years_experience": {
      if (profile.yearsExperience != null) {
        return { answer: String(profile.yearsExperience), confidence: 1, explanation: "Years of experience stated in your Master Profile." };
      }
      if (profile.employment && profile.employment.length > 0) {
        const years = computeYearsOfExperience(profile.employment);
        return { answer: String(Math.floor(years)), confidence: 0.8, explanation: "Calculated from your employment history." };
      }
      return null;
    }
    default:
      return null;
  }
}
