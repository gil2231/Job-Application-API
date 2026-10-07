import { ATTENTION_APPLICATION_STATUSES, SENT_STATUSES, type FailureType, type Platform, type UserRole } from "@autoapply/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../client";
import { audit, type AuditContext } from "./audit";
import { planLabel } from "./billing";
import { NotFoundError } from "./errors";

/*
 * Owner admin panel queries. These are the only queries in the app that read
 * across users, so they are deliberately narrow: account facts, counts and
 * automation failures. They never select the Master Profile, documents,
 * resumes, cover letters, answers, salary or work authorization.
 */

const DAY_MS = 24 * 3600 * 1000;
/** An application waiting on its owner this long counts as stuck. */
export const ADMIN_STUCK_AFTER_MS = 3 * DAY_MS;
export const ADMIN_PAGE_SIZE = 50;
const ERROR_PREVIEW_CHARS = 400;

const preview = (text: string | null) => (text && text.length > ERROR_PREVIEW_CHARS ? `${text.slice(0, ERROR_PREVIEW_CHARS)}…` : text);

/** Host of a job's application page (or posting), lower-cased, without "www.". */
const HOST_SQL = `lower(regexp_replace(substring(coalesce(j."applicationUrl", j."url") from '^[a-zA-Z]+://([^/:?#]+)'), '^www\\.', ''))`;

export async function getAdminOverview(now: Date = new Date()) {
  const days = (n: number) => new Date(now.getTime() - n * DAY_MS);
  const stuckBefore = new Date(now.getTime() - ADMIN_STUCK_AFTER_MS);
  const failedSince = days(30);

  const [totalUsers, newUsers7d, newUsers30d, activeUsers7d, totalApplications, submitted7d, failed7d, failedTotal, stuck, failuresByType, failingSites, recentUsers] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: days(7) } } }),
      prisma.user.count({ where: { createdAt: { gte: days(30) } } }),
      prisma.user.count({ where: { OR: [{ lastLoginAt: { gte: days(7) } }, { sessions: { some: { lastSeenAt: { gte: days(7) } } } }] } }),
      prisma.application.count(),
      prisma.application.count({ where: { status: { in: [...SENT_STATUSES] }, submittedAt: { gte: days(7) } } }),
      prisma.application.count({ where: { status: "FAILED", updatedAt: { gte: days(7) } } }),
      prisma.application.count({ where: { status: "FAILED" } }),
      prisma.application.count({ where: { status: { in: [...ATTENTION_APPLICATION_STATUSES] }, updatedAt: { lt: stuckBefore } } }),
      prisma.application.groupBy({
        by: ["failureType"],
        where: { status: "FAILED", updatedAt: { gte: failedSince } },
        _count: { _all: true },
      }),
      prisma.$queryRawUnsafe<Array<{ host: string | null; count: bigint }>>(
        `SELECT ${HOST_SQL} AS host, COUNT(*)::bigint AS count
         FROM "Application" a JOIN "Job" j ON j.id = a."jobId"
         WHERE a.status = 'FAILED' AND a."updatedAt" >= $1
         GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8`,
        failedSince,
      ),
      prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, name: true, email: true, createdAt: true } }),
    ]);

  return {
    users: { total: totalUsers, new7d: newUsers7d, new30d: newUsers30d, active7d: activeUsers7d },
    applications: { total: totalApplications, submitted7d, failed7d, failedTotal, stuck },
    failuresByType: failuresByType
      .map((g) => ({ failureType: (g.failureType ?? "UNKNOWN_ERROR") as FailureType, count: g._count._all }))
      .sort((a, b) => b.count - a.count),
    failingSites: failingSites.map((r) => ({ host: r.host ?? "unknown", count: Number(r.count) })),
    recentUsers,
  };
}

export interface AdminUserFilters {
  q?: string;
  page?: number;
}

export async function listAdminUsers(filters: AdminUserFilters = {}) {
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const q = filters.q?.trim().slice(0, 200);
  const where: Prisma.UserWhereInput = q
    ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] }
    : {};

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        lastLoginAt: true,
        lockedUntil: true,
        subscription: { select: { plan: true, status: true } },
        _count: { select: { jobs: { where: { deletedAt: null } }, applications: true } },
      },
    }),
  ]);

  const ids = users.map((u) => u.id);
  const [groups, seen] = ids.length
    ? await Promise.all([
        prisma.application.groupBy({
          by: ["userId", "status"],
          where: { userId: { in: ids }, status: { in: [...SENT_STATUSES, "FAILED"] } },
          _count: { _all: true },
        }),
        prisma.session.groupBy({ by: ["userId"], where: { userId: { in: ids } }, _max: { lastSeenAt: true } }),
      ])
    : [[], []];
  const lastSeen = new Map(seen.map((s) => [s.userId, s._max.lastSeenAt]));
  const sent = new Map<string, number>();
  const failed = new Map<string, number>();
  for (const g of groups) {
    const map = g.status === "FAILED" ? failed : sent;
    map.set(g.userId, (map.get(g.userId) ?? 0) + g._count._all);
  }

  return {
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)),
    users: users.map(({ _count, subscription, ...u }) => ({
      ...u,
      plan: planLabel(subscription),
      locked: u.lockedUntil != null && u.lockedUntil > new Date(),
      lastActiveAt: latest(u.lastLoginAt, lastSeen.get(u.id) ?? null),
      jobs: _count.jobs,
      applications: _count.applications,
      submitted: sent.get(u.id) ?? 0,
      failed: failed.get(u.id) ?? 0,
    })),
  };
}

