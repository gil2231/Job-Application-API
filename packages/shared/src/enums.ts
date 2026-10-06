/**
 * Domain enums shared by every app and package.
 *
 * These mirror the Prisma enums in packages/database/prisma/schema.prisma.
 * A test in packages/database asserts the two stay in sync, so the UI and the
 * worker can import them without pulling in the Prisma client.
 */

export const JOB_STATUSES = ["IMPORTED", "ANALYZING", "NEEDS_DETAILS", "QUALIFIED", "NOT_QUALIFIED", "SKIPPED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const APPLICATION_STATUSES = [
  "QUEUED",
  "PROCESSING",
  "WAITING_FOR_USER",
  "REVIEW_REQUIRED",
  "READY",
  "SUBMITTED",
  "FAILED",
  "REJECTED",
  "SKIPPED",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Statuses where the application is still moving through the pipeline. */
export const ACTIVE_APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  "QUEUED",
  "PROCESSING",
  "WAITING_FOR_USER",
  "REVIEW_REQUIRED",
  "READY",
];

/**
 * Statuses that need a human before the application can continue. READY means
 * the form is filled and checked and only the final submit is left to the user.
 */
export const ATTENTION_APPLICATION_STATUSES: readonly ApplicationStatus[] = ["WAITING_FOR_USER", "REVIEW_REQUIRED", "READY"];

/**
 * The combined pipeline status shown in the Jobs table: a job's own status until
 * an application exists, then the application's status.
 */
export type PipelineStatus = JobStatus | ApplicationStatus;

/** What happened after submission. Set by the user; see tracker.ts for how it maps to Flightpath stages. */
export const APPLICATION_OUTCOMES = ["NONE", "RESPONDED", "INTERVIEW", "OFFER", "ACCEPTED", "DECLINED", "WITHDRAWN"] as const;
export type ApplicationOutcome = (typeof APPLICATION_OUTCOMES)[number];

export const AUTOMATION_MODES = ["MANUAL", "REVIEW", "AUTO"] as const;
export type AutomationMode = (typeof AUTOMATION_MODES)[number];

export const PLATFORMS = [
  "WORKDAY",
  "GREENHOUSE",
  "LEVER",
  "ASHBY",
  "SMARTRECRUITERS",
  "LINKEDIN_EASY_APPLY",
  "GENERIC",
  "UNKNOWN",
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const USER_ROLES = ["USER", "ADMIN"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const FAILURE_TYPES = [
  "NETWORK_ERROR",
  "TIMEOUT",
  "SELECTOR_ERROR",
  "VALIDATION_ERROR",
  "AUTH_REQUIRED",
  "CAPTCHA",
  "UNKNOWN_FIELD",
  "SITE_CHANGED",
  "UNKNOWN_ERROR",
] as const;
export type FailureType = (typeof FAILURE_TYPES)[number];

export const ATTENTION_REASONS = [
  "CAPTCHA",
  "MFA",
  "AUTH_REQUIRED",
  "QUESTION_REVIEW",
  "LOW_CONFIDENCE_MAPPING",
  "UNSUPPORTED_SITE",
  "VALIDATION_ERROR",
  "REPEATED_FAILURE",
  "CONTRADICTION",
  "FINAL_REVIEW",
] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

export const WORK_ARRANGEMENTS = ["REMOTE", "HYBRID", "ONSITE", "UNKNOWN"] as const;
export type WorkArrangement = (typeof WORK_ARRANGEMENTS)[number];

export const EMPLOYMENT_TYPES = [
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "TEMPORARY",
  "INTERNSHIP",
  "FREELANCE",
  "OTHER",
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const SKILL_CATEGORIES = ["SKILL", "SOFTWARE", "TECHNICAL", "LANGUAGE"] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const DOCUMENT_TYPES = ["RESUME", "COVER_LETTER", "CERTIFICATION", "TRANSCRIPT", "PORTFOLIO", "OTHER"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const ANSWER_CATEGORIES = [
  "MOTIVATION",
  "FIT",
  "COMPENSATION",
  "WORK_AUTHORIZATION",
  "SPONSORSHIP",
  "RELOCATION",
  "TRAVEL",
  "EXPERIENCE",
  "LINKS",
  "AVAILABILITY",
  "DEMOGRAPHIC",
  "OTHER",
] as const;
export type AnswerCategory = (typeof ANSWER_CATEGORIES)[number];

export const ANSWER_SOURCES = ["USER", "PROFILE", "AI_GENERATED", "IMPORTED"] as const;
export type AnswerSource = (typeof ANSWER_SOURCES)[number];

export const JOB_SOURCE_TYPES = ["MANUAL", "LINKEDIN_SAVED", "CSV_IMPORT", "API", "JOB_BOARD"] as const;
export type JobSourceType = (typeof JOB_SOURCE_TYPES)[number];

export const APPLICATION_EVENT_TYPES = [
  "JOB_IMPORTED",
  "JOB_ANALYZED",
  "MATCH_CALCULATED",
  "QUEUED",
  "PLATFORM_DETECTED",
  "BROWSER_LAUNCHED",
  "PROFILE_LOADED",
  "FIELDS_MAPPED",
  "RESUME_UPLOADED",
  "COVER_LETTER_UPLOADED",
  "QUESTIONS_ANSWERED",
  "PAGE_COMPLETED",
  "VALIDATION_COMPLETED",
  "HUMAN_INPUT_REQUIRED",
  "HUMAN_INPUT_RECEIVED",
  "SUBMITTED",
  "FAILED",
  "RETRY_SCHEDULED",
  "STATUS_CHANGED",
  "OUTCOME_UPDATED",
  "NOTE",
  "STAGE_CHANGED",
  "INTERVIEW_SCHEDULED",
  "INTERVIEW_UPDATED",
] as const;
export type ApplicationEventType = (typeof APPLICATION_EVENT_TYPES)[number];

export const EVENT_LEVELS = ["INFO", "WARNING", "ERROR"] as const;
export type EventLevel = (typeof EVENT_LEVELS)[number];

export const NOTIFICATION_KINDS = ["NEEDS_ATTENTION", "JOB_ALERT", "TEST"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_CHANNELS = ["EMAIL"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = ["SENT", "FAILED", "SKIPPED"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

const titleCase = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const LABEL_OVERRIDES: Record<string, string> = {
  WAITING_FOR_USER: "Waiting for User",
  NOT_QUALIFIED: "Not Qualified",
  NEEDS_DETAILS: "Needs Details",
  LINKEDIN_EASY_APPLY: "LinkedIn Easy Apply",
  SMARTRECRUITERS: "SmartRecruiters",
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  MFA: "MFA",
  CAPTCHA: "CAPTCHA",
  ONSITE: "On-site",
  LINKEDIN_SAVED: "LinkedIn saved jobs",
  CSV_IMPORT: "CSV import",
  API: "API",
  JOB_BOARD: "Job board search",
  NEEDS_ATTENTION: "Needs Attention",
  JOB_ALERT: "Job alert",
  TEST: "Test email",
};

/** Human-readable label for any enum value in this file. */
export function enumLabel(value: string): string {
  return LABEL_OVERRIDES[value] ?? titleCase(value);
}
