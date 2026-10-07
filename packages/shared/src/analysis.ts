import type { EmploymentType, Platform, WorkArrangement } from "./enums";
import type { MatchBreakdownItem } from "./match-weights";
import type { SalaryPeriod } from "./salary";

export const SENIORITY_LEVELS = ["INTERN", "ENTRY", "MID", "SENIOR", "LEAD", "MANAGER", "DIRECTOR", "EXECUTIVE"] as const;
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];

export const SENIORITY_LABELS: Record<SeniorityLevel, string> = {
  INTERN: "Intern",
  ENTRY: "Entry level",
  MID: "Mid level",
  SENIOR: "Senior",
  LEAD: "Lead / Staff",
  MANAGER: "Manager",
  DIRECTOR: "Director",
  EXECUTIVE: "Executive",
};

export const EDUCATION_LEVELS = ["NONE", "HIGH_SCHOOL", "ASSOCIATE", "BACHELOR", "MASTER", "DOCTORATE"] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

export const EDUCATION_LEVEL_LABELS: Record<EducationLevel, string> = {
  NONE: "No degree required",
  HIGH_SCHOOL: "High school diploma",
  ASSOCIATE: "Associate degree",
  BACHELOR: "Bachelor's degree",
  MASTER: "Master's degree",
  DOCTORATE: "Doctorate",
};

/**
 * Everything Applyance extracts from a job posting. Stored on Job.analysis.
 * Fields are null when the posting doesn't say; nothing here is guessed about
 * the user, it only describes the job.
 */
export interface JobAnalysis {
  version: 1;
  /** "ai" when a model produced it, "heuristic" for the deterministic analyzer. */
  method: "ai" | "heuristic";
  model?: string;
  /** Set when an AI provider was configured but failed and the heuristic analyzer was used instead. */
  fallbackReason?: string;
  analyzedAt: string;
  hasDescription: boolean;

  company: string;
  role: string;
  department: string | null;
  seniority: SeniorityLevel | null;
  location: string | null;
  workArrangement: WorkArrangement;
  employmentType: EmploymentType | null;
  /** True when the posting describes pay as commission-only. */
  commissionOnly: boolean;
  salary: {
    text: string;
    min: number;
    max: number;
    currency: string;
    period: SalaryPeriod;
    annualMin: number;
    annualMax: number;
  } | null;
  requiredQualifications: string[];
  preferredQualifications: string[];
  experienceYearsMin: number | null;
  education: { level: EducationLevel; text: string; equivalentExperienceAccepted: boolean } | null;
  skills: string[];
  industry: string | null;
  /** true: sponsorship offered; false: posting says it can't sponsor; null: not mentioned. */
  sponsorship: { available: boolean | null; text: string | null };
  travel: { required: boolean | null; percent: number | null; text: string | null };
  platform: Platform;
}

export type RuleCheckOutcome = "pass" | "fail" | "unknown";

/** One rule checked against one job. */
export interface RuleCheck {
  rule:
    | "minMatchScore"
    | "minSalary"
    | "location"
    | "workArrangement"
    | "employmentType"
    | "excludedIndustries"
    | "excludedCompanies"
    | "excludedKeywords"
    | "requiredKeywords"
    | "sponsorship"
    | "description";
  label: string;
  outcome: RuleCheckOutcome;
  detail: string;
}

/** Stored on Job.qualification: why a job is (or isn't) qualified. */
export interface QualificationResult {
  qualified: boolean;
  status: "QUALIFIED" | "NOT_QUALIFIED" | "NEEDS_DETAILS";
  checks: RuleCheck[];
  evaluatedAt: string;
}

export interface MatchResult {
  score: number;
  breakdown: MatchBreakdownItem[];
}
