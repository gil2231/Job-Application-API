import type { Prisma } from "@prisma/client";
import type { ApplicationEventType, ApplicationStatus, AttentionReason, EventLevel, FailureType, Platform } from "@autoapply/shared";
import { prisma } from "../client";
import { decryptString, encryptString } from "../crypto";
import { resolveCoverLetterForJob, resolveResumeForJob } from "./documents";
import { getFullProfile } from "./profile";

/**
 * Reads and writes the worker needs while processing an application. Every
 * write that changes the application is conditional on the worker still
 * holding it (status PROCESSING and its own lease), so a user who pressed Stop
 * or Skip mid-run always wins.
 */

const documentSelect = { id: true, name: true, document: { select: { storageKey: true, fileName: true, mimeType: true } } } as const;

export async function loadProcessingContext(applicationId: string) {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      job: true,
      resume: { select: documentSelect },
      coverLetter: { select: documentSelect },
      questions: { include: { answer: { include: { libraryAnswer: { select: { isSensitive: true } } } } } },
    },
  });
  if (!app) return null;
  const userId = app.userId;
  const [profile, settings, rule, libraryRows] = await Promise.all([
    getFullProfile(userId),
    prisma.userSetting.upsert({ where: { userId }, update: {}, create: { userId } }),
    prisma.automationRule.findUnique({ where: { userId }, select: { autoSubmitEnabled: true, requiresSponsorship: true } }),
    prisma.applicationAnswer.findMany({ where: { userId } }),
  ]);

  // Job-specific materials uploaded after the application was queued still win.
  // A generated draft that hasn't been approved has no file; fall back to the job's approved or default one.
  let resume = app.resume?.document ? app.resume : null;
  if (!resume) {
    const found = await resolveResumeForJob(userId, app.jobId);
    resume = found ? await prisma.resume.findUnique({ where: { id: found.id }, select: documentSelect }) : null;
  }
  let coverLetter = app.coverLetter?.document ? app.coverLetter : null;
  if (!coverLetter) {
    const found = await resolveCoverLetterForJob(userId, app.jobId);
    coverLetter = found ? await prisma.coverLetter.findUnique({ where: { id: found.id }, select: documentSelect }) : null;
  }

  return {
    application: {
      id: app.id,
      userId,
      status: app.status,
      mode: app.mode,
      platform: app.platform,
      attemptCount: app.attemptCount,
      submitApprovedAt: app.submitApprovedAt,
    },
    job: app.job,
    resume: resume?.document ? { id: resume.id, name: resume.name, ...resume.document } : null,
    coverLetter: coverLetter?.document ? { id: coverLetter.id, name: coverLetter.name, ...coverLetter.document } : null,
    questions: app.questions.map((q) => ({
      id: q.id,
      label: q.label,
      normalizedKey: q.normalizedKey,
      pageIndex: q.pageIndex,
      status: q.status,
      required: q.required,
      answer: q.answer
        ? {
            value: decryptString(q.answer.value),
            source: q.answer.source,
            confidence: q.answer.confidence,
            approvedByUser: q.answer.approvedByUser,
            sensitive: q.answer.libraryAnswer?.isSensitive ?? false,
          }
        : null,
    })),
    profile,
    settings: {
      fieldConfidenceThreshold: settings.fieldConfidenceThreshold,
      answerConfidenceThreshold: settings.answerConfidenceThreshold,
      timezone: settings.timezone,
      aiProvider: settings.aiProvider,
      aiModel: settings.aiModel,
    },
    rule: { autoSubmitEnabled: rule?.autoSubmitEnabled ?? false, requiresSponsorship: rule?.requiresSponsorship ?? false },
    library: libraryRows.map((a) => ({
      id: a.id,
      questionKey: a.questionKey,
      question: a.question,
      answer: a.isSensitive ? decryptString(a.answer) : a.answer,
      category: a.category,
      confidence: a.confidence,
      autoSubmitAllowed: a.autoSubmitAllowed,
      requiresHumanReview: a.requiresHumanReview,
      isSensitive: a.isSensitive,
    })),
  };
}
export type ProcessingContext = NonNullable<Awaited<ReturnType<typeof loadProcessingContext>>>;

