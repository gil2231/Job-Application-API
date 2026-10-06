import type { AttentionReason, FailureType, Platform } from "@autoapply/shared";
import { prisma } from "../client";

/**
 * Automation health: how the worker's runs went over a period, for one user.
 * This is about the automation itself (did runs finish, why did they fail,
 * did retries help), not about hiring outcomes, which Flightpath tracks.
 *
 * Each finished attempt counts once:
 * - completed: it submitted, or filled everything and stopped for the final review it was asked to
 * - needed you: it stopped for something only a person can do (CAPTCHA, sign-in, an unclear question)
 * - failed: it hit an error (and was retried, or gave up)
 * - stopped: the person stopped or skipped it; not counted for or against
 */

export type RunOutcome = "completed" | "needed_you" | "failed" | "stopped";

/** Pauses that mean the automation did its job and is waiting for the person's go-ahead. */
const DONE_AND_WAITING: ReadonlySet<AttentionReason> = new Set(["FINAL_REVIEW"]);

export function attemptOutcome(a: { status: string; attentionReason: AttentionReason | null }): RunOutcome | null {
  switch (a.status) {
    case "SUCCEEDED":
      return "completed";
    case "PAUSED":
      return a.attentionReason && DONE_AND_WAITING.has(a.attentionReason) ? "completed" : "needed_you";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "stopped";
    default:
      return null;
  }
}

