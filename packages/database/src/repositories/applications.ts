import type { Prisma } from "@prisma/client";
import {
  ATTENTION_APPLICATION_STATUSES,
  type ApplicationFilters,
  type ApplicationOutcome,
  type ApplicationStatus,
  type AutomationMode,
} from "@autoapply/shared";
import { prisma } from "../client";
import { decryptString, encryptString } from "../crypto";
import { ConflictError, NotFoundError } from "./errors";
import { resolveCoverLetterForJob, resolveResumeForJob } from "./documents";

/**
 * Queue applications for jobs. The unique constraint on Application.jobId means
 * a job can never get a second application; jobs that already have one are
 * reported back as duplicates instead.
 */
export async function queueApplications(userId: string, jobIds: string[], options: { mode?: AutomationMode } = {}) {
  const [jobs, rule] = await Promise.all([
    prisma.job.findMany({
      where: { id: { in: jobIds }, userId, deletedAt: null },
      select: { id: true, platform: true, matchScore: true, application: { select: { id: true } } },
    }),
    prisma.automationRule.findUnique({ where: { userId }, select: { defaultMode: true, autoSubmitEnabled: true } }),
  ]);

  let mode: AutomationMode = options.mode ?? rule?.defaultMode ?? "REVIEW";
  // AUTO is only honored when the user has enabled auto-submit in their rules.
  if (mode === "AUTO" && !rule?.autoSubmitEnabled) mode = "REVIEW";

  const queued: string[] = [];
  const duplicates: string[] = [];
  for (const job of jobs) {
    if (job.application) {
      duplicates.push(job.id);
      continue;
    }
    const [resume, coverLetter] = await Promise.all([resolveResumeForJob(userId, job.id), resolveCoverLetterForJob(userId, job.id)]);
    try {
      await prisma.$transaction(async (tx) => {
        const app = await tx.application.create({
          data: {
            userId,
            jobId: job.id,
            mode,
            platform: job.platform,
            matchScore: job.matchScore,
            resumeId: resume?.id,
            coverLetterId: coverLetter?.id,
          },
        });
        await tx.job.update({ where: { id: job.id }, data: { processedAt: new Date() } });
        await tx.applicationEvent.create({
          data: { applicationId: app.id, userId, type: "QUEUED", message: `Queued in ${mode.toLowerCase()} mode` },
        });
      });
      queued.push(job.id);
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") duplicates.push(job.id);
      else throw error;
    }
  }
  return { queued: queued.length, duplicates: duplicates.length, notFound: jobIds.length - jobs.length, mode };
}

/** Queue every qualified job that has no application yet. */
export async function queueAllQualified(userId: string, options: { mode?: AutomationMode } = {}) {
  const jobs = await prisma.job.findMany({
    where: { userId, deletedAt: null, status: "QUALIFIED", application: null },
    select: { id: true },
    orderBy: [{ matchScore: { sort: "desc", nulls: "last" } }, { savedAt: "asc" }],
    take: 500,
  });
  return queueApplications(userId, jobs.map((j) => j.id), options);
}

/** Put failed applications back in the queue. Applications blocked on a human are not retried. */
export async function retryApplications(userId: string, applicationIds: string[]) {
  const apps = await prisma.application.findMany({
    where: { id: { in: applicationIds }, userId, status: "FAILED" },
    select: { id: true },
  });
  if (apps.length === 0) return { retried: 0 };
  const ids = apps.map((a) => a.id);
  await prisma.$transaction([
    prisma.application.updateMany({
      where: { id: { in: ids }, userId },
      data: { status: "QUEUED", queuedAt: new Date(), nextAttemptAt: null, failureType: null, lastError: null, completedAt: null },
    }),
    prisma.applicationEvent.createMany({
      data: ids.map((applicationId) => ({ applicationId, userId, type: "RETRY_SCHEDULED" as const, message: "Retry requested by user" })),
    }),
  ]);
  return { retried: ids.length };
}