export async function addApplicationEvent(
  applicationId: string,
  userId: string,
  type: ApplicationEventType,
  message: string,
  options: { level?: EventLevel; data?: unknown } = {},
) {
  await prisma.applicationEvent.create({
    data: {
      applicationId,
      userId,
      type,
      message: message.slice(0, 2000),
      level: options.level ?? "INFO",
      data: options.data === undefined ? undefined : (options.data as Prisma.InputJsonValue),
    },
  });
}

/** Record what the worker found on the form and the value chosen for each field. */
export interface QuestionRecord {
  label: string;
  normalizedKey: string;
  fieldType: Prisma.ApplicationQuestionCreateInput["fieldType"];
  required: boolean;
  options?: string[];
  pageIndex: number;
  locator?: unknown;
  mappedField: string | null;
  confidence: number | null;
  status: "ANSWERED" | "NEEDS_REVIEW" | "SKIPPED" | "PENDING";
  reviewReason?: string | null;
  answer?: { value: string; source: "USER" | "PROFILE" | "AI_GENERATED" | "IMPORTED"; confidence: number; libraryAnswerId?: string | null; sensitive?: boolean } | null;
}

/**
 * Upsert the questions found on one run. A decision the user already made
 * (approved or skipped) is never overwritten by a later run.
 */
export async function saveApplicationQuestions(applicationId: string, records: QuestionRecord[]) {
  for (const r of records) {
    const existing = await prisma.applicationQuestion.findUnique({
      where: { applicationId_pageIndex_normalizedKey: { applicationId, pageIndex: r.pageIndex, normalizedKey: r.normalizedKey } },
      include: { answer: { select: { approvedByUser: true } } },
    });
    const userDecided = existing && (existing.status === "APPROVED" || existing.status === "SKIPPED");
    const base = {
      label: r.label.slice(0, 500),
      fieldType: r.fieldType,
      required: r.required,
      options: r.options?.length ? (r.options.slice(0, 200) as Prisma.InputJsonValue) : undefined,
      locator: r.locator === undefined ? undefined : (r.locator as Prisma.InputJsonValue),
      mappedField: r.mappedField,
      confidence: r.confidence,
      reviewReason: r.status === "NEEDS_REVIEW" ? (r.reviewReason ?? null)?.slice(0, 500) ?? null : null,
    };
    const question = existing
      ? await prisma.applicationQuestion.update({ where: { id: existing.id }, data: { ...base, ...(userDecided ? {} : { status: r.status }) } })
      : await prisma.applicationQuestion.create({ data: { applicationId, pageIndex: r.pageIndex, normalizedKey: r.normalizedKey, ...base, status: r.status } });
    if (userDecided || existing?.answer?.approvedByUser) continue;
    if (r.answer) {
      const value = r.answer.sensitive ? encryptString(r.answer.value) : r.answer.value;
      const data = { value, source: r.answer.source, confidence: Math.round(r.answer.confidence), libraryAnswerId: r.answer.libraryAnswerId ?? null };
      await prisma.applicationAnswerInstance.upsert({ where: { questionId: question.id }, update: data, create: { questionId: question.id, ...data } });
    } else if (existing) {
      await prisma.applicationAnswerInstance.deleteMany({ where: { questionId: question.id, approvedByUser: false } });
    }
  }
}

export async function setApplicationPlatform(applicationId: string, platform: Platform) {
  const app = await prisma.application.update({ where: { id: applicationId }, data: { platform }, select: { jobId: true } });
  await prisma.job.updateMany({ where: { id: app.jobId, platform: { in: ["UNKNOWN", "GENERIC"] } }, data: { platform } });
}

/** Point a job at the company's own application, found for a job saved from LinkedIn, Handshake or another listing site. */
export async function setJobApplicationUrl(jobId: string, applicationUrl: string, platform: Platform) {
  await prisma.job.update({ where: { id: jobId }, data: { applicationUrl, platform } });
}

export async function setProfileSnapshot(applicationId: string, snapshot: Record<string, unknown>, materials: { resumeId?: string | null; coverLetterId?: string | null }) {
  await prisma.application.update({
    where: { id: applicationId },
    data: {
      profileSnapshot: snapshot as Prisma.InputJsonValue,
      ...(materials.resumeId ? { resumeId: materials.resumeId } : {}),
      ...(materials.coverLetterId ? { coverLetterId: materials.coverLetterId } : {}),
    },
  });
}

export interface ScreenshotRecord {
  key: string;
  caption: string;
  takenAt: string;
}