/** YYYY-MM-DD in the given time zone (UTC if the zone is unknown). */
function dayKey(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

const MAX_ATTEMPTS_READ = 20_000;

export async function getAutomationHealth(userId: string, days: number, now: Date = new Date()) {
  const since = new Date(now.getTime() - days * 24 * 3600 * 1000);
  const [settings, attempts, scheduled, recentFailures, gaveUp, running] = await Promise.all([
    prisma.userSetting.findUnique({ where: { userId }, select: { timezone: true } }),
    prisma.applicationAttempt.findMany({
      where: { application: { userId }, endedAt: { gte: since, lte: now } },
      select: { applicationId: true, attemptNumber: true, status: true, failureType: true, attentionReason: true, startedAt: true, endedAt: true, application: { select: { platform: true } } },
      orderBy: { endedAt: "asc" },
      take: MAX_ATTEMPTS_READ,
    }),
    prisma.application.findMany({
      where: { userId, status: "QUEUED", nextAttemptAt: { gt: now } },
      orderBy: { nextAttemptAt: "asc" },
      take: 25,
      select: { id: true, nextAttemptAt: true, failureType: true, lastError: true, attemptCount: true, job: { select: { title: true, company: true } } },
    }),
    prisma.applicationAttempt.findMany({
      where: { application: { userId }, status: "FAILED", endedAt: { gte: since, lte: now } },
      orderBy: { endedAt: "desc" },
      take: 10,
      select: { id: true, attemptNumber: true, failureType: true, errorMessage: true, endedAt: true, application: { select: { id: true, status: true, job: { select: { title: true, company: true } } } } },
    }),
    prisma.application.count({ where: { userId, attentionReason: "REPEATED_FAILURE", status: { in: ["WAITING_FOR_USER", "REVIEW_REQUIRED"] } } }),
    prisma.application.count({ where: { userId, status: "PROCESSING" } }),
  ]);
  const timeZone = settings?.timezone ?? "UTC";

  const totals = { completed: 0, needed_you: 0, failed: 0, stopped: 0 };
  const failures = new Map<FailureType, number>();
  const pauses = new Map<AttentionReason, number>();
  const platforms = new Map<Platform, { runs: number; completed: number; failures: Map<FailureType, number> }>();
  const daily = new Map<string, { completed: number; needed_you: number; failed: number }>();
  const durations: number[] = [];
  // Per application, in time order: did a run fail, and did a later one complete?
  const recovery = new Map<string, { failed: boolean; recovered: boolean }>();
  let retries = 0;

  for (const a of attempts) {
    const outcome = attemptOutcome(a);
    if (!outcome || !a.endedAt) continue;
    totals[outcome]++;
    if (outcome === "stopped") continue;
    if (a.attemptNumber > 1) retries++;

    const day = daily.get(dayKey(a.endedAt, timeZone)) ?? { completed: 0, needed_you: 0, failed: 0 };
    day[outcome]++;
    daily.set(dayKey(a.endedAt, timeZone), day);

    const platform = platforms.get(a.application.platform) ?? { runs: 0, completed: 0, failures: new Map() };
    platform.runs++;
    if (outcome === "completed") platform.completed++;
    platforms.set(a.application.platform, platform);

    if (outcome === "failed") {
      const type = a.failureType ?? "UNKNOWN_ERROR";
      failures.set(type, (failures.get(type) ?? 0) + 1);
      platform.failures.set(type, (platform.failures.get(type) ?? 0) + 1);
    }
    if (outcome === "needed_you" && a.attentionReason) pauses.set(a.attentionReason, (pauses.get(a.attentionReason) ?? 0) + 1);
    if (outcome === "completed" && a.status === "SUCCEEDED") durations.push(a.endedAt.getTime() - a.startedAt.getTime());

    const r = recovery.get(a.applicationId) ?? { failed: false, recovered: false };
    if (outcome === "failed") r.failed = true;
    else if (outcome === "completed" && r.failed) r.recovered = true;
    recovery.set(a.applicationId, r);
  }

  const counted = totals.completed + totals.needed_you + totals.failed;
  const failedApps = [...recovery.values()].filter((r) => r.failed);
  const recovered = failedApps.filter((r) => r.recovered).length;

  // Every day in the period, including quiet ones, so the chart has no gaps.
  const series: Array<{ day: string; completed: number; needed_you: number; failed: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey(new Date(now.getTime() - i * 24 * 3600 * 1000), timeZone);
    if (series.at(-1)?.day === key) continue;
    series.push({ day: key, ...(daily.get(key) ?? { completed: 0, needed_you: 0, failed: 0 }) });
  }

  return {
    days,
    since,
    timeZone,
    truncated: attempts.length >= MAX_ATTEMPTS_READ,
    runs: counted,
    totals,
    successRate: rate(totals.completed, counted),
    neededYouRate: rate(totals.needed_you, counted),
    failureRate: rate(totals.failed, counted),
    retries,
    /** Applications that failed at least once in the period, and how many of those a later run completed. */
    retriedApplications: failedApps.length,
    recoveredApplications: recovered,
    recoveryRate: rate(recovered, failedApps.length),
    medianSubmitMs: median(durations),
    running,
    gaveUp,
    failures: [...failures.entries()].map(([type, count]) => ({ type, count, share: rate(count, totals.failed) ?? 0 })).sort((a, b) => b.count - a.count),
    pauses: [...pauses.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    platforms: [...platforms.entries()]
      .map(([platform, p]) => ({
        platform,
        runs: p.runs,
        completed: p.completed,
        successRate: rate(p.completed, p.runs),
        topFailure: [...p.failures.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      }))
      .sort((a, b) => b.runs - a.runs),
    daily: series,
    scheduled: scheduled.map((a) => ({ id: a.id, title: a.job.title, company: a.job.company, nextAttemptAt: a.nextAttemptAt!, failureType: a.failureType, lastError: a.lastError, attempts: a.attemptCount })),
    recentFailures: recentFailures.map((f) => ({
      attemptId: f.id,
      applicationId: f.application.id,
      applicationStatus: f.application.status,
      title: f.application.job.title,
      company: f.application.job.company,
      attempt: f.attemptNumber,
      failureType: f.failureType ?? ("UNKNOWN_ERROR" as const),
      message: f.errorMessage,
      at: f.endedAt!,
    })),
  };
}
export type AutomationHealth = Awaited<ReturnType<typeof getAutomationHealth>>;

/**
 * Run applications that are waiting out a retry backoff right away. A site
 * still in cooldown holds them again when the worker picks them up.
 */
export async function retryScheduledNow(userId: string, applicationIds: string[], now: Date = new Date()): Promise<number> {
  const apps = await prisma.application.findMany({ where: { id: { in: applicationIds }, userId, status: "QUEUED", nextAttemptAt: { gt: now } }, select: { id: true } });
  if (!apps.length) return 0;
  const ids = apps.map((a) => a.id);
  await prisma.$transaction([
    prisma.application.updateMany({ where: { id: { in: ids }, userId, status: "QUEUED" }, data: { nextAttemptAt: null } }),
    prisma.applicationEvent.createMany({ data: ids.map((applicationId) => ({ applicationId, userId, type: "RETRY_SCHEDULED" as const, message: "Retry now requested by you" })) }),
  ]);
  return ids.length;
}
