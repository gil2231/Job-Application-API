/**
 * Flightpath: the application tracker. Stages are derived from Application
 * status (automation) and outcome (user); see packages/shared/src/tracker.ts.
 * Every stage change is written to the application's timeline.
 */
import type { Prisma } from "@prisma/client";
import {
  BOARD_STAGES,
  checkStageMove,
  CLOSED_STAGES,
  INTERVIEW_KINDS,
  isPostSubmitStage,
  outcomeForStage,
  PROGRESS_ORDER,
  SENT_STATUSES,
  STAGE_META,
  STAGE_STATUSES,
  stageForOutcome,
  stageOf,
  TRACKER_STAGES,
  type ApplicationOutcome,
  type InterviewKind,
  type InterviewRoundInput,
  type InterviewStatus,
  type PostSubmitStage,
  type StageSignal,
  type StageSignalProvider,
  type TrackerFilters,
  type TrackerStage,
} from "@autoapply/shared";
import { prisma } from "../client";
import { ConflictError, NotFoundError } from "./errors";
import { retryApplications, skipApplication } from "./applications";

export function stageWhere(stage: TrackerStage): Prisma.ApplicationWhereInput {
  if (stage === "SUBMITTED") return { status: "SUBMITTED", outcome: "NONE" };
  if (stage === "REJECTED") return { OR: [{ status: { in: [...SENT_STATUSES] }, outcome: "DECLINED" }, { status: "REJECTED", outcome: "NONE" }] };
  if (isPostSubmitStage(stage)) return { status: { in: [...SENT_STATUSES] }, outcome: outcomeForStage(stage) };
  return { status: { in: STAGE_STATUSES[stage] } };
}

const KIND_LABEL: Record<InterviewKind, string> = {
  PHONE_SCREEN: "Phone screen",
  RECRUITER: "Recruiter call",
  HIRING_MANAGER: "Hiring manager",
  TECHNICAL: "Technical",
  BEHAVIORAL: "Behavioral",
  CASE_STUDY: "Case study",
  PANEL: "Panel",
  ONSITE: "Onsite",
  FINAL: "Final round",
  OTHER: "Interview",
};
export function interviewKindLabel(kind: InterviewKind) {
  return KIND_LABEL[kind];
}
const roundName = (r: { kind: InterviewKind; title: string | null }) => r.title || KIND_LABEL[r.kind];

// ─── Moving between stages ──────────────────────────────────────────────────

type Milestones = { respondedAt: Date | null; interviewingAt: Date | null; offerAt: Date | null; closedAt: Date | null };

/**
 * Milestones after moving to a post-submit stage. Reaching a stage sets the
 * milestones before it if they are missing (an offer implies a response);
 * moving back along the open stages clears the ones past it, so correcting a
 * misplaced card also corrects the funnel.
 */
export function milestonesFor(to: PostSubmitStage, current: Milestones, at: Date): Milestones {
  const rank = (PROGRESS_ORDER as readonly string[]).indexOf(to);
  if (rank >= 0) {
    return {
      respondedAt: rank >= 1 ? (current.respondedAt ?? at) : null,
      interviewingAt: rank >= 2 ? (current.interviewingAt ?? at) : null,
      offerAt: rank >= 3 ? (current.offerAt ?? at) : null,
      closedAt: to === "ACCEPTED" ? (current.closedAt ?? at) : null,
    };
  }
  // Rejected and Withdrawn close the application where it was. A rejection is a response.
  return {
    respondedAt: to === "REJECTED" ? (current.respondedAt ?? at) : current.respondedAt,
    interviewingAt: current.interviewingAt,
    offerAt: current.offerAt,
    closedAt: at,
  };
}

export interface MoveOptions {
  /** Who moved it. Integrations never move applications backwards (see recordStageSignal). */
  source?: "user" | "integration";
  /** Integration id, e.g. "gmail". */
  provider?: string;
  /** When it happened, if not now (an email's date). */
  at?: Date;
  note?: string;
  /** Extra data stored on the timeline event. */
  data?: Record<string, string | number | boolean | null>;
}