export async function addAttemptScreenshot(attemptId: string, shot: ScreenshotRecord) {
  const attempt = await prisma.applicationAttempt.findUnique({ where: { id: attemptId }, select: { screenshots: true } });
  const list = Array.isArray(attempt?.screenshots) ? (attempt.screenshots as unknown as ScreenshotRecord[]) : [];
  await prisma.applicationAttempt.update({ where: { id: attemptId }, data: { screenshots: [...list, shot].slice(-50) as unknown as Prisma.InputJsonValue } });
}

export type AttemptOutcome =
  | { kind: "submitted"; confirmation?: string | null; message: string }
  | { kind: "attention"; status: Extract<ApplicationStatus, "WAITING_FOR_USER" | "REVIEW_REQUIRED" | "READY">; reason: AttentionReason; detail: string; keepLease?: { leaseMs: number } }
  | { kind: "retry"; failure: FailureType; message: string; delayMs: number }
  | { kind: "failed"; failure: FailureType; message: string };

/**
 * Close the attempt and move the application to its next status. Returns
 * false (and changes nothing on the application) if the worker no longer holds it.
 */
export async function finishAttempt(input: { applicationId: string; attemptId: string; userId: string; workerId: string; outcome: AttemptOutcome }) {
  const { applicationId, attemptId, userId, workerId, outcome } = input;
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const held = { id: applicationId, status: "PROCESSING" as const, lockedBy: workerId };
    let data: Prisma.ApplicationUpdateManyMutationInput;
    let attempt: Prisma.ApplicationAttemptUpdateInput;
    let event: { type: ApplicationEventType; message: string; level: EventLevel; data?: Prisma.InputJsonValue };
    switch (outcome.kind) {
      case "submitted":
        data = { status: "SUBMITTED", submittedAt: now, completedAt: now, confirmationNumber: outcome.confirmation ?? null, failureType: null, lastError: null, lockedBy: null, lockedUntil: null };
        attempt = { status: "SUCCEEDED", endedAt: now };
        event = { type: "SUBMITTED", message: outcome.message, level: "INFO", data: outcome.confirmation ? { confirmation: outcome.confirmation } : undefined };
        break;
      case "attention":
        data = {
          status: outcome.status,
          attentionReason: outcome.reason,
          attentionDetail: outcome.detail.slice(0, 2000),
          ...(outcome.keepLease ? { lockedUntil: new Date(now.getTime() + outcome.keepLease.leaseMs) } : { lockedBy: null, lockedUntil: null }),
        };
        attempt = { status: "PAUSED", attentionReason: outcome.reason, endedAt: outcome.keepLease ? null : now };
        event = { type: "HUMAN_INPUT_REQUIRED", message: outcome.detail, level: "WARNING", data: { reason: outcome.reason } };
        break;
      case "retry":
        data = { status: "QUEUED", nextAttemptAt: new Date(now.getTime() + outcome.delayMs), queuedAt: now, failureType: outcome.failure, lastError: outcome.message.slice(0, 2000), lockedBy: null, lockedUntil: null };
        attempt = { status: "FAILED", failureType: outcome.failure, errorMessage: outcome.message.slice(0, 2000), endedAt: now };
        event = { type: "RETRY_SCHEDULED", message: `${outcome.message.slice(0, 300)}. Retrying in ${formatDelay(outcome.delayMs)}.`, level: "WARNING", data: { failure: outcome.failure, delayMs: outcome.delayMs } };
        break;
      case "failed":
        data = { status: "FAILED", completedAt: now, failureType: outcome.failure, lastError: outcome.message.slice(0, 2000), lockedBy: null, lockedUntil: null };
        attempt = { status: "FAILED", failureType: outcome.failure, errorMessage: outcome.message.slice(0, 2000), endedAt: now };
        event = { type: "FAILED", message: outcome.message, level: "ERROR", data: { failure: outcome.failure } };
        break;
    }
    const { count } = await tx.application.updateMany({ where: held, data });
    if (!count) {
      await tx.applicationAttempt.updateMany({ where: { id: attemptId, status: "RUNNING" }, data: { status: "CANCELLED", endedAt: now } });
      await tx.application.updateMany({ where: { id: applicationId, lockedBy: workerId }, data: { lockedBy: null, lockedUntil: null } });
      return false;
    }
    await tx.applicationAttempt.update({ where: { id: attemptId }, data: attempt });
    await tx.applicationEvent.create({ data: { applicationId, userId, ...event } });
    return true;
  });
}

