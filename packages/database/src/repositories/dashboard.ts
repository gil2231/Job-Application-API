import { ATTENTION_APPLICATION_STATUSES, SENT_STATUSES } from "@autoapply/shared";
import { prisma } from "../client";
import { getStageCounts, getUpcomingInterviews } from "./tracker";

const WEEKS = 8;

function startOfWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d;
}

/** Everything the dashboard shows, computed from the user's own rows. */
export async function getDashboardStats(userId: string, now: Date = new Date()) {
  const firstWeek = startOfWeek(new Date(now.getTime() - (WEEKS - 1) * 7 * 24 * 3600 * 1000));
  const liveJob = { userId, deletedAt: null };

  const sent = { userId, status: { in: [...SENT_STATUSES] } };
  const [totalJobs, qualified, analyzed, statusGroups, milestones, avgMatch, weeklyRows, recent, settings, lastSubmitted, stages, upcomingInterviews, responseDays] = await Promise.all([
    prisma.job.count({ where: liveJob }),
    prisma.job.count({ where: { ...liveJob, status: "QUALIFIED" } }),
    prisma.job.count({ where: { ...liveJob, analyzedAt: { not: null } } }),
    prisma.application.groupBy({ by: ["status"], where: { userId }, _count: { _all: true } }),
    Promise.all([
      prisma.application.count({ where: { ...sent, respondedAt: { not: null } } }),
      prisma.application.count({ where: { ...sent, interviewingAt: { not: null } } }),
      prisma.application.count({ where: { ...sent, offerAt: { not: null } } }),
      prisma.application.count({ where: { ...sent, outcome: "ACCEPTED" } }),
    ]),
    prisma.job.aggregate({ where: { ...liveJob, matchScore: { not: null } }, _avg: { matchScore: true } }),
    prisma.$queryRaw<Array<{ week: Date; count: bigint }>>`
      SELECT date_trunc('week', "submittedAt") AS week, COUNT(*)::bigint AS count
      FROM "Application"
      WHERE "userId" = ${userId} AND "submittedAt" >= ${firstWeek}
      GROUP BY 1 ORDER BY 1`,
    prisma.application.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: {
        id: true,
        status: true,
        matchScore: true,
        updatedAt: true,
        submittedAt: true,
        outcome: true,
        job: { select: { title: true, company: true } },
      },
    }),
    prisma.userSetting.findUnique({ where: { userId }, select: { queuePaused: true, pauseAfterCurrent: true } }),
    prisma.application.findFirst({ where: { userId, status: "SUBMITTED" }, orderBy: { submittedAt: "desc" }, select: { submittedAt: true } }),
    getStageCounts(userId),
    getUpcomingInterviews(userId, { now, limit: 5 }),
    prisma.$queryRaw<Array<{ days: number | null }>>`
      SELECT AVG(EXTRACT(EPOCH FROM ("respondedAt" - "submittedAt")) / 86400)::float AS days
      FROM "Application"
      WHERE "userId" = ${userId} AND "respondedAt" IS NOT NULL AND "submittedAt" IS NOT NULL AND "respondedAt" >= "submittedAt"`,
  ]);

  const byStatus = Object.fromEntries(statusGroups.map((g) => [g.status, g._count._all])) as Record<string, number>;
  const count = (s: string) => byStatus[s] ?? 0;

  const submitted = count("SUBMITTED") + count("REJECTED");
  const needsReview = ATTENTION_APPLICATION_STATUSES.reduce((n, s) => n + count(s), 0);
  const applicationsTotal = Object.values(byStatus).reduce((a, b) => a + b, 0);
  // Milestones count every application that ever reached the stage, so the funnel never shrinks as applications move on.
  const [responded, interviews, offers, accepted] = milestones;
  const rate = (n: number) => (submitted ? Math.round((n / submitted) * 100) : null);
  const avgDays = responseDays[0]?.days;

  const weekly = Array.from({ length: WEEKS }, (_, i) => {
    const week = new Date(firstWeek.getTime() + i * 7 * 24 * 3600 * 1000);
    const row = weeklyRows.find((r) => startOfWeek(new Date(r.week)).getTime() === week.getTime());
    return { week: week.toISOString().slice(0, 10), count: row ? Number(row.count) : 0 };
  });

  return {
    cards: {
      totalJobs,
      qualified,
      applicationsSent: submitted,
      needsReview,
      failed: count("FAILED"),
    },
    funnel: [
      { stage: "Imported", count: totalJobs },
      { stage: "Analyzed", count: analyzed },
      { stage: "Queued", count: applicationsTotal },
      { stage: "Submitted", count: submitted },
      { stage: "Responded", count: responded },
      { stage: "Interviewing", count: interviews },
      { stage: "Offer", count: offers },
      { stage: "Accepted", count: accepted },
    ],
    weekly,
    responses: {
      submitted,
      responded,
      interviews,
      offers,
      accepted,
      /** Sent applications not yet accepted, rejected or withdrawn. */
      active: stages.SUBMITTED + stages.RESPONDED + stages.INTERVIEWING + stages.OFFER,
      responseRate: rate(responded),
      interviewRate: rate(interviews),
      offerRate: rate(offers),
      avgDaysToResponse: avgDays != null ? Math.round(avgDays * 10) / 10 : null,
    },
    stages,
    upcomingInterviews,
    averageMatchScore: avgMatch._avg.matchScore != null ? Math.round(avgMatch._avg.matchScore) : null,
    recent,
    automation: {
      queued: count("QUEUED"),
      processing: count("PROCESSING"),
      waiting: count("WAITING_FOR_USER") + count("REVIEW_REQUIRED"),
      ready: count("READY"),
      paused: settings?.queuePaused ?? false,
      pauseAfterCurrent: settings?.pauseAfterCurrent ?? false,
      lastSubmittedAt: lastSubmitted?.submittedAt ?? null,
    },
  };
}
export type DashboardStats = Awaited<ReturnType<typeof getDashboardStats>>;

/**
 * Cheap fingerprint of the user's pipeline state. The live-update stream
 * compares this between polls and tells the browser to refresh when it changes.
 */
export async function getChangeFingerprint(userId: string): Promise<string> {
  const [jobs, apps, events, interviews] = await Promise.all([
    prisma.job.aggregate({ where: { userId }, _max: { updatedAt: true }, _count: { _all: true } }),
    prisma.application.aggregate({ where: { userId }, _max: { updatedAt: true }, _count: { _all: true } }),
    prisma.applicationEvent.aggregate({ where: { userId }, _max: { createdAt: true } }),
    prisma.interviewRound.aggregate({ where: { userId }, _max: { updatedAt: true }, _count: { _all: true } }),
  ]);
  return [
    interviews._count._all,
    interviews._max.updatedAt?.getTime() ?? 0,
    jobs._count._all,
    jobs._max.updatedAt?.getTime() ?? 0,
    apps._count._all,
    apps._max.updatedAt?.getTime() ?? 0,
    events._max.createdAt?.getTime() ?? 0,
  ].join(":");
}
