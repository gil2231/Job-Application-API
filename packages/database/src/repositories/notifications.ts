import { ATTENTION_APPLICATION_STATUSES, MAX_SAVED_SEARCHES, type NotificationSettingsInput } from "@autoapply/shared";
import { Prisma, type NotificationKind, type NotificationStatus } from "@prisma/client";
import { prisma } from "../client";

// ── Settings ────────────────────────────────────────────────────────────────

export async function saveNotificationSettings(userId: string, input: NotificationSettingsInput) {
  await prisma.userSetting.upsert({ where: { userId }, update: input, create: { userId, ...input } });
}

/** Turn one kind of email off from an unsubscribe link. */
export async function unsubscribeUser(userId: string, kind: "attention" | "job_alerts") {
  const data = kind === "attention" ? { emailNotifications: false } : { jobAlertEmails: false };
  const { count } = await prisma.userSetting.updateMany({ where: { userId }, data });
  if (!count && (await prisma.user.count({ where: { id: userId } }))) await prisma.userSetting.create({ data: { userId, ...data } });
}

// ── Notification history ────────────────────────────────────────────────────

export interface NotificationRecord {
  userId: string;
  kind: NotificationKind;
  status: NotificationStatus;
  recipient: string;
  subject: string;
  data?: Prisma.InputJsonValue;
  providerMessageId?: string | null;
  error?: string | null;
  createdAt?: Date;
}

export async function recordNotification(input: NotificationRecord) {
  return prisma.notification.create({ data: { ...input, error: input.error?.slice(0, 1000) ?? null } });
}

export async function listNotifications(userId: string, limit = 20) {
  return prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit });
}

