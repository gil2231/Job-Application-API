import { prisma } from "../client";

/**
 * Queue claiming and worker leases.
 *
 * Postgres decides who runs what. A worker claims an application by moving it
 * QUEUED → PROCESSING inside a transaction that holds a per-user advisory lock,
 * so the user's pause state, concurrency limit and daily limit are checked and
 * applied atomically even with several workers. The claim also takes a lease
 * (lockedBy / lockedUntil) that the worker renews; if a worker dies, the lease
 * lapses and recoverExpiredLeases() returns the application to the queue.
 */

export type ClaimRefusal = "not_queued" | "not_due" | "leased" | "paused" | "concurrency" | "daily_limit";

export type ClaimResult =
  | { claimed: true; attemptId: string; attemptNumber: number; userId: string }
  | { claimed: false; reason: ClaimRefusal };

/** Midnight today in the given IANA time zone (falls back to UTC for an unknown zone). */
export function startOfDayInTimeZone(timeZone: string, now: Date = new Date()): Date {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const localAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offset = localAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")) - offset);
}

/** Applications held by a worker right now (processing, or kept open waiting on the user). */
const heldWhere = (userId: string, now: Date) => ({
  userId,
  OR: [{ status: "PROCESSING" as const }, { lockedBy: { not: null }, lockedUntil: { gt: now } }],
});

