/**
 * Flightpath: the application tracker.
 *
 * Every application sits in exactly one stage, derived from two columns:
 * - `status` is owned by the automation (queue, worker, Needs Attention) and
 *   decides the stages up to Submitted.
 * - `outcome` is owned by the user (or a future integration such as email) and
 *   decides the stages after Submitted.
 * Nothing stores the stage itself, so the worker and the tracker can never
 * disagree about where an application is.
 */
import { z } from "zod";
import type { ApplicationOutcome, ApplicationStatus } from "./enums";

export const TRACKER_STAGES = [
  "QUEUED",
  "PROCESSING",
  "NEEDS_YOU",
  "FAILED",
  "SUBMITTED",
  "RESPONDED",
  "INTERVIEWING",
  "OFFER",
  "ACCEPTED",
  "REJECTED",
  "WITHDRAWN",
  "SKIPPED",
] as const;
export type TrackerStage = (typeof TRACKER_STAGES)[number];

/** Stages before the application is sent. The automation moves applications through these. */
export const PRE_SUBMIT_STAGES = ["QUEUED", "PROCESSING", "NEEDS_YOU", "FAILED"] as const satisfies readonly TrackerStage[];
/** Stages after the application is sent. The user moves applications through these. */
export const POST_SUBMIT_STAGES = ["SUBMITTED", "RESPONDED", "INTERVIEWING", "OFFER", "ACCEPTED", "REJECTED", "WITHDRAWN"] as const satisfies readonly TrackerStage[];
export type PostSubmitStage = (typeof POST_SUBMIT_STAGES)[number];
/** Stages that end an application. */
export const CLOSED_STAGES = ["ACCEPTED", "REJECTED", "WITHDRAWN"] as const satisfies readonly TrackerStage[];
/** Columns on the board, in order. Skipped applications are only listed in the table. */
export const BOARD_STAGES = TRACKER_STAGES.filter((s) => s !== "SKIPPED") as Exclude<TrackerStage, "SKIPPED">[];

export const STAGE_META: Record<TrackerStage, { label: string; description: string; tone: "neutral" | "info" | "warning" | "danger" | "success" | "muted" }> = {
  QUEUED: { label: "Queued", description: "Waiting for the worker", tone: "neutral" },
  PROCESSING: { label: "Processing", description: "Being filled out now", tone: "info" },
  NEEDS_YOU: { label: "Needs you", description: "Waiting on a question, check or final review", tone: "warning" },
  FAILED: { label: "Failed", description: "Stopped with an error; retry or apply yourself", tone: "danger" },
  SUBMITTED: { label: "Submitted", description: "Sent; no reply yet", tone: "info" },
  RESPONDED: { label: "Responded", description: "The employer got back to you", tone: "info" },
  INTERVIEWING: { label: "Interviewing", description: "One or more interview rounds", tone: "warning" },
  OFFER: { label: "Offer", description: "You have an offer", tone: "success" },
  ACCEPTED: { label: "Accepted", description: "You took the job", tone: "success" },
  REJECTED: { label: "Rejected", description: "The employer passed", tone: "muted" },
  WITHDRAWN: { label: "Withdrawn", description: "You pulled out", tone: "muted" },
  SKIPPED: { label: "Skipped", description: "Not applied to", tone: "muted" },
};

const OUTCOME_TO_STAGE: Record<ApplicationOutcome, PostSubmitStage> = {
  NONE: "SUBMITTED",
  RESPONDED: "RESPONDED",
  INTERVIEW: "INTERVIEWING",
  OFFER: "OFFER",
  ACCEPTED: "ACCEPTED",
  DECLINED: "REJECTED",
  WITHDRAWN: "WITHDRAWN",
};

const STAGE_TO_OUTCOME: Record<PostSubmitStage, ApplicationOutcome> = {
  SUBMITTED: "NONE",
  RESPONDED: "RESPONDED",
  INTERVIEWING: "INTERVIEW",
  OFFER: "OFFER",
  ACCEPTED: "ACCEPTED",
  REJECTED: "DECLINED",
  WITHDRAWN: "WITHDRAWN",
};

