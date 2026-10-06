/**
 * Email and calendar connections (Gmail, Outlook), the job-related emails read
 * from them, and the calendar state of interview rounds. The sync itself lives
 * in @autoapply/inbox; this module only stores. Tokens are encrypted at rest
 * and never leave this module except to the sync.
 */
import type { EmailKind, EmailOutcome, MailProvider, Prisma } from "@prisma/client";
import { SENT_STATUSES, stageOf, type TrackerStage } from "@autoapply/shared";
import { prisma } from "../client";
import { decryptString, encryptString } from "../crypto";
import { NotFoundError } from "./errors";

const publicSelect = {
  id: true,
  provider: true,
  email: true,
  scopes: true,
  status: true,
  readEmail: true,
  autoUpdate: true,
  calendarSync: true,
  lastSyncedAt: true,
  lastError: true,
  createdAt: true,
} satisfies Prisma.MailConnectionSelect;
export type MailConnectionView = Prisma.MailConnectionGetPayload<{ select: typeof publicSelect }>;

export interface MailTokens {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
}

export async function listMailConnections(userId: string): Promise<MailConnectionView[]> {
  return prisma.mailConnection.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: publicSelect });
}

/**
 * Save a connection after the user signs in with the provider. Signing in again
 * replaces the tokens and clears a "needs reconnect" state. Interviews go to
 * the first connected account's calendar unless the user picks another.
 */
export async function saveMailConnection(
  userId: string,
  input: { provider: MailProvider; email: string; scopes: string[]; calendar: boolean } & MailTokens,
): Promise<MailConnectionView> {
  const existing = await prisma.mailConnection.findUnique({ where: { userId_provider: { userId, provider: input.provider } }, select: { id: true, refreshToken: true } });
  const calendarElsewhere = await prisma.mailConnection.count({ where: { userId, calendarSync: true, provider: { not: input.provider } } });
  const tokens = {
    accessToken: encryptString(input.accessToken),
    // Providers don't always send a new refresh token; keep the one we have.
    refreshToken: input.refreshToken ? encryptString(input.refreshToken) : (existing?.refreshToken ?? null),
    tokenExpiresAt: input.expiresAt ?? null,
  };
  if (existing) {
    return prisma.mailConnection.update({
      where: { id: existing.id },
      data: { ...tokens, email: input.email, scopes: input.scopes, status: "ACTIVE", lastError: null, ...(input.calendar ? {} : { calendarSync: false }) },
      select: publicSelect,
    });
  }
  return prisma.mailConnection.create({
    data: { userId, provider: input.provider, email: input.email, scopes: input.scopes, ...tokens, calendarSync: input.calendar && calendarElsewhere === 0 },
    select: publicSelect,
  });
}

/** Everything the sync needs, tokens decrypted. */
export async function getMailConnectionForSync(connectionId: string) {
  const c = await prisma.mailConnection.findUnique({ where: { id: connectionId } });
  if (!c) return null;
  return { ...c, accessToken: decryptString(c.accessToken), refreshToken: c.refreshToken ? decryptString(c.refreshToken) : null };
}
export type MailConnectionForSync = NonNullable<Awaited<ReturnType<typeof getMailConnectionForSync>>>;

export async function updateMailTokens(connectionId: string, tokens: MailTokens) {
  await prisma.mailConnection.update({
    where: { id: connectionId },
    data: {
      accessToken: encryptString(tokens.accessToken),
      ...(tokens.refreshToken ? { refreshToken: encryptString(tokens.refreshToken) } : {}),
      tokenExpiresAt: tokens.expiresAt ?? null,
    },
  });
}

/** The provider refused the saved sign-in. Syncing stops until the user connects again. */
export async function markMailConnectionNeedsReconnect(connectionId: string, message: string) {
  await prisma.mailConnection.update({ where: { id: connectionId }, data: { status: "NEEDS_RECONNECT", lastError: message.slice(0, 500), syncLockedUntil: null } });
}

export async function updateMailConnectionSettings(userId: string, connectionId: string, input: { readEmail?: boolean; autoUpdate?: boolean; calendarSync?: boolean }) {
  const c = await prisma.mailConnection.findFirst({ where: { id: connectionId, userId }, select: { id: true } });
  if (!c) throw new NotFoundError("Connection");
  const forget = { calendarConnectionId: null, calendarEventId: null, calendarHash: null, calendarSyncedAt: null, calendarError: null };
  return prisma.$transaction(async (tx) => {
    if (input.calendarSync) {
      // Interviews go to one calendar only. Events on the calendar being
      // replaced are deleted there and created again on this one.
      await tx.mailConnection.updateMany({ where: { userId, id: { not: connectionId } }, data: { calendarSync: false } });
      const moved = await tx.interviewRound.findMany({ where: { userId, calendarEventId: { not: null }, calendarConnectionId: { not: connectionId } }, select: { calendarConnectionId: true, calendarEventId: true } });
      const removals = moved.filter((r) => r.calendarConnectionId).map((r) => ({ connectionId: r.calendarConnectionId!, eventId: r.calendarEventId! }));
      if (removals.length) await tx.calendarEventRemoval.createMany({ data: removals });
      await tx.interviewRound.updateMany({ where: { userId, calendarConnectionId: { not: connectionId } }, data: forget });
    } else if (input.calendarSync === false) {
      // Turning it off leaves the events where they are; they're the user's now.
      await tx.interviewRound.updateMany({ where: { userId, calendarConnectionId: connectionId }, data: forget });
    }
    return tx.mailConnection.update({ where: { id: connectionId }, data: input, select: publicSelect });
  });
}