function buildApplicationWhere(userId: string, f: ApplicationFilters): Prisma.ApplicationWhereInput {
  const and: Prisma.ApplicationWhereInput[] = [{ userId }];
  if (f.q) {
    and.push({
      job: { OR: [{ title: { contains: f.q, mode: "insensitive" } }, { company: { contains: f.q, mode: "insensitive" } }] },
    });
  }
  if (f.status.length) and.push({ status: { in: f.status } });
  if (f.platform.length) and.push({ platform: { in: f.platform } });
  return { AND: and };
}

const applicationListSelect = {
  id: true,
  status: true,
  mode: true,
  platform: true,
  matchScore: true,
  attentionReason: true,
  failureType: true,
  attemptCount: true,
  outcome: true,
  queuedAt: true,
  submittedAt: true,
  updatedAt: true,
  createdAt: true,
  job: { select: { id: true, title: true, company: true, location: true, url: true, deletedAt: true } },
} satisfies Prisma.ApplicationSelect;

export type ApplicationListRow = Prisma.ApplicationGetPayload<{ select: typeof applicationListSelect }>;

export async function listApplications(userId: string, f: ApplicationFilters) {
  const where = buildApplicationWhere(userId, f);
  const nullsLast = { sort: f.dir, nulls: "last" } as const;
  const orderBy: Prisma.ApplicationOrderByWithRelationInput[] =
    f.sort === "submittedAt"
      ? [{ submittedAt: nullsLast }, { updatedAt: "desc" }]
      : f.sort === "matchScore"
        ? [{ matchScore: nullsLast }, { updatedAt: "desc" }]
        : [{ [f.sort]: f.dir }, { id: f.dir }];
  const [total, rows, counts] = await prisma.$transaction([
    prisma.application.count({ where }),
    prisma.application.findMany({ where, orderBy, skip: (f.page - 1) * f.pageSize, take: f.pageSize, select: applicationListSelect }),
    prisma.application.groupBy({ by: ["status"], where: { userId }, orderBy: { status: "asc" }, _count: { _all: true } }),
  ]);
  const statusCounts = Object.fromEntries(
    counts.map((c) => [c.status, typeof c._count === "object" ? (c._count._all ?? 0) : 0]),
  ) as Partial<Record<ApplicationStatus, number>>;
  return {
    total,
    page: f.page,
    pageSize: f.pageSize,
    pageCount: Math.max(1, Math.ceil(total / f.pageSize)),
    rows,
    statusCounts,
  };
}

export async function getApplicationDetail(userId: string, id: string) {
  const app = await prisma.application.findFirst({
    where: { id, userId },
    include: {
      job: true,
      resume: { include: { document: { select: { id: true, fileName: true } } } },
      coverLetter: { include: { document: { select: { id: true, fileName: true } } } },
      questions: {
        orderBy: [{ pageIndex: "asc" }, { createdAt: "asc" }],
        include: { answer: true },
      },
      events: { orderBy: { createdAt: "asc" } },
      attempts: { orderBy: { attemptNumber: "desc" } },
    },
  });
  if (!app) throw new NotFoundError("Application");
  const sensitive = new Set(
    (
      await prisma.applicationAnswer.findMany({
        where: { userId, isSensitive: true, id: { in: app.questions.map((q) => q.answer?.libraryAnswerId).filter((x): x is string => !!x) } },
        select: { id: true },
      })
    ).map((a) => a.id),
  );
  return {
    ...app,
    questions: app.questions.map((q) => ({
      ...q,
      answer: q.answer
        ? { ...q.answer, value: decryptString(q.answer.value), sensitive: !!q.answer.libraryAnswerId && sensitive.has(q.answer.libraryAnswerId) }
        : null,
    })),
  };
}
export type ApplicationDetail = Awaited<ReturnType<typeof getApplicationDetail>>;