export function isPostSubmitStage(stage: TrackerStage): stage is PostSubmitStage {
  return (POST_SUBMIT_STAGES as readonly TrackerStage[]).includes(stage);
}

export function outcomeForStage(stage: PostSubmitStage): ApplicationOutcome {
  return STAGE_TO_OUTCOME[stage];
}

export function stageForOutcome(outcome: ApplicationOutcome): PostSubmitStage {
  return OUTCOME_TO_STAGE[outcome];
}

/** Application statuses that make up each pre-submit stage. */
export const STAGE_STATUSES: Record<Exclude<TrackerStage, PostSubmitStage>, ApplicationStatus[]> = {
  QUEUED: ["QUEUED"],
  PROCESSING: ["PROCESSING"],
  NEEDS_YOU: ["WAITING_FOR_USER", "REVIEW_REQUIRED", "READY"],
  FAILED: ["FAILED"],
  SKIPPED: ["SKIPPED"],
};

/** Statuses of an application that has been sent. REJECTED is kept in sync with outcome DECLINED. */
export const SENT_STATUSES: readonly ApplicationStatus[] = ["SUBMITTED", "REJECTED"];

export function stageOf(app: { status: ApplicationStatus; outcome: ApplicationOutcome }): TrackerStage {
  // Rejected before outcomes existed: no outcome recorded, but the status says rejected.
  if (app.status === "REJECTED" && app.outcome === "NONE") return "REJECTED";
  if (SENT_STATUSES.includes(app.status)) return OUTCOME_TO_STAGE[app.outcome];
  for (const [stage, statuses] of Object.entries(STAGE_STATUSES)) {
    if (statuses.includes(app.status)) return stage as TrackerStage;
  }
  return "QUEUED";
}

/**
 * Forward order of the open post-submit stages. Reaching a stage implies the
 * ones before it (an offer means they responded), which is what the funnel
 * and response metrics count.
 */
export const PROGRESS_ORDER = ["SUBMITTED", "RESPONDED", "INTERVIEWING", "OFFER", "ACCEPTED"] as const satisfies readonly PostSubmitStage[];

export type StageMove =
  | { allowed: true; kind: "none" | "progress" | "mark_submitted" | "retry" | "requeue" | "skip"; confirm?: string }
  | { allowed: false; reason: string };

/**
 * Whether the user may move an application from one stage to another, and
 * what the move means. The automation-owned stages can't be set by hand,
 * except retrying a failure, re-queueing a skipped application, or skipping.
 * Moving an unsent application into a post-submit stage means "I applied
 * myself", which stops the automation, so the UI confirms it first.
 */
export function checkStageMove(from: TrackerStage, to: TrackerStage, opts: { locked?: boolean } = {}): StageMove {
  if (from === to) return { allowed: true, kind: "none" };
  if (from === "PROCESSING") return { allowed: false, reason: "It's being filled out right now. Wait for it to finish, or stop it from the dashboard." };
  const fromSent = isPostSubmitStage(from);
  if (isPostSubmitStage(to)) {
    if (fromSent) return { allowed: true, kind: "progress" };
    if (from === "QUEUED" && opts.locked) return { allowed: false, reason: "It's starting right now. Wait for it to finish first." };
    return {
      allowed: true,
      kind: "mark_submitted",
      confirm: `This marks the application as submitted by you and stops automation on it.${to === "SUBMITTED" ? "" : ` It then moves to ${STAGE_META[to].label}.`}`,
    };
  }
  if (fromSent) return { allowed: false, reason: "It's already been sent, so it can only move between Submitted and the stages after it." };
  if (to === "QUEUED" && from === "FAILED") return { allowed: true, kind: "retry" };
  if (to === "QUEUED" && from === "SKIPPED") return { allowed: true, kind: "requeue" };
  if (to === "SKIPPED") {
    if (from === "QUEUED" && opts.locked) return { allowed: false, reason: "It's starting right now. Wait for it to finish first." };
    return { allowed: true, kind: "skip" };
  }
  return { allowed: false, reason: `${STAGE_META[to].label} is set by the automation, not by hand.` };
}