/**
 * Remove a connection and the email details read from it. Timeline entries and
 * interview rounds stay; events already on the user's calendar stay too (they
 * are the user's now), so the rounds forget them.
 */
export async function deleteMailConnection(userId: string, connectionId: string) {
  const c = await prisma.mailConnection.findFirst({ where: { id: connectionId, userId } });
  if (!c) throw new NotFoundError("Connection");
  await prisma.$transaction([
    prisma.interviewRound.updateMany({
      where: { userId, calendarConnectionId: connectionId },
      data: { calendarConnectionId: null, calendarEventId: null, calendarHash: null, calendarSyncedAt: null, calendarError: null },
    }),
    prisma.mailConnection.delete({ where: { id: connectionId } }),
  ]);
  return { ...c, accessToken: decryptString(c.accessToken), refreshToken: c.refreshToken ? decryptString(c.refreshToken) : null };
}

// ─── Sync bookkeeping ───────────────────────────────────────────────────────

/** Take the sync lease. Returns false when another sync holds it. */
export async function claimMailSync(connectionId: string, leaseMs: number, now = new Date()) {
  const { count } = await prisma.mailConnection.updateMany({
    where: { id: connectionId, status: "ACTIVE", OR: [{ syncLockedUntil: null }, { syncLockedUntil: { lt: now } }] },
    data: { syncLockedUntil: new Date(now.getTime() + leaseMs) },
  });
  return count === 1;
}

export async function finishMailSync(connectionId: string, result: { finishedAt: Date; syncedThrough?: Date; error?: string | null }) {
  await prisma.mailConnection.updateMany({
    where: { id: connectionId },
    data: {
      syncLockedUntil: null,
      lastSyncedAt: result.finishedAt,
      ...(result.syncedThrough ? { syncedThrough: result.syncedThrough } : {}),
      lastError: result.error ? result.error.slice(0, 500) : null,
    },
  });
}

/** Active connections whose last sync is older than the interval. */
export async function findDueMailConnections(intervalMs: number, now = new Date(), limit = 50) {
  const before = new Date(now.getTime() - intervalMs);
  return prisma.mailConnection.findMany({
    where: { status: "ACTIVE", OR: [{ readEmail: true }, { calendarSync: true }], AND: [{ OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: before } }] }] },
    orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
    take: limit,
    select: { id: true, userId: true },
  });
}

// ─── Matching ───────────────────────────────────────────────────────────────

/** The user's sent applications, for matching email to them. */
export async function listApplicationsForEmailMatching(userId: string) {
  const apps = await prisma.application.findMany({
    where: { userId, status: { in: [...SENT_STATUSES] } },
    select: { id: true, status: true, outcome: true, submittedAt: true, job: { select: { title: true, company: true, url: true, applicationUrl: true } } },
    orderBy: { submittedAt: { sort: "desc", nulls: "last" } },
    take: 2000,
  });
  return apps.map((a) => ({ id: a.id, stage: stageOf(a) as TrackerStage, submittedAt: a.submittedAt, company: a.job.company, title: a.job.title, urls: [a.job.url, a.job.applicationUrl].filter((u): u is string => !!u) }));
}
export type EmailMatchCandidate = Awaited<ReturnType<typeof listApplicationsForEmailMatching>>[number];

/** Which of these provider message ids were already read from this connection. */
export async function findKnownEmailIds(connectionId: string, externalIds: string[]) {
  if (externalIds.length === 0) return new Set<string>();
  const rows = await prisma.emailMessage.findMany({ where: { connectionId, externalId: { in: externalIds } }, select: { externalId: true } });
  return new Set(rows.map((r) => r.externalId));
}

/** The application an earlier email in the same thread was matched to. */
export async function findThreadApplication(connectionId: string, threadId: string) {
  const row = await prisma.emailMessage.findFirst({
    where: { connectionId, threadId, applicationId: { not: null } },
    orderBy: { receivedAt: "desc" },
    select: { applicationId: true },
  });
  return row?.applicationId ?? null;
}

export interface EmailMessageInput {
  externalId: string;
  threadId?: string | null;
  fromName?: string | null;
  fromAddress: string;
  subject: string;
  snippet: string;
  receivedAt: Date;
  kind: EmailKind;
  stage?: string | null;
  confidence: number;
  outcome: EmailOutcome;
  applicationId?: string | null;
  interview?: { scheduledAt?: string | null; durationMinutes?: number | null; location?: string | null; kind?: string | null; fromInvite?: boolean } | null;
}

