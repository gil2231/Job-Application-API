import { ACTIVE_APPLICATION_STATUSES, type ApplicationStatus } from "@autoapply/shared";
import { prisma } from "../client";

/** Finished tasks stay on the Tasks page this long. */
export const FINISHED_TASK_WINDOW_MS = 24 * 3600 * 1000;

/** Order on the Tasks page: what's running, then what needs the person, then the queue, then what finished. */
const STATUS_ORDER: Record<ApplicationStatus, number> = {
  PROCESSING: 0,
  WAITING_FOR_USER: 1,
  REVIEW_REQUIRED: 1,
  READY: 1,
  QUEUED: 2,
  SUBMITTED: 3,
  FAILED: 3,
  REJECTED: 4,
  SKIPPED: 4,
};

/**
 * The Tasks page: every application in the pipeline as a task, the queue's
 * run state, and a log of recent worker events. Read-only; starting and
 * stopping go through setQueueState like the dashboard's controls.
 */
export async function getTaskBoard(userId: string, now: Date = new Date()) {
  const since = new Date(now.getTime() - FINISHED_TASK_WINDOW_MS);
  const [applications, settings, rule, qualifiedWaiting, events] = await Promise.all([
    prisma.application.findMany({
      where: {
        userId,
        OR: [{ status: { in: [...ACTIVE_APPLICATION_STATUSES] } }, { status: { in: ["SUBMITTED", "FAILED"] }, updatedAt: { gte: since } }],
      },
      select: {
        id: true,
        status: true,
        mode: true,
        platform: true,
        priority: true,
        matchScore: true,
        attentionReason: true,
        attentionDetail: true,
        failureType: true,
        lastError: true,
        attemptCount: true,
        queuedAt: true,
        startedAt: true,
        submittedAt: true,
        updatedAt: true,
        job: { select: { title: true, company: true, location: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 300,
    }),
    prisma.userSetting.findUnique({ where: { userId }, select: { queuePaused: true, pauseAfterCurrent: true } }),
    prisma.automationRule.findUnique({ where: { userId }, select: { defaultMode: true, autoSubmitEnabled: true, maxConcurrentApplications: true } }),
    prisma.job.count({ where: { userId, deletedAt: null, status: "QUALIFIED", application: null } }),
    prisma.applicationEvent.findMany({
      where: { userId, createdAt: { gte: since } },
      select: { id: true, type: true, level: true, message: true, createdAt: true, application: { select: { id: true, job: { select: { company: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
  ]);

  // Queued tasks run in the worker's claim order (priority, then oldest first).
  const tasks = applications.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus) return byStatus;
    if (a.status === "QUEUED") return b.priority - a.priority || a.queuedAt.getTime() - b.queuedAt.getTime();
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  const count = (...statuses: ApplicationStatus[]) => tasks.filter((t) => statuses.includes(t.status)).length;
  return {
    tasks,
    events,
    counts: {
      running: count("PROCESSING"),
      queued: count("QUEUED"),
      needsYou: count("WAITING_FOR_USER", "REVIEW_REQUIRED", "READY"),
      submitted: count("SUBMITTED"),
      failed: count("FAILED"),
    },
    run: {
      paused: settings?.queuePaused ?? false,
      pauseAfterCurrent: settings?.pauseAfterCurrent ?? false,
      // AUTO is honored only when auto-submit is on (see queueApplications).
      mode: rule?.defaultMode === "AUTO" && !rule.autoSubmitEnabled ? "REVIEW" : (rule?.defaultMode ?? "REVIEW"),
      autoSubmitEnabled: rule?.autoSubmitEnabled ?? false,
      concurrency: rule?.maxConcurrentApplications ?? 1,
    },
    qualifiedWaiting,
  };
}

export type TaskBoard = Awaited<ReturnType<typeof getTaskBoard>>;
export type Task = TaskBoard["tasks"][number];