const moveSelect = {
  id: true,
  status: true,
  outcome: true,
  lockedBy: true,
  submittedAt: true,
  respondedAt: true,
  interviewingAt: true,
  offerAt: true,
  closedAt: true,
  job: { select: { deletedAt: true } },
} satisfies Prisma.ApplicationSelect;
type MovableApp = Prisma.ApplicationGetPayload<{ select: typeof moveSelect }>;

function describeMove(from: TrackerStage, to: TrackerStage, opts: MoveOptions) {
  const by = opts.source === "integration" ? ` (from ${opts.provider ?? "an integration"})` : "";
  return `Moved from ${STAGE_META[from].label} to ${STAGE_META[to].label}${by}${opts.note ? `: ${opts.note.slice(0, 300)}` : ""}`;
}

/** Apply a post-submit move inside a transaction. The write is conditional on the row not having changed since it was read. */
async function applySentMove(tx: Prisma.TransactionClient, userId: string, app: MovableApp, to: PostSubmitStage, opts: MoveOptions, markSubmitted: boolean) {
  const at = opts.at ?? new Date();
  const from = stageOf(app);
  const outcome = outcomeForStage(to);
  const { count } = await tx.application.updateMany({
    where: { id: app.id, userId, status: app.status, outcome: app.outcome, ...(app.status === "QUEUED" ? { lockedBy: null } : {}) },
    data: {
      status: to === "REJECTED" ? "REJECTED" : "SUBMITTED",
      outcome,
      outcomeAt: outcome === "NONE" ? null : at,
      stageChangedAt: at,
      ...milestonesFor(to, app, at),
      ...(markSubmitted ? { submittedAt: app.submittedAt ?? at, completedAt: at, attentionReason: null, attentionDetail: null, nextAttemptAt: null } : {}),
    },
  });
  if (count === 0) throw new ConflictError("This application just changed. Refresh and try again.");
  const source = opts.source ?? "user";
  if (markSubmitted) {
    await tx.applicationEvent.create({
      data: { applicationId: app.id, userId, type: "SUBMITTED", message: source === "user" ? "Marked as submitted by you" : `Marked as submitted (from ${opts.provider ?? "an integration"})`, data: { source } },
    });
  }
  if (!markSubmitted || to !== "SUBMITTED") {
    await tx.applicationEvent.create({
      data: {
        applicationId: app.id,
        userId,
        type: "STAGE_CHANGED",
        message: describeMove(markSubmitted ? "SUBMITTED" : from, to, opts),
        data: { from: markSubmitted ? "SUBMITTED" : from, to, source, ...(opts.provider ? { provider: opts.provider } : {}), ...opts.data },
      },
    });
  }
}

/**
 * Move an application to a stage. Post-submit stages are free to move between;
 * moving an unsent application into one marks it submitted by the user. The
 * automation's own stages accept only a retry (Failed → Queued), a re-queue
 * (Skipped → Queued) and skipping.
 */
export async function moveApplicationStage(userId: string, applicationId: string, to: TrackerStage, opts: MoveOptions = {}) {
  const app = await prisma.application.findFirst({ where: { id: applicationId, userId }, select: moveSelect });
  if (!app) throw new NotFoundError("Application");
  const from = stageOf(app);
  const move = checkStageMove(from, to, { locked: !!app.lockedBy });
  if (!move.allowed) throw new ConflictError(move.reason);

  switch (move.kind) {
    case "none":
      return { from, to, kind: move.kind };
    case "retry":
      if ((await retryApplications(userId, [app.id])).retried === 0) throw new ConflictError("This application just changed. Refresh and try again.");
      return { from, to, kind: move.kind };
    case "skip":
      await skipApplication(userId, app.id);
      return { from, to, kind: move.kind };
    case "requeue": {
      if (app.job.deletedAt) throw new ConflictError("Its job was deleted, so it can't be queued again.");
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.application.updateMany({
          where: { id: app.id, userId, status: "SKIPPED" },
          data: { status: "QUEUED", queuedAt: now, completedAt: null, nextAttemptAt: null, failureType: null, lastError: null, stageChangedAt: now },
        });
        if (count === 0) throw new ConflictError("This application just changed. Refresh and try again.");
        await tx.applicationEvent.create({ data: { applicationId: app.id, userId, type: "QUEUED", message: "Queued again by you", data: { from, to, source: "user" } } });
      });
      return { from, to, kind: move.kind };
    }
    case "progress":
    case "mark_submitted":
      await prisma.$transaction((tx) => applySentMove(tx, userId, app, to as PostSubmitStage, opts, move.kind === "mark_submitted"));
      return { from, to, kind: move.kind };
  }
}