export async function saveEmailMessage(userId: string, connectionId: string, input: EmailMessageInput) {
  const data = {
    ...input,
    fromName: input.fromName?.slice(0, 200) ?? null,
    fromAddress: input.fromAddress.slice(0, 320),
    subject: input.subject.slice(0, 300),
    snippet: input.snippet.slice(0, 300),
    interview: input.interview ?? undefined,
  };
  return prisma.emailMessage.upsert({
    where: { connectionId_externalId: { connectionId, externalId: input.externalId } },
    create: { ...data, userId, connectionId },
    update: {},
  });
}

// ─── Email activity (what the user sees) ────────────────────────────────────

export const EMAIL_ACTIVITY_FILTERS = ["all", "review", "updated"] as const;
export type EmailActivityFilter = (typeof EMAIL_ACTIVITY_FILTERS)[number];

const FILTER_OUTCOMES: Record<EmailActivityFilter, EmailOutcome[] | null> = {
  all: null,
  review: ["UNMATCHED", "AMBIGUOUS", "SUGGESTED"],
  updated: ["MOVED", "INTERVIEW_ADDED"],
};

export async function listEmailActivity(userId: string, options: { filter?: EmailActivityFilter; page?: number; pageSize?: number } = {}) {
  const pageSize = options.pageSize ?? 25;
  const page = Math.max(1, options.page ?? 1);
  const outcomes = FILTER_OUTCOMES[options.filter ?? "all"];
  const where: Prisma.EmailMessageWhereInput = { userId, ...(outcomes ? { outcome: { in: outcomes } } : {}) };
  const [total, rows, needsReview] = await Promise.all([
    prisma.emailMessage.count({ where }),
    prisma.emailMessage.findMany({
      where,
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { connection: { select: { provider: true, email: true } }, application: { select: { id: true, job: { select: { title: true, company: true } } } } },
    }),
    countEmailsToReview(userId),
  ]);
  return { total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)), rows, needsReview };
}
export type EmailActivity = Awaited<ReturnType<typeof listEmailActivity>>;

/** Emails waiting for the user to say which application they're about. */
export async function countEmailsToReview(userId: string) {
  return prisma.emailMessage.count({ where: { userId, outcome: { in: ["UNMATCHED", "AMBIGUOUS"] } } });
}

export async function getEmailMessage(userId: string, id: string) {
  const row = await prisma.emailMessage.findFirst({ where: { id, userId }, include: { connection: { select: { provider: true } } } });
  if (!row) throw new NotFoundError("Email");
  return row;
}

export async function setEmailMessageResult(userId: string, id: string, data: { outcome: EmailOutcome; applicationId?: string | null }) {
  const { count } = await prisma.emailMessage.updateMany({ where: { id, userId }, data });
  if (count === 0) throw new NotFoundError("Email");
}

// ─── Calendar ───────────────────────────────────────────────────────────────

/** The connection whose calendar gets interviews, if any. */
export async function getCalendarConnectionId(userId: string) {
  const c = await prisma.mailConnection.findFirst({ where: { userId, calendarSync: true, status: "ACTIVE" }, select: { id: true } });
  return c?.id ?? null;
}

/**
 * Interview rounds the calendar sync has to look at: upcoming scheduled ones,
 * and any that still have an event Applyance created.
 */
export async function listRoundsForCalendar(userId: string, now = new Date()) {
  return prisma.interviewRound.findMany({
    where: {
      userId,
      OR: [{ status: "SCHEDULED", scheduledAt: { gte: new Date(now.getTime() - 86_400_000) } }, { calendarEventId: { not: null } }],
    },
    orderBy: { scheduledAt: "asc" },
    take: 500,
    include: { application: { select: { id: true, job: { select: { title: true, company: true, url: true } } } } },
  });
}
export type CalendarRound = Awaited<ReturnType<typeof listRoundsForCalendar>>[number];

export async function setRoundCalendarState(
  roundId: string,
  data: { calendarConnectionId?: string | null; calendarEventId?: string | null; calendarHash?: string | null; calendarSyncedAt?: Date | null; calendarError?: string | null },
) {
  // updateMany: the round may have been deleted while the calendar call ran.
  await prisma.interviewRound.updateMany({ where: { id: roundId }, data: { ...data, calendarError: data.calendarError?.slice(0, 500) ?? null } });
}

export async function listCalendarRemovals(connectionId: string) {
  return prisma.calendarEventRemoval.findMany({ where: { connectionId }, orderBy: { createdAt: "asc" }, take: 100 });
}

export async function settleCalendarRemoval(id: string, done: boolean) {
  if (done) await prisma.calendarEventRemoval.deleteMany({ where: { id } });
  else {
    // Give up after a few tries; the event is the user's to delete then.
    await prisma.calendarEventRemoval.update({ where: { id }, data: { attempts: { increment: 1 } } });
    await prisma.calendarEventRemoval.deleteMany({ where: { id, attempts: { gte: 5 } } });
  }
}