/** When an alert of this kind last went out (or was tried), for the resend cooldown. */
export async function lastNotificationAt(userId: string, kind: NotificationKind): Promise<Date | null> {
  const last = await prisma.notification.findFirst({ where: { userId, kind, status: { in: ["SENT", "FAILED"] } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  return last?.createdAt ?? null;
}

// ── Needs Attention alerts ──────────────────────────────────────────────────

/**
 * Needs Attention events no alert has covered yet, oldest first. Only events
 * created before `before` are returned, so a burst of pauses (a worker stopping
 * on several applications in a row) settles into one email.
 */
export async function findPendingAttentionEvents(input: { before: Date; limit?: number }) {
  return prisma.applicationEvent.findMany({
    where: { type: "HUMAN_INPUT_REQUIRED", notifiedAt: null, createdAt: { lte: input.before } },
    orderBy: { createdAt: "asc" },
    take: input.limit ?? 500,
    select: {
      id: true,
      userId: true,
      createdAt: true,
      message: true,
      application: {
        select: {
          id: true,
          status: true,
          attentionReason: true,
          attentionDetail: true,
          updatedAt: true,
          job: { select: { title: true, company: true } },
        },
      },
      user: { select: { email: true, name: true, settings: { select: { emailNotifications: true } } } },
    },
  });
}
export type PendingAttentionEvent = Awaited<ReturnType<typeof findPendingAttentionEvents>>[number];

/** Claim events for an alert. Returns how many this caller claimed (another worker may have taken some). */
export async function markEventsNotified(eventIds: string[], at = new Date()) {
  if (!eventIds.length) return 0;
  const { count } = await prisma.applicationEvent.updateMany({ where: { id: { in: eventIds }, notifiedAt: null }, data: { notifiedAt: at } });
  return count;
}

/** Put claimed events back so the next run tries again (the email failed to send). */
export async function releaseEventsNotified(eventIds: string[]) {
  if (!eventIds.length) return;
  await prisma.applicationEvent.updateMany({ where: { id: { in: eventIds } }, data: { notifiedAt: null } });
}

export async function countWaitingApplications(userId: string) {
  return prisma.application.count({ where: { userId, status: { in: [...ATTENTION_APPLICATION_STATUSES] } } });
}

// ── Saved searches ──────────────────────────────────────────────────────────

export interface SavedSearchInput {
  name: string;
  boards: string[];
  query: string;
  location: string | null;
  searchDescriptions: boolean;
  matchAny: boolean;
  alertsEnabled: boolean;
}

export class SavedSearchLimitError extends Error {
  constructor() {
    super(`You can save up to ${MAX_SAVED_SEARCHES} searches. Delete one to add another.`);
    this.name = "SavedSearchLimitError";
  }
}

export class SavedSearchNameTakenError extends Error {
  constructor() {
    super("You already have a saved search with this name.");
    this.name = "SavedSearchNameTakenError";
  }
}

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export async function listSavedSearches(userId: string) {
  return prisma.savedSearch.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, include: { _count: { select: { matches: true } } } });
}

export async function getSavedSearch(userId: string, id: string) {
  return prisma.savedSearch.findFirst({ where: { id, userId } });
}
export type SavedSearchRow = NonNullable<Awaited<ReturnType<typeof getSavedSearch>>>;

export async function createSavedSearch(userId: string, input: SavedSearchInput) {
  return prisma.$transaction(async (tx) => {
    if ((await tx.savedSearch.count({ where: { userId } })) >= MAX_SAVED_SEARCHES) throw new SavedSearchLimitError();
    try {
      return await tx.savedSearch.create({ data: { userId, ...input } });
    } catch (error) {
      if (isUniqueViolation(error)) throw new SavedSearchNameTakenError();
      throw error;
    }
  });
}

/**
 * Change a saved search. A change to what it searches for starts a new
 * baseline: the postings already found stop counting as "seen", so the next
 * run doesn't email every match of the new search as new.
 */
export async function updateSavedSearch(userId: string, id: string, input: SavedSearchInput) {
  const existing = await getSavedSearch(userId, id);
  if (!existing) return null;
  const searchChanged =
    existing.query !== input.query ||
    existing.location !== input.location ||
    existing.searchDescriptions !== input.searchDescriptions ||
    existing.matchAny !== input.matchAny ||
    existing.boards.join("\n") !== input.boards.join("\n");
  try {
    return await prisma.$transaction(async (tx) => {
      if (searchChanged) await tx.savedSearchMatch.deleteMany({ where: { savedSearchId: id } });
      return tx.savedSearch.update({ where: { id }, data: { ...input, ...(searchChanged ? { lastRunAt: null, lastError: null, lastNewCount: null } : {}) } });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new SavedSearchNameTakenError();
    throw error;
  }
}

export async function setSavedSearchAlerts(userId: string, id: string, alertsEnabled: boolean) {
  const { count } = await prisma.savedSearch.updateMany({ where: { id, userId }, data: { alertsEnabled } });
  return count > 0;
}

export async function deleteSavedSearch(userId: string, id: string) {
  const { count } = await prisma.savedSearch.deleteMany({ where: { id, userId } });
  return count > 0;
}

export interface SearchMatchInput {
  canonicalUrl: string;
  url: string;
  title: string;
  company: string;
  location: string | null;
  salaryText: string | null;
  postedAt: Date | null;
  wasNew: boolean;
}

/** Which of these postings the search has already found. */
export async function findSeenMatchUrls(savedSearchId: string, canonicalUrls: string[]) {
  if (!canonicalUrls.length) return new Set<string>();
  const rows = await prisma.savedSearchMatch.findMany({ where: { savedSearchId, canonicalUrl: { in: canonicalUrls } }, select: { canonicalUrl: true } });
  return new Set(rows.map((r) => r.canonicalUrl));
}

/** Store a run's postings and outcome. Returns the matches that were stored as new. */
export async function recordSavedSearchRun(input: { userId: string; savedSearchId: string; matches: SearchMatchInput[]; error: string | null; at?: Date }) {
  const at = input.at ?? new Date();
  const newCount = input.matches.filter((m) => m.wasNew).length;
  await prisma.$transaction([
    prisma.savedSearchMatch.createMany({
      data: input.matches.map((m) => ({ ...m, savedSearchId: input.savedSearchId, userId: input.userId, firstSeenAt: at })),
      skipDuplicates: true,
    }),
    prisma.savedSearch.update({ where: { id: input.savedSearchId }, data: { lastRunAt: at, lastError: input.error?.slice(0, 1000) ?? null, lastNewCount: newCount } }),
  ]);
}

/** Record a run that found nothing usable because every board failed. The baseline stays unset. */
export async function recordSavedSearchFailure(savedSearchId: string, error: string) {
  await prisma.savedSearch.update({ where: { id: savedSearchId }, data: { lastError: error.slice(0, 1000) } });
}

/** New postings the user's saved searches found recently, newest first. */
export async function listRecentSearchMatches(userId: string, input: { days: number; savedSearchId?: string; limit?: number }) {
  const since = new Date(Date.now() - input.days * 24 * 60 * 60_000);
  return prisma.savedSearchMatch.findMany({
    where: { userId, wasNew: true, firstSeenAt: { gte: since }, ...(input.savedSearchId ? { savedSearchId: input.savedSearchId } : {}) },
    orderBy: [{ firstSeenAt: "desc" }, { postedAt: { sort: "desc", nulls: "last" } }],
    take: input.limit ?? 100,
    include: { savedSearch: { select: { id: true, name: true } } },
  });
}

export async function markSearchMatchesAdded(userId: string, savedSearchId: string, canonicalUrls: string[]) {
  if (!canonicalUrls.length) return;
  await prisma.savedSearchMatch.updateMany({ where: { userId, savedSearchId, canonicalUrl: { in: canonicalUrls }, addedAt: null }, data: { addedAt: new Date() } });
}

// ── Daily job alert scheduling ──────────────────────────────────────────────

/** Users with daily job alerts on and at least one search to run. */
export async function findJobAlertCandidates(limit = 1000) {
  return prisma.userSetting.findMany({
    where: { jobAlertEmails: true, user: { savedSearches: { some: { alertsEnabled: true } } } },
    select: { userId: true, timezone: true, jobAlertHour: true, jobAlertsRanOn: true },
    take: limit,
  });
}

/**
 * Claim today's job alert run for a user. Only one worker wins the claim, so
 * each user gets at most one alert email per local day.
 */
export async function claimJobAlertRun(userId: string, localDate: string, previous: string | null) {
  const { count } = await prisma.userSetting.updateMany({ where: { userId, jobAlertsRanOn: previous }, data: { jobAlertsRanOn: localDate } });
  return count > 0;
}

export async function listAlertSearchesForUser(userId: string) {
  return prisma.savedSearch.findMany({ where: { userId, alertsEnabled: true }, orderBy: { createdAt: "asc" } });
}

export async function getAlertRecipient(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } });
}