/** Where a queued application will go, so the worker can check the site before claiming it. */
export async function getApplicationTarget(applicationId: string) {
  const app = await prisma.application.findUnique({ where: { id: applicationId }, select: { status: true, userId: true, job: { select: { url: true, applicationUrl: true } } } });
  if (!app) return null;
  const url = app.job.applicationUrl ?? app.job.url;
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    /* an unparseable link fails in the engine, with a clear message */
  }
  return { status: app.status, userId: app.userId, host };
}

/**
 * Hold a queued application back until a site's cooldown ends, without
 * claiming it or using up one of its attempts. Records one timeline event per
 * new hold. Returns false if the application isn't queued or is already held
 * at least that long.
 */
export async function deferApplication(applicationId: string, until: Date, message: string): Promise<boolean> {
  const app = await prisma.application.findUnique({ where: { id: applicationId }, select: { status: true, userId: true, nextAttemptAt: true } });
  if (!app || app.status !== "QUEUED" || (app.nextAttemptAt && app.nextAttemptAt >= until)) return false;
  const { count } = await prisma.application.updateMany({ where: { id: applicationId, status: "QUEUED" }, data: { nextAttemptAt: until } });
  if (count) await addApplicationEvent(applicationId, app.userId, "RETRY_SCHEDULED", message, { data: { deferredUntil: until.toISOString() } });
  return count > 0;
}

/** The user stopped or skipped the application while it ran: close the attempt without touching the status. */
export async function cancelAttempt(applicationId: string, attemptId: string, workerId: string, message: string) {
  const now = new Date();
  await prisma.$transaction([
    prisma.applicationAttempt.updateMany({ where: { id: attemptId, status: { in: ["RUNNING", "PAUSED"] } }, data: { status: "CANCELLED", endedAt: now, errorMessage: message } }),
    prisma.application.updateMany({ where: { id: applicationId, lockedBy: workerId }, data: { lockedBy: null, lockedUntil: null } }),
  ]);
}

/** Current state of an application the worker is holding (for checkpoints and interactive waits). */
export async function getHeldState(applicationId: string) {
  return prisma.application.findUnique({ where: { id: applicationId }, select: { status: true, lockedBy: true, submitApprovedAt: true, attentionReason: true } });
}

/** Keep a READY application held while the person submits it in the open browser. */
export async function holdForManualSubmit(applicationId: string, workerId: string, leaseMs: number) {
  await prisma.application.updateMany({ where: { id: applicationId, lockedBy: workerId }, data: { lockedUntil: new Date(Date.now() + leaseMs) } });
}

/**
 * Take an application the worker kept open back into PROCESSING: either the
 * user pressed "I've completed it" (status QUEUED) or the worker saw the
 * blocker disappear from the page while it was waiting.
 */
export async function resumeHeldApplication(applicationId: string, attemptId: string, userId: string, workerId: string, message: string, leaseMs: number) {
  const now = new Date();
  const { count } = await prisma.application.updateMany({
    where: { id: applicationId, lockedBy: workerId, status: { in: ["WAITING_FOR_USER", "QUEUED"] } },
    data: { status: "PROCESSING", attentionReason: null, attentionDetail: null, lockedUntil: new Date(now.getTime() + leaseMs) },
  });
  if (!count) return false;
  await prisma.$transaction([
    prisma.applicationAttempt.update({ where: { id: attemptId }, data: { status: "RUNNING", endedAt: null } }),
    prisma.applicationEvent.create({ data: { applicationId, userId, type: "HUMAN_INPUT_RECEIVED", message } }),
  ]);
  return true;
}

/** Give up waiting in the open browser: the application stays in Needs Attention and the lease is released. */
export async function releaseHeldApplication(applicationId: string, attemptId: string, workerId: string) {
  const now = new Date();
  await prisma.$transaction([
    prisma.applicationAttempt.updateMany({ where: { id: attemptId, status: { in: ["PAUSED", "RUNNING"] } }, data: { status: "PAUSED", endedAt: now } }),
    prisma.application.updateMany({ where: { id: applicationId, lockedBy: workerId }, data: { lockedBy: null, lockedUntil: null } }),
  ]);
}

