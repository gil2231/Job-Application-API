import { beforeEach, describe, expect, it } from "vitest";
import { manualJobSchema } from "@autoapply/shared";
import { prisma } from "../src/client";
import { createManualJob } from "../src/repositories/jobs";
import { approveForSubmission, queueApplications } from "../src/repositories/applications";
import { claimApplication, findDispatchableApplications, recoverExpiredLeases, renewLease, settlePauseAfterCurrent, startOfDayInTimeZone } from "../src/repositories/queue";
import { setQueueState, getUserSettings } from "../src/repositories/settings";
import { finishAttempt, saveApplicationQuestions } from "../src/repositories/worker";
import { makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

let n = 0;
async function queued(userId: string, count = 1) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    n += 1;
    const job = await createManualJob(userId, manualJobSchema.parse({ url: `https://example.com/jobs/${n}`, title: `Role ${n}`, company: "Acme" }), "GENERIC");
    ids.push(job.id);
  }
  await queueApplications(userId, ids);
  return prisma.application.findMany({ where: { jobId: { in: ids } }, orderBy: { createdAt: "asc" } });
}

async function setup(rule: { maxConcurrentApplications?: number; maxApplicationsPerDay?: number } = {}) {
  const user = await makeUser();
  await getUserSettings(user.id);
  await prisma.automationRule.upsert({ where: { userId: user.id }, update: rule, create: { userId: user.id, matchWeights: {}, ...rule } });
  return user;
}

describe("claimApplication", () => {
  it("moves a queued application to processing with a lease and a new attempt", async () => {
    const user = await setup();
    const [app] = await queued(user.id);
    const claim = await claimApplication(app!.id, "w1", 60_000);
    expect(claim).toMatchObject({ claimed: true, attemptNumber: 1, userId: user.id });
    const after = await prisma.application.findUniqueOrThrow({ where: { id: app!.id }, include: { attempts: true } });
    expect(after).toMatchObject({ status: "PROCESSING", lockedBy: "w1", attemptCount: 1 });
    expect(after.startedAt).not.toBeNull();
    expect(after.attempts[0]).toMatchObject({ status: "RUNNING", workerId: "w1" });
    // A second claim (another worker, or a duplicate queue entry) is refused.
    expect(await claimApplication(app!.id, "w2", 60_000)).toEqual({ claimed: false, reason: "not_queued" });
  });

  it("refuses while the queue is paused or set to pause after the current application", async () => {
    const user = await setup();
    const [app] = await queued(user.id);
    await setQueueState(user.id, "pause");
    expect(await claimApplication(app!.id, "w1", 60_000)).toEqual({ claimed: false, reason: "paused" });
    expect(await findDispatchableApplications()).toHaveLength(0);
    await setQueueState(user.id, "resume");
    await setQueueState(user.id, "pause_after_current");
    expect(await claimApplication(app!.id, "w1", 60_000)).toEqual({ claimed: false, reason: "paused" });
    expect(await settlePauseAfterCurrent(user.id)).toBe(true);
    expect(await prisma.userSetting.findUniqueOrThrow({ where: { userId: user.id } })).toMatchObject({ queuePaused: true, pauseAfterCurrent: false });
  });

  it("enforces the user's concurrency limit, even when claims race", async () => {
    const user = await setup({ maxConcurrentApplications: 2 });
    const apps = await queued(user.id, 5);
    const results = await Promise.all(apps.map((a, i) => claimApplication(a.id, `w${i}`, 60_000)));
    expect(results.filter((r) => r.claimed)).toHaveLength(2);
    expect(results.filter((r) => !r.claimed).every((r) => !r.claimed && r.reason === "concurrency")).toBe(true);
  });

  it("enforces the daily limit, without counting resumed applications twice", async () => {
    const user = await setup({ maxApplicationsPerDay: 1, maxConcurrentApplications: 5 });
    const [a, b] = await queued(user.id, 2);
    const first = await claimApplication(a!.id, "w1", 60_000);
    expect(first.claimed).toBe(true);
    expect(await claimApplication(b!.id, "w1", 60_000)).toEqual({ claimed: false, reason: "daily_limit" });
    // The first one pauses for review and comes back: it was already started today, so it may continue.
    if (!first.claimed) throw new Error("unreachable");
    await finishAttempt({ applicationId: a!.id, attemptId: first.attemptId, userId: user.id, workerId: "w1", outcome: { kind: "attention", status: "REVIEW_REQUIRED", reason: "FINAL_REVIEW", detail: "Review" } });
    await approveForSubmission(user.id, a!.id);
    expect(await claimApplication(a!.id, "w1", 60_000)).toMatchObject({ claimed: true, attemptNumber: 2 });
  });

  it("doesn't claim before a retry's backoff has passed", async () => {
    const user = await setup();
    const [app] = await queued(user.id);
    await prisma.application.update({ where: { id: app!.id }, data: { nextAttemptAt: new Date(Date.now() + 60_000) } });
    expect(await claimApplication(app!.id, "w1", 60_000)).toEqual({ claimed: false, reason: "not_due" });
    expect(await findDispatchableApplications()).toHaveLength(0);
  });
});