/** Record what happened after submission. Kept for API clients that speak in outcomes. */
export async function setApplicationOutcome(userId: string, id: string, outcome: ApplicationOutcome) {
  const app = await prisma.application.findFirst({ where: { id, userId }, select: { status: true } });
  if (!app) throw new NotFoundError("Application");
  if (!SENT_STATUSES.includes(app.status)) throw new ConflictError("Outcomes can only be recorded for submitted applications");
  return moveApplicationStage(userId, id, stageForOutcome(outcome));
}

// ─── Reading ────────────────────────────────────────────────────────────────

function cardSelect(now: Date) {
  return {
    id: true,
    status: true,
    outcome: true,
    mode: true,
    platform: true,
    matchScore: true,
    attentionReason: true,
    failureType: true,
    lockedBy: true,
    queuedAt: true,
    submittedAt: true,
    stageChangedAt: true,
    updatedAt: true,
    job: { select: { id: true, title: true, company: true, location: true, url: true, applicationUrl: true, deletedAt: true } },
    interviews: {
      where: { status: "SCHEDULED", scheduledAt: { gte: now } },
      orderBy: { scheduledAt: "asc" },
      take: 1,
      select: { id: true, kind: true, title: true, scheduledAt: true },
    },
    _count: { select: { interviews: true } },
  } satisfies Prisma.ApplicationSelect;
}
export type TrackerCard = Prisma.ApplicationGetPayload<{ select: ReturnType<typeof cardSelect> }> & { stage: TrackerStage };

function searchWhere(q: string | undefined): Prisma.ApplicationWhereInput {
  if (!q) return {};
  return { job: { OR: [{ title: { contains: q, mode: "insensitive" } }, { company: { contains: q, mode: "insensitive" } }, { location: { contains: q, mode: "insensitive" } }] } };
}

function columnOrder(stage: TrackerStage): Prisma.ApplicationOrderByWithRelationInput[] {
  if (stage === "QUEUED") return [{ priority: "desc" }, { queuedAt: "asc" }, { id: "asc" }];
  if (stage === "SUBMITTED") return [{ submittedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }];
  if (isPostSubmitStage(stage)) return [{ stageChangedAt: { sort: "desc", nulls: "last" } }, { submittedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }];
  return [{ updatedAt: "desc" }, { id: "desc" }];
}

/** How many applications are in each stage. */
export async function getStageCounts(userId: string, q?: string): Promise<Record<TrackerStage, number>> {
  const groups = await prisma.application.groupBy({ by: ["status", "outcome"], where: { userId, ...searchWhere(q) }, orderBy: { status: "asc" }, _count: { _all: true } });
  const counts = Object.fromEntries(TRACKER_STAGES.map((s) => [s, 0])) as Record<TrackerStage, number>;
  for (const g of groups) counts[stageOf(g)] += typeof g._count === "object" ? (g._count._all ?? 0) : 0;
  return counts;
}