export async function claimApplication(applicationId: string, workerId: string, leaseMs: number, now: Date = new Date()): Promise<ClaimResult> {
  const owner = await prisma.application.findUnique({ where: { id: applicationId }, select: { userId: true } });
  if (!owner) return { claimed: false, reason: "not_queued" };
  const userId = owner.userId;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`claim:${userId}`}))`;
    const app = await tx.application.findUnique({
      where: { id: applicationId },
      select: { status: true, nextAttemptAt: true, lockedBy: true, lockedUntil: true, startedAt: true, attemptCount: true },
    });
    if (!app || app.status !== "QUEUED") return { claimed: false, reason: "not_queued" } as const;
    if (app.nextAttemptAt && app.nextAttemptAt > now) return { claimed: false, reason: "not_due" } as const;
    const leasedElsewhere = app.lockedBy && app.lockedBy !== workerId && app.lockedUntil && app.lockedUntil > now;
    if (leasedElsewhere) return { claimed: false, reason: "leased" } as const;

    const [settings, rule] = await Promise.all([
      tx.userSetting.findUnique({ where: { userId }, select: { queuePaused: true, pauseAfterCurrent: true, timezone: true } }),
      tx.automationRule.findUnique({ where: { userId }, select: { maxConcurrentApplications: true, maxApplicationsPerDay: true } }),
    ]);
    if (settings?.queuePaused || settings?.pauseAfterCurrent) return { claimed: false, reason: "paused" } as const;

    const maxConcurrent = Math.max(1, rule?.maxConcurrentApplications ?? 1);
    const held = await tx.application.count({ where: { ...heldWhere(userId, now), NOT: { id: applicationId } } });
    if (held >= maxConcurrent) return { claimed: false, reason: "concurrency" } as const;

    // The daily limit counts applications started today; resuming one already started doesn't use up another slot.
    if (!app.startedAt) {
      const startedToday = await tx.application.count({
        where: { userId, startedAt: { gte: startOfDayInTimeZone(settings?.timezone ?? "UTC", now) } },
      });
      if (startedToday >= (rule?.maxApplicationsPerDay ?? 25)) return { claimed: false, reason: "daily_limit" } as const;
    }

    const attemptNumber = app.attemptCount + 1;
    await tx.application.update({
      where: { id: applicationId },
      data: {
        status: "PROCESSING",
        lockedBy: workerId,
        lockedUntil: new Date(now.getTime() + leaseMs),
        startedAt: app.startedAt ?? now,
        attemptCount: attemptNumber,
        nextAttemptAt: null,
        attentionReason: null,
        attentionDetail: null,
      },
    });
    const attempt = await tx.applicationAttempt.create({ data: { applicationId, attemptNumber, workerId, status: "RUNNING", startedAt: now } });
    await tx.applicationEvent.create({
      data: { applicationId, userId, type: "STATUS_CHANGED", message: attemptNumber > 1 ? `Processing started (attempt ${attemptNumber})` : "Processing started" },
    });
    return { claimed: true, attemptId: attempt.id, attemptNumber, userId } as const;
  });
}

/** Extend a lease the worker still holds. Returns false if the lease was lost (stopped, or taken over). */
export async function renewLease(applicationId: string, workerId: string, leaseMs: number): Promise<boolean> {
  const { count } = await prisma.application.updateMany({
    where: { id: applicationId, lockedBy: workerId },
    data: { lockedUntil: new Date(Date.now() + leaseMs) },
  });
  return count > 0;
}

export async function releaseLease(applicationId: string, workerId: string): Promise<void> {
  await prisma.application.updateMany({ where: { id: applicationId, lockedBy: workerId }, data: { lockedBy: null, lockedUntil: null } });
}

/**
 * Applications whose worker vanished (its lease lapsed): processing ones go
 * back to the queue, their open attempt is closed as failed, and the lease is cleared.
 */
export async function recoverExpiredLeases(now: Date = new Date()): Promise<number> {
  const expired = await prisma.application.findMany({
    where: { lockedBy: { not: null }, lockedUntil: { lt: now } },
    select: { id: true, userId: true, status: true, lockedBy: true },
    take: 200,
  });
  for (const app of expired) {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.application.updateMany({
        where: { id: app.id, lockedBy: app.lockedBy, lockedUntil: { lt: now } },
        data: { lockedBy: null, lockedUntil: null, ...(app.status === "PROCESSING" ? { status: "QUEUED", queuedAt: now } : {}) },
      });
      if (!count) return;
      await tx.applicationAttempt.updateMany({
        where: { applicationId: app.id, status: "RUNNING" },
        data: { status: "FAILED", failureType: "UNKNOWN_ERROR", errorMessage: "The worker stopped before finishing this attempt", endedAt: now },
      });
      if (app.status === "PROCESSING") {
        await tx.applicationEvent.create({
          data: { applicationId: app.id, userId: app.userId, type: "STATUS_CHANGED", level: "WARNING", message: "The worker stopped unexpectedly; returned to the queue" },
        });
      }
    });
  }
  return expired.length;
}

/**
 * Applications the scheduler should hand to BullMQ: queued, due, not leased,
 * and belonging to users whose queue isn't paused. Highest priority first.
 */
export async function findDispatchableApplications(limit = 200, now: Date = new Date()) {
  return prisma.application.findMany({
    where: {
      status: "QUEUED",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      AND: [{ OR: [{ lockedBy: null }, { lockedUntil: { lt: now } }] }],
      user: { OR: [{ settings: null }, { settings: { queuePaused: false, pauseAfterCurrent: false } }] },
    },
    orderBy: [{ priority: "desc" }, { queuedAt: "asc" }],
    take: limit,
    select: { id: true, userId: true, priority: true },
  });
}

/**
 * "Pause after current": once the user has nothing processing, flip the
 * request into a real pause.
 */
export async function settlePauseAfterCurrent(userId: string): Promise<boolean> {
  const settings = await prisma.userSetting.findUnique({ where: { userId }, select: { pauseAfterCurrent: true } });
  if (!settings?.pauseAfterCurrent) return false;
  const processing = await prisma.application.count({ where: { userId, status: "PROCESSING" } });
  if (processing > 0) return false;
  const { count } = await prisma.userSetting.updateMany({
    where: { userId, pauseAfterCurrent: true },
    data: { queuePaused: true, pauseAfterCurrent: false },
  });
  return count > 0;
}

/** How many applications the user has started today, against their daily limit. */
export async function getDailyUsage(userId: string, now: Date = new Date()) {
  const [settings, rule] = await Promise.all([
    prisma.userSetting.findUnique({ where: { userId }, select: { timezone: true } }),
    prisma.automationRule.findUnique({ where: { userId }, select: { maxApplicationsPerDay: true } }),
  ]);
  const started = await prisma.application.count({ where: { userId, startedAt: { gte: startOfDayInTimeZone(settings?.timezone ?? "UTC", now) } } });
  return { started, limit: rule?.maxApplicationsPerDay ?? 25 };
}