/**
 * One user's account summary for the admin panel. Viewing it is audited under
 * the admin's id so the owner's access to customer accounts leaves a trail.
 */
export async function getAdminUserDetail(adminId: string, userId: string, context?: AuditContext) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      emailVerifiedAt: true,
      createdAt: true,
      lastLoginAt: true,
      lockedUntil: true,
      failedLoginCount: true,
      subscription: { select: { plan: true, status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true } },
      settings: { select: { queuePaused: true } },
      automationRule: { select: { defaultMode: true } },
      _count: { select: { jobs: { where: { deletedAt: null } }, documents: true } },
    },
  });
  if (!user) throw new NotFoundError("User");

  const [statusGroups, sessions, failures, signIns] = await Promise.all([
    prisma.application.groupBy({ by: ["status"], where: { userId }, _count: { _all: true } }),
    prisma.session.aggregate({ where: { userId, expiresAt: { gt: new Date() } }, _count: { _all: true }, _max: { lastSeenAt: true } }),
    listAdminFailures({ userId, scope: "all" }, { take: 10 }),
    prisma.auditLog.findMany({
      where: { userId, action: { in: ["auth.sign_in", "auth.sign_up"] } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, action: true, createdAt: true },
    }),
  ]);

  await audit(adminId, "admin.view_user", { entityType: "User", entityId: userId, context });

  const { _count, settings, automationRule, subscription, ...account } = user;
  return {
    plan: { label: planLabel(subscription), renewsAt: subscription?.currentPeriodEnd ?? null, cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false },
    account: { ...account, locked: account.lockedUntil != null && account.lockedUntil > new Date() },
    jobs: _count.jobs,
    documents: _count.documents,
    automationMode: automationRule?.defaultMode ?? null,
    queuePaused: settings?.queuePaused ?? false,
    statusCounts: Object.fromEntries(statusGroups.map((g) => [g.status, g._count._all])) as Partial<Record<string, number>>,
    activeSessions: sessions._count._all,
    lastSeenAt: sessions._max.lastSeenAt,
    failures: failures.items,
    signIns,
  };
}

export type AdminFailureScope = "failed" | "stuck" | "all";

export interface AdminFailureFilters {
  scope?: AdminFailureScope;
  failureType?: FailureType;
  platform?: Platform;
  userId?: string;
  page?: number;
}

/**
 * Applications that failed, or that have waited on their owner for longer
 * than ADMIN_STUCK_AFTER_MS, across every user.
 */
export async function listAdminFailures(filters: AdminFailureFilters = {}, options: { take?: number; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const take = options.take ?? ADMIN_PAGE_SIZE;
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const scope = filters.scope ?? "failed";
  const failed: Prisma.ApplicationWhereInput = { status: "FAILED" };
  const stuck: Prisma.ApplicationWhereInput = {
    status: { in: [...ATTENTION_APPLICATION_STATUSES] },
    updatedAt: { lt: new Date(now.getTime() - ADMIN_STUCK_AFTER_MS) },
  };
  const where: Prisma.ApplicationWhereInput = {
    ...(scope === "failed" ? failed : scope === "stuck" ? stuck : { OR: [failed, stuck] }),
    ...(filters.failureType && { failureType: filters.failureType }),
    ...(filters.platform && { platform: filters.platform }),
    ...(filters.userId && { userId: filters.userId }),
  };

  const [total, rows] = await Promise.all([
    prisma.application.count({ where }),
    prisma.application.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * take,
      take,
      select: {
        id: true,
        status: true,
        platform: true,
        failureType: true,
        attentionReason: true,
        attemptCount: true,
        lastError: true,
        updatedAt: true,
        user: { select: { id: true, email: true } },
        job: { select: { title: true, company: true, url: true, applicationUrl: true } },
      },
    }),
  ]);

  return {
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / take)),
    items: rows.map(({ job, lastError, ...row }) => ({
      ...row,
      lastError: preview(lastError),
      job: { title: job.title, company: job.company, host: hostOf(job.applicationUrl ?? job.url) },
    })),
  };
}

function latest(a: Date | null, b: Date | null): Date | null {
  if (!a || !b) return a ?? b;
  return a > b ? a : b;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "unknown";
  }
}

/**
 * Grant or remove admin access by email. Used by the `pnpm admin:grant`
 * command; the app itself has no way to change roles.
 */
export async function setUserRole(emailInput: string, role: UserRole) {
  const email = emailInput.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new NotFoundError("User");
  const updated = await prisma.user.update({ where: { id: user.id }, data: { role }, select: { id: true, email: true, name: true, role: true } });
  await audit(user.id, role === "ADMIN" ? "admin.role_granted" : "admin.role_revoked", { entityType: "User", entityId: user.id, metadata: { via: "cli" } });
  return updated;
}