describe("leases", () => {
  it("returns applications from a crashed worker to the queue", async () => {
    const user = await setup();
    const [app] = await queued(user.id);
    await claimApplication(app!.id, "dead-worker", 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(await renewLease(app!.id, "someone-else", 60_000)).toBe(false);
    expect(await recoverExpiredLeases()).toBe(1);
    const after = await prisma.application.findUniqueOrThrow({ where: { id: app!.id }, include: { attempts: true, events: true } });
    expect(after).toMatchObject({ status: "QUEUED", lockedBy: null });
    expect(after.attempts[0]).toMatchObject({ status: "FAILED", failureType: "UNKNOWN_ERROR" });
    expect(after.events.some((e) => e.message.includes("stopped unexpectedly"))).toBe(true);
  });

  it("a worker that lost its application can't overwrite what the user did", async () => {
    const user = await setup();
    const [app] = await queued(user.id);
    const claim = await claimApplication(app!.id, "w1", 60_000);
    if (!claim.claimed) throw new Error("not claimed");
    await setQueueState(user.id, "stop");
    const applied = await finishAttempt({ applicationId: app!.id, attemptId: claim.attemptId, userId: user.id, workerId: "w1", outcome: { kind: "submitted", message: "Submitted" } });
    expect(applied).toBe(false);
    const after = await prisma.application.findUniqueOrThrow({ where: { id: app!.id }, include: { attempts: true } });
    expect(after).toMatchObject({ status: "QUEUED", lockedBy: null });
    expect(after.attempts[0]!.status).toBe("CANCELLED");
  });
});

describe("saveApplicationQuestions", () => {
  it("upserts questions per page without overwriting the user's decisions", async () => {
    const user = await setup();
    const [app] = await queued(user.id);
    const q = { label: "Favorite color", normalizedKey: "favorite_color", fieldType: "TEXT" as const, required: true, pageIndex: 0, mappedField: null, confidence: 0, status: "NEEDS_REVIEW" as const, reviewReason: "Unknown" };
    await saveApplicationQuestions(app!.id, [q]);
    const saved = await prisma.applicationQuestion.findFirstOrThrow({ where: { applicationId: app!.id } });
    expect(saved.reviewReason).toBe("Unknown");
    await prisma.applicationQuestion.update({ where: { id: saved.id }, data: { status: "APPROVED", answer: { create: { value: "Green", source: "USER", confidence: 100, approvedByUser: true } } } });
    await saveApplicationQuestions(app!.id, [{ ...q, status: "ANSWERED", answer: { value: "Blue", source: "PROFILE", confidence: 90 } }]);
    const after = await prisma.applicationQuestion.findMany({ where: { applicationId: app!.id }, include: { answer: true } });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ status: "APPROVED" });
    expect(after[0]!.answer?.value).toBe("Green");
  });
});

describe("startOfDayInTimeZone", () => {
  it("finds local midnight", () => {
    const now = new Date("2026-10-06T03:30:00Z"); // 23:30 on Oct 5 in New York
    expect(startOfDayInTimeZone("America/New_York", now).toISOString()).toBe("2026-10-05T04:00:00.000Z");
    expect(startOfDayInTimeZone("UTC", now).toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect(startOfDayInTimeZone("Not/AZone", now).toISOString()).toBe("2026-10-06T00:00:00.000Z");
  });
});