/** Where an application can be moved from its current stage, for menus. */
export function stageTargets(from: TrackerStage, opts: { locked?: boolean } = {}): TrackerStage[] {
  return TRACKER_STAGES.filter((to) => to !== from && checkStageMove(from, to, opts).allowed);
}

// ── Interviews ──────────────────────────────────────────────────────────────

export const INTERVIEW_KINDS = ["PHONE_SCREEN", "RECRUITER", "HIRING_MANAGER", "TECHNICAL", "BEHAVIORAL", "CASE_STUDY", "PANEL", "ONSITE", "FINAL", "OTHER"] as const;
export type InterviewKind = (typeof INTERVIEW_KINDS)[number];

export const INTERVIEW_STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED"] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const interviewRoundSchema = z.object({
  kind: z.enum(INTERVIEW_KINDS).default("OTHER"),
  title: optionalText(120),
  /** ISO date-time; empty means "not scheduled yet". */
  scheduledAt: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: "custom", message: "Enter a valid date and time" });
        return z.NEVER;
      }
      return d;
    }),
  durationMinutes: z
    .union([z.literal(""), z.coerce.number().int().min(5, "At least 5 minutes").max(600, "At most 10 hours")])
    .optional()
    .transform((v) => (v === "" || v == null ? null : v)),
  location: optionalText(500),
  interviewers: optionalText(300),
  notes: optionalText(5000),
  status: z.enum(INTERVIEW_STATUSES).default("SCHEDULED"),
});
export type InterviewRoundInput = z.infer<typeof interviewRoundSchema>;

// ── Filters ─────────────────────────────────────────────────────────────────

const stageList = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",").filter((x): x is TrackerStage => (TRACKER_STAGES as readonly string[]).includes(x)) : []));

export const trackerFiltersSchema = z.object({
  view: z.enum(["board", "table"]).default("board").catch("board"),
  q: z.string().trim().max(200).optional().catch(undefined),
  stage: stageList.catch([]),
  sort: z.enum(["updatedAt", "submittedAt", "company", "matchScore"]).default("updatedAt").catch("updatedAt"),
  dir: z.enum(["asc", "desc"]).default("desc").catch("desc"),
  page: z.coerce.number().int().min(1).default(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25).catch(25),
});
export type TrackerFilters = z.infer<typeof trackerFiltersSchema>;

export const trackerStageSchema = z.enum(TRACKER_STAGES);

// ── Integrations (email and others) ─────────────────────────────────────────

/**
 * A stage update observed outside the app, such as a recruiter's email. A
 * provider turns what it reads into signals and hands them to
 * `recordStageSignal` in @autoapply/database, which matches the application,
 * applies confident forward moves and leaves everything else as a note for
 * the user. Providers never move applications backwards.
 */
export interface StageSignal {
  /** Set when the provider already knows the application (e.g. a reply to a tracked thread). */
  applicationId?: string;
  company: string;
  jobTitle?: string;
  stage: PostSubmitStage;
  occurredAt: Date;
  /** 0-100: how sure the provider is about the stage. */
  confidence: number;
  /** Short human-readable evidence, e.g. the email subject. Never the full message body. */
  evidence: string;
  /** Provider-specific id used to ignore the same signal twice (e.g. the email message id). */
  externalId: string;
  interview?: {
    scheduledAt?: Date;
    durationMinutes?: number;
    kind?: InterviewKind;
    location?: string;
    /** The email carried a calendar invite, so the event is already on the user's calendar. */
    fromInvite?: boolean;
  };
}

export interface StageSignalProvider {
  /** Stable id, e.g. "gmail". */
  id: string;
  name: string;
  /** Signals seen since the given time for one user. */
  fetchSignals(userId: string, since: Date): Promise<StageSignal[]>;
}
