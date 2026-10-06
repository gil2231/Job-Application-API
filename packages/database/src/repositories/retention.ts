import { Prisma } from "@prisma/client";
import { prisma } from "../client";

/**
 * Data retention, run by the worker's maintenance sweep: expired sign-in
 * sessions are deleted, saved site sessions past their expiry lose their
 * cookies, and attempt screenshots older than each person's "Keep screenshots"
 * setting are removed (they can show personal details on application forms).
 */

export async function purgeExpiredSessionData(now: Date = new Date()): Promise<{ sessions: number; browserSessions: number }> {
  const [sessions, expired, cleared] = await prisma.$transaction([
    prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.browserSession.updateMany({ where: { status: "ACTIVE", expiresAt: { lt: now } }, data: { status: "EXPIRED", storageStateEncrypted: null } }),
    prisma.browserSession.updateMany({ where: { status: { not: "ACTIVE" }, storageStateEncrypted: { not: null } }, data: { storageStateEncrypted: null } }),
  ]);
  return { sessions: sessions.count, browserSessions: expired.count + cleared.count };
}

export interface ExpiredScreenshots {
  attemptId: string;
  keys: string[];
}

/** Attempts whose screenshots are past their owner's retention period (default 30 days). */
export async function findExpiredScreenshots(now: Date = new Date(), limit = 200): Promise<ExpiredScreenshots[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string; screenshots: unknown }>>`
    SELECT a."id", a."screenshots"
    FROM "ApplicationAttempt" a
    JOIN "Application" ap ON ap."id" = a."applicationId"
    LEFT JOIN "UserSetting" s ON s."userId" = ap."userId"
    WHERE a."screenshots" IS NOT NULL
      AND a."endedAt" IS NOT NULL
      AND a."endedAt" < ${now}::timestamp - make_interval(days => COALESCE(s."screenshotRetentionDays", 30))
    ORDER BY a."endedAt" ASC
    LIMIT ${limit}`;
  return rows.map((r) => ({
    attemptId: r.id,
    keys: Array.isArray(r.screenshots) ? (r.screenshots as Array<{ key?: unknown }>).map((s) => s.key).filter((k): k is string => typeof k === "string") : [],
  }));
}

export async function clearScreenshots(attemptIds: string[]): Promise<number> {
  if (!attemptIds.length) return 0;
  const { count } = await prisma.applicationAttempt.updateMany({ where: { id: { in: attemptIds } }, data: { screenshots: Prisma.DbNull } });
  return count;
}