/** The board: every column with its total and its first `perColumn` cards. */
export async function getTrackerBoard(userId: string, options: { q?: string; perColumn?: number; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const perColumn = options.perColumn ?? 50;
  const select = cardSelect(now);
  const base = { userId, ...searchWhere(options.q) };
  const [counts, ...columns] = await Promise.all([
    getStageCounts(userId, options.q),
    ...BOARD_STAGES.map((stage) =>
      prisma.application.findMany({ where: { AND: [base, stageWhere(stage)] }, orderBy: columnOrder(stage), take: perColumn, select }),
    ),
  ]);
  return {
    columns: BOARD_STAGES.map((stage, i) => ({
      stage,
      total: counts[stage],
      cards: columns[i]!.map((c) => ({ ...c, stage: stageOf(c) })) as TrackerCard[],
    })),
    counts,
  };
}
export type TrackerBoard = Awaited<ReturnType<typeof getTrackerBoard>>;

export async function listTrackerApplications(userId: string, f: Omit<TrackerFilters, "view">, now: Date = new Date()) {
  const where: Prisma.ApplicationWhereInput = {
    AND: [{ userId }, searchWhere(f.q), ...(f.stage.length ? [{ OR: f.stage.map(stageWhere) }] : [])],
  };
  const nullsLast = { sort: f.dir, nulls: "last" } as const;
  const orderBy: Prisma.ApplicationOrderByWithRelationInput[] =
    f.sort === "company"
      ? [{ job: { company: f.dir } }, { id: f.dir }]
      : f.sort === "submittedAt"
        ? [{ submittedAt: nullsLast }, { id: f.dir }]
        : f.sort === "matchScore"
          ? [{ matchScore: nullsLast }, { id: f.dir }]
          : [{ updatedAt: f.dir }, { id: f.dir }];
  const [total, rows, counts] = await Promise.all([
    prisma.application.count({ where }),
    prisma.application.findMany({ where, orderBy, skip: (f.page - 1) * f.pageSize, take: f.pageSize, select: cardSelect(now) }),
    getStageCounts(userId, f.q),
  ]);
  return {
    total,
    page: f.page,
    pageSize: f.pageSize,
    pageCount: Math.max(1, Math.ceil(total / f.pageSize)),
    rows: rows.map((r) => ({ ...r, stage: stageOf(r) })) as TrackerCard[],
    counts,
  };
}
export type TrackerTable = Awaited<ReturnType<typeof listTrackerApplications>>;

// ─── Interview rounds ───────────────────────────────────────────────────────

export async function listInterviewRounds(userId: string, applicationId: string) {
  return prisma.interviewRound.findMany({
    where: { userId, applicationId },
    orderBy: [{ scheduledAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  });
}

/**
 * Add an interview round. The application must have been sent; adding a round
 * to one that is Submitted or Responded moves it to Interviewing.
 */
export async function createInterviewRound(userId: string, applicationId: string, input: InterviewRoundInput) {
  const app = await prisma.application.findFirst({ where: { id: applicationId, userId }, select: moveSelect });
  if (!app) throw new NotFoundError("Application");
  const stage = stageOf(app);
  if (!isPostSubmitStage(stage)) throw new ConflictError("Interviews can be added once the application is submitted. Mark it submitted first.");
  return prisma.$transaction(async (tx) => {
    const round = await tx.interviewRound.create({ data: { ...input, applicationId, userId } });
    await tx.applicationEvent.create({
      data: {
        applicationId,
        userId,
        type: "INTERVIEW_SCHEDULED",
        message: `Interview added: ${roundName(round)}`,
        data: { roundId: round.id, scheduledAt: round.scheduledAt?.toISOString() ?? null },
      },
    });
    if (stage === "SUBMITTED" || stage === "RESPONDED") {
      await applySentMove(tx, userId, app, "INTERVIEWING", { note: "interview added" }, false);
    }
    return round;
  });
}

export async function updateInterviewRound(userId: string, roundId: string, input: InterviewRoundInput) {
  const existing = await prisma.interviewRound.findFirst({ where: { id: roundId, userId } });
  if (!existing) throw new NotFoundError("Interview");
  return prisma.$transaction(async (tx) => {
    const round = await tx.interviewRound.update({ where: { id: roundId }, data: input });
    const statusChanged = existing.status !== round.status;
    await tx.applicationEvent.create({
      data: {
        applicationId: round.applicationId,
        userId,
        type: "INTERVIEW_UPDATED",
        message: statusChanged ? `${roundName(round)} marked ${round.status.toLowerCase()}` : `Interview updated: ${roundName(round)}`,
        data: { roundId: round.id, status: round.status, scheduledAt: round.scheduledAt?.toISOString() ?? null },
      },
    });
    return round;
  });
}

export async function setInterviewStatus(userId: string, roundId: string, status: InterviewStatus) {
  const existing = await prisma.interviewRound.findFirst({ where: { id: roundId, userId } });
  if (!existing) throw new NotFoundError("Interview");
  if (existing.status === status) return existing;
  return prisma.$transaction(async (tx) => {
    const round = await tx.interviewRound.update({ where: { id: roundId }, data: { status } });
    await tx.applicationEvent.create({
      data: { applicationId: round.applicationId, userId, type: "INTERVIEW_UPDATED", message: `${roundName(round)} marked ${status.toLowerCase()}`, data: { roundId, status } },
    });
    return round;
  });
}

export async function deleteInterviewRound(userId: string, roundId: string) {
  const existing = await prisma.interviewRound.findFirst({ where: { id: roundId, userId } });
  if (!existing) throw new NotFoundError("Interview");
  await prisma.$transaction([
    prisma.interviewRound.delete({ where: { id: roundId } }),
    prisma.applicationEvent.create({
      data: { applicationId: existing.applicationId, userId, type: "INTERVIEW_UPDATED", message: `Interview removed: ${roundName(existing)}`, data: { roundId } },
    }),
    // The calendar sync deletes the event Applyance put on the user's calendar.
    ...(existing.calendarEventId && existing.calendarConnectionId
      ? [prisma.calendarEventRemoval.create({ data: { connectionId: existing.calendarConnectionId, eventId: existing.calendarEventId } })]
      : []),
  ]);
  return existing;
}

/** Scheduled interviews from now on, soonest first. */
export async function getUpcomingInterviews(userId: string, options: { now?: Date; limit?: number } = {}) {
  return prisma.interviewRound.findMany({
    where: { userId, status: "SCHEDULED", scheduledAt: { gte: options.now ?? new Date() } },
    orderBy: { scheduledAt: "asc" },
    take: options.limit ?? 5,
    select: {
      id: true,
      kind: true,
      title: true,
      scheduledAt: true,
      durationMinutes: true,
      location: true,
      application: { select: { id: true, job: { select: { title: true, company: true } } } },
    },
  });
}

// ─── Integrations ───────────────────────────────────────────────────────────

export type StageSignalResult =
  | { result: "applied"; applicationId: string; from: TrackerStage; to: TrackerStage }
  | { result: "interview_added"; applicationId: string; roundId: string }
  | { result: "no_change"; applicationId: string }
  | { result: "suggested"; applicationId: string; reason: "low_confidence" | "not_forward" }
  | { result: "duplicate"; applicationId: string }
  | { result: "unmatched" }
  | { result: "ambiguous"; candidates: string[] };

const progressRank = (stage: TrackerStage) => (PROGRESS_ORDER as readonly string[]).indexOf(stage);

/** Whether an integration may make this move: only forward, and never out of a closed stage. */
function isForward(from: TrackerStage, to: PostSubmitStage) {
  if ((CLOSED_STAGES as readonly string[]).includes(from) || !isPostSubmitStage(from)) return false;
  if (to === "REJECTED" || to === "WITHDRAWN") return true;
  return progressRank(to) > progressRank(from);
}

/**
 * The hook for email (and other) integrations. Matches the signal to one of
 * the user's sent applications and applies it when the provider is confident
 * and the move is forward. Anything else becomes a note on the application's
 * timeline for the user to act on, so an integration can never silently
 * overwrite what the user set.
 */
export interface StageSignalOptions {
  /** Below this confidence (0-100) the signal is only suggested. 101 suggests everything. */
  minConfidence?: number;
  /**
   * Ignore signals that point at the application's current stage or one it is
   * already past (a scheduling email while Interviewing), instead of leaving a
   * note. Email sync sets this; a closed application is never reopened either way.
   */
  quietWhenNotForward?: boolean;
}

/** Add an interview round from a signal, unless one is already scheduled at that time. */
async function addSignalInterview(tx: Prisma.TransactionClient, userId: string, applicationId: string, providerId: string, signal: StageSignal) {
  const interview = signal.interview!;
  if (interview.scheduledAt) {
    const existing = await tx.interviewRound.findFirst({ where: { applicationId, userId, scheduledAt: interview.scheduledAt }, select: { id: true } });
    if (existing) return null;
  }
  const kind = interview.kind && (INTERVIEW_KINDS as readonly string[]).includes(interview.kind) ? interview.kind : "OTHER";
  const evidence = signal.evidence.slice(0, 300);
  const round = await tx.interviewRound.create({
    data: {
      applicationId,
      userId,
      kind,
      scheduledAt: interview.scheduledAt ?? null,
      durationMinutes: interview.durationMinutes ?? null,
      location: interview.location?.slice(0, 500) ?? null,
      fromInvite: interview.fromInvite ?? false,
      notes: `Added from ${providerId}: ${evidence}`,
    },
  });
  await tx.applicationEvent.create({
    data: {
      applicationId,
      userId,
      type: "INTERVIEW_SCHEDULED",
      message: `Interview added: ${roundName(round)} (from ${providerId})`,
      data: { roundId: round.id, source: "integration", provider: providerId, externalId: `${providerId}:${signal.externalId}`, scheduledAt: round.scheduledAt?.toISOString() ?? null },
    },
  });
  return round;
}

export async function recordStageSignal(userId: string, providerId: string, signal: StageSignal, options: StageSignalOptions = {}): Promise<StageSignalResult> {
  const minConfidence = options.minConfidence ?? 90;
  const sent = { userId, status: { in: [...SENT_STATUSES] } };
  let candidates: Array<{ id: string }>;
  if (signal.applicationId) {
    candidates = await prisma.application.findMany({ where: { ...sent, id: signal.applicationId }, select: { id: true } });
  } else {
    candidates = await prisma.application.findMany({
      where: {
        ...sent,
        job: {
          company: { equals: signal.company.trim(), mode: "insensitive" },
          ...(signal.jobTitle ? { title: { contains: signal.jobTitle.trim(), mode: "insensitive" } } : {}),
        },
      },
      select: { id: true },
      take: 5,
    });
  }
  if (candidates.length === 0) return { result: "unmatched" };
  if (candidates.length > 1) return { result: "ambiguous", candidates: candidates.map((c) => c.id) };
  const applicationId = candidates[0]!.id;

  const seen = await prisma.applicationEvent.count({ where: { applicationId, userId, data: { path: ["externalId"], equals: `${providerId}:${signal.externalId}` } } });
  if (seen > 0) return { result: "duplicate", applicationId };

  const app = await prisma.application.findFirstOrThrow({ where: { id: applicationId, userId }, select: moveSelect });
  const from = stageOf(app);
  const externalId = `${providerId}:${signal.externalId}`;
  const evidence = signal.evidence.slice(0, 300);

  const confident = signal.confidence >= minConfidence;
  const forward = isForward(from, signal.stage);

  // A new round for an application that is already interviewing.
  if (confident && !forward && from === "INTERVIEWING" && signal.stage === "INTERVIEWING" && signal.interview) {
    const round = await prisma.$transaction((tx) => addSignalInterview(tx, userId, applicationId, providerId, signal));
    return round ? { result: "interview_added", applicationId, roundId: round.id } : { result: "no_change", applicationId };
  }
  if (!forward && options.quietWhenNotForward) {
    const closed = (CLOSED_STAGES as readonly string[]).includes(from);
    const behind = progressRank(signal.stage) >= 0 && progressRank(signal.stage) <= progressRank(from);
    if (closed || behind || signal.stage === from) return { result: "no_change", applicationId };
  }

  if (!confident || !forward) {
    await prisma.applicationEvent.create({
      data: {
        applicationId,
        userId,
        type: "NOTE",
        message: `Possible update from ${providerId}: ${evidence}. Looks like ${STAGE_META[signal.stage].label}; move it if that's right.`,
        data: { externalId, suggestedStage: signal.stage, confidence: signal.confidence, source: "integration", provider: providerId },
      },
    });
    return { result: "suggested", applicationId, reason: confident ? "not_forward" : "low_confidence" };
  }

  await prisma.$transaction(async (tx) => {
    await applySentMove(tx, userId, app, signal.stage, { source: "integration", provider: providerId, at: signal.occurredAt, note: evidence, data: { externalId, confidence: signal.confidence } }, false);
    if (signal.interview && signal.stage === "INTERVIEWING") await addSignalInterview(tx, userId, applicationId, providerId, signal);
  });
  return { result: "applied", applicationId, from, to: signal.stage };
}

/** Pull one provider's signals for a user and record each. */
export async function syncStageSignals(provider: StageSignalProvider, userId: string, since: Date, options: StageSignalOptions = {}) {
  const signals = await provider.fetchSignals(userId, since);
  const results: StageSignalResult[] = [];
  for (const signal of signals) results.push(await recordStageSignal(userId, provider.id, signal, options));
  return results;
}