export async function setApplicationOutcome(userId: string, id: string, outcome: ApplicationOutcome) {
  const app = await prisma.application.findFirst({ where: { id, userId }, select: { id: true, status: true } });
  if (!app) throw new NotFoundError("Application");
  if (app.status !== "SUBMITTED" && app.status !== "REJECTED") {
    throw new ConflictError("Outcomes can only be recorded for submitted applications");
  }
  await prisma.$transaction([
    prisma.application.update({
      where: { id },
      data: {
        outcome,
        outcomeAt: outcome === "NONE" ? null : new Date(),
        status: outcome === "DECLINED" ? "REJECTED" : "SUBMITTED",
      },
    }),
    prisma.applicationEvent.create({
      data: { applicationId: id, userId, type: "OUTCOME_UPDATED", message: `Outcome set to ${outcome.toLowerCase()}` },
    }),
  ]);
}

export async function addApplicationNote(userId: string, id: string, note: string) {
  const app = await prisma.application.findFirst({ where: { id, userId }, select: { id: true } });
  if (!app) throw new NotFoundError("Application");
  await prisma.applicationEvent.create({ data: { applicationId: id, userId, type: "NOTE", message: note.slice(0, 2000) } });
}

// ─── Needs Attention ────────────────────────────────────────────────────────

export async function listAttentionItems(userId: string) {
  const apps = await prisma.application.findMany({
    where: { userId, status: { in: [...ATTENTION_APPLICATION_STATUSES] } },
    orderBy: [{ priority: "desc" }, { updatedAt: "asc" }],
    include: {
      job: { select: { id: true, title: true, company: true, url: true, applicationUrl: true } },
      questions: {
        where: { status: "NEEDS_REVIEW" },
        orderBy: [{ pageIndex: "asc" }, { createdAt: "asc" }],
        include: { answer: true },
      },
    },
  });
  return apps.map((a) => ({
    ...a,
    questions: a.questions.map((q) => ({ ...q, answer: q.answer ? { ...q.answer, value: decryptString(q.answer.value) } : null })),
  }));
}
export type AttentionItem = Awaited<ReturnType<typeof listAttentionItems>>[number];

async function loadOwnedQuestion(userId: string, questionId: string) {
  const question = await prisma.applicationQuestion.findFirst({
    where: { id: questionId, application: { userId } },
    include: { answer: { include: { libraryAnswer: { select: { isSensitive: true } } } }, application: { select: { id: true, status: true } } },
  });
  if (!question) throw new NotFoundError("Question");
  return question;
}

/** When no question on the application still needs review, send it back to the queue. */
async function resumeIfResolved(tx: Prisma.TransactionClient, userId: string, applicationId: string) {
  const app = await tx.application.findUnique({ where: { id: applicationId }, select: { status: true, attentionReason: true } });
  if (!app || app.status !== "REVIEW_REQUIRED" || app.attentionReason !== "QUESTION_REVIEW") return;
  const remaining = await tx.applicationQuestion.count({ where: { applicationId, status: "NEEDS_REVIEW" } });
  if (remaining > 0) return;
  await tx.application.update({
    where: { id: applicationId },
    data: { status: "QUEUED", attentionReason: null, attentionDetail: null, queuedAt: new Date() },
  });
  await tx.applicationEvent.create({
    data: { applicationId, userId, type: "HUMAN_INPUT_RECEIVED", message: "All questions reviewed; application returned to the queue" },
  });
}