/** The user said they finished a step, but the page still shows it: put the application back to waiting. */
export async function markStillWaiting(applicationId: string, userId: string, workerId: string, detail: string) {
  const { count } = await prisma.application.updateMany({
    where: { id: applicationId, lockedBy: workerId, status: "QUEUED" },
    data: { status: "WAITING_FOR_USER", attentionDetail: detail.slice(0, 2000) },
  });
  if (count) await prisma.applicationEvent.create({ data: { applicationId, userId, type: "HUMAN_INPUT_REQUIRED", level: "WARNING", message: detail.slice(0, 2000) } });
}

/** The person clicked Submit in the browser window Applyance left open (Manual mode). */
export async function recordSubmittedInBrowser(applicationId: string, attemptId: string, userId: string, workerId: string, confirmation: string | null) {
  const now = new Date();
  const { count } = await prisma.application.updateMany({
    where: { id: applicationId, lockedBy: workerId, status: "READY" },
    data: { status: "SUBMITTED", submittedAt: now, completedAt: now, confirmationNumber: confirmation, attentionReason: null, attentionDetail: null, lockedBy: null, lockedUntil: null },
  });
  if (!count) return false;
  await prisma.$transaction([
    prisma.applicationAttempt.update({ where: { id: attemptId }, data: { status: "SUCCEEDED", endedAt: now } }),
    prisma.applicationEvent.create({ data: { applicationId, userId, type: "SUBMITTED", message: confirmation ? `Submitted by you in the browser (confirmation ${confirmation})` : "Submitted by you in the browser" } }),
  ]);
  return true;
}

/** The worker is shutting down mid-run: hand the application back to the queue for another worker. */
export async function requeueAfterShutdown(applicationId: string, attemptId: string, userId: string, workerId: string) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.applicationAttempt.updateMany({ where: { id: attemptId, status: { in: ["RUNNING", "PAUSED"] } }, data: { status: "CANCELLED", endedAt: now, errorMessage: "Worker shut down" } });
    const { count } = await tx.application.updateMany({
      where: { id: applicationId, lockedBy: workerId, status: "PROCESSING" },
      data: { status: "QUEUED", queuedAt: now, lockedBy: null, lockedUntil: null },
    });
    await tx.application.updateMany({ where: { id: applicationId, lockedBy: workerId }, data: { lockedBy: null, lockedUntil: null } });
    if (count) await tx.applicationEvent.create({ data: { applicationId, userId, type: "STATUS_CHANGED", level: "WARNING", message: "The worker shut down; returned to the queue" } });
  });
}

// ─── Saved browser sessions ─────────────────────────────────────────────────

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

/** Saved cookies and local storage for a site, so a sign-in the user completed once is reused. */
export async function loadBrowserSession(userId: string, domain: string): Promise<{ id: string; storageState: unknown } | null> {
  const row = await prisma.browserSession.findUnique({ where: { userId_domain: { userId, domain } } });
  if (!row || row.status !== "ACTIVE" || !row.storageStateEncrypted) return null;
  if (row.expiresAt && row.expiresAt < new Date()) {
    await prisma.browserSession.update({ where: { id: row.id }, data: { status: "EXPIRED" } });
    return null;
  }
  try {
    return { id: row.id, storageState: JSON.parse(decryptString(row.storageStateEncrypted)) };
  } catch {
    return null;
  }
}

export async function saveBrowserSession(userId: string, domain: string, platform: Platform, storageState: unknown) {
  const storageStateEncrypted = encryptString(JSON.stringify(storageState));
  const now = new Date();
  return prisma.browserSession.upsert({
    where: { userId_domain: { userId, domain } },
    update: { storageStateEncrypted, status: "ACTIVE", platform, lastUsedAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) },
    create: { userId, domain, platform, storageStateEncrypted, lastUsedAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) },
    select: { id: true },
  });
}

export async function linkAttemptBrowserSession(attemptId: string, browserSessionId: string) {
  await prisma.applicationAttempt.update({ where: { id: attemptId }, data: { browserSessionId } });
}

export async function listBrowserSessions(userId: string) {
  return prisma.browserSession.findMany({
    where: { userId },
    orderBy: { lastUsedAt: { sort: "desc", nulls: "last" } },
    select: { id: true, domain: true, platform: true, status: true, lastUsedAt: true, expiresAt: true, createdAt: true },
  });
}

export async function revokeBrowserSession(userId: string, id: string) {
  const { count } = await prisma.browserSession.updateMany({ where: { id, userId }, data: { status: "REVOKED", storageStateEncrypted: null } });
  return count > 0;
}

function formatDelay(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m} min` : `${Math.round(m / 60)} h`;
}