/** Approve a suggested answer, optionally after editing it. */
export async function approveQuestionAnswer(userId: string, questionId: string, editedValue?: string) {
  const question = await loadOwnedQuestion(userId, questionId);
  const sensitive = question.answer?.libraryAnswer?.isSensitive ?? false;
  const raw = editedValue ?? (question.answer ? decryptString(question.answer.value) : undefined);
  if (raw == null || raw.trim() === "") throw new ConflictError("Enter an answer before approving");
  const value = sensitive ? encryptString(raw) : raw;
  await prisma.$transaction(async (tx) => {
    await tx.applicationAnswerInstance.upsert({
      where: { questionId },
      update: { value, approvedByUser: true, approvedAt: new Date(), ...(editedValue != null ? { source: "USER", confidence: 100 } : {}) },
      create: { questionId, value, source: "USER", confidence: 100, approvedByUser: true, approvedAt: new Date() },
    });
    await tx.applicationQuestion.update({ where: { id: questionId }, data: { status: "APPROVED" } });
    await tx.applicationEvent.create({
      data: {
        applicationId: question.application.id,
        userId,
        type: "HUMAN_INPUT_RECEIVED",
        message: `${editedValue != null ? "Edited and approved" : "Approved"} answer for "${question.label.slice(0, 120)}"`,
      },
    });
    await resumeIfResolved(tx, userId, question.application.id);
  });
}

/** Skip an optional question. Required questions cannot be skipped. */
export async function skipQuestion(userId: string, questionId: string) {
  const question = await loadOwnedQuestion(userId, questionId);
  if (question.required) throw new ConflictError("This question is required, so it cannot be skipped. Edit the answer or skip the application.");
  await prisma.$transaction(async (tx) => {
    await tx.applicationQuestion.update({ where: { id: questionId }, data: { status: "SKIPPED" } });
    await tx.applicationEvent.create({
      data: { applicationId: question.application.id, userId, type: "HUMAN_INPUT_RECEIVED", message: `Skipped "${question.label.slice(0, 120)}"` },
    });
    await resumeIfResolved(tx, userId, question.application.id);
  });
}

/**
 * The user says they completed a human-only step (CAPTCHA, MFA, sign-in, or
 * final review). The application goes back to the queue and the worker resumes
 * it; the worker re-checks the page, so a false "done" just returns here.
 */
export async function markHumanStepComplete(userId: string, applicationId: string) {
  const app = await prisma.application.findFirst({
    where: { id: applicationId, userId, status: { in: [...ATTENTION_APPLICATION_STATUSES] } },
    select: { id: true, attentionReason: true },
  });
  if (!app) throw new NotFoundError("Application waiting for you");
  const pending = await prisma.applicationQuestion.count({ where: { applicationId, status: "NEEDS_REVIEW" } });
  if (pending > 0) throw new ConflictError("Review the remaining questions first");
  await prisma.$transaction([
    prisma.application.update({
      where: { id: applicationId },
      data: { status: "QUEUED", attentionReason: null, attentionDetail: null, queuedAt: new Date(), priority: { increment: 10 } },
    }),
    prisma.applicationEvent.create({
      data: {
        applicationId,
        userId,
        type: "HUMAN_INPUT_RECEIVED",
        message: `User completed ${app.attentionReason ? app.attentionReason.toLowerCase().replace(/_/g, " ") : "the requested step"}`,
      },
    }),
  ]);
}

/** The user submitted the application themselves (Manual or Review mode). */
export async function markSubmittedByUser(userId: string, applicationId: string) {
  const { count } = await prisma.application.updateMany({
    where: { id: applicationId, userId, status: { in: ["WAITING_FOR_USER", "REVIEW_REQUIRED", "READY"] } },
    data: { status: "SUBMITTED", submittedAt: new Date(), completedAt: new Date(), attentionReason: null, attentionDetail: null },
  });
  if (count === 0) throw new NotFoundError("Application waiting for submission");
  await prisma.applicationEvent.create({ data: { applicationId, userId, type: "SUBMITTED", message: "Submitted by user" } });
}

export async function skipApplication(userId: string, applicationId: string) {
  const { count } = await prisma.application.updateMany({
    where: { id: applicationId, userId, status: { notIn: ["SUBMITTED", "PROCESSING", "REJECTED"] } },
    data: { status: "SKIPPED", attentionReason: null, attentionDetail: null, completedAt: new Date() },
  });
  if (count === 0) throw new NotFoundError("Application that can be skipped");
  await prisma.applicationEvent.create({ data: { applicationId, userId, type: "STATUS_CHANGED", message: "Skipped by user" } });
}
