import { beforeEach, describe, expect, it } from "vitest";
import { manualJobSchema, type AttentionReason, type FailureType, type Platform } from "@autoapply/shared";
import { prisma } from "../src/client";
import { queueApplications } from "../src/repositories/applications";
import { attemptOutcome, getAutomationHealth, retryScheduledNow } from "../src/repositories/health";
import { createManualJob } from "../src/repositories/jobs";
import { deferApplication } from "../src/repositories/worker";
import { getUserSettings } from "../src/repositories/settings";
import { makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

const NOW = new Date("2026-10-06T18:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

let n = 0;
async function application(userId: string, platform: Platform = "GREENHOUSE") {
  n += 1;
  const job = await createManualJob(userId, manualJobSchema.parse({ url: `https://example.com/jobs/${n}`, title: `Role ${n}`, company: "Acme" }), platform);
  await queueApplications(userId, [job.id]);
  return prisma.application.update({ where: { jobId: job.id }, data: { platform } });
}

type Attempt = { status: "SUCCEEDED" | "FAILED" | "PAUSED" | "CANCELLED"; failureType?: FailureType; attentionReason?: AttentionReason; endedHoursAgo: number; minutes?: number };
async function attempts(applicationId: string, list: Attempt[]) {
  let number = 0;
  for (const a of list) {
    number += 1;
    const endedAt = hoursAgo(a.endedHoursAgo);
    await prisma.applicationAttempt.create({
      data: { applicationId, attemptNumber: number, status: a.status, failureType: a.failureType, attentionReason: a.attentionReason, endedAt, startedAt: new Date(endedAt.getTime() - (a.minutes ?? 2) * 60_000), errorMessage: a.failureType ? "boom" : null },
    });
  }
}

describe("attemptOutcome", () => {
  it("counts a final-review pause as completed and other pauses as needing the person", () => {
    expect(attemptOutcome({ status: "SUCCEEDED", attentionReason: null })).toBe("completed");
    expect(attemptOutcome({ status: "PAUSED", attentionReason: "FINAL_REVIEW" })).toBe("completed");
    expect(attemptOutcome({ status: "PAUSED", attentionReason: "CAPTCHA" })).toBe("needed_you");
    expect(attemptOutcome({ status: "PAUSED", attentionReason: null })).toBe("needed_you");
    expect(attemptOutcome({ status: "CANCELLED", attentionReason: null })).toBe("stopped");
    expect(attemptOutcome({ status: "RUNNING", attentionReason: null })).toBeNull();
  });
});

describe("getAutomationHealth", () => {
  it("computes success, failure classes, retries, recovery and platforms for the period", async () => {
    const user = await makeUser();
    await getUserSettings(user.id);
    const a = await application(user.id, "GREENHOUSE");
    const b = await application(user.id, "GREENHOUSE");
    const c = await application(user.id, "WORKDAY");
    const d = await application(user.id, "LEVER");
    // a: timed out, then submitted on the retry (recovered).
    await attempts(a.id, [{ status: "FAILED", failureType: "TIMEOUT", endedHoursAgo: 30 }, { status: "SUCCEEDED", endedHoursAgo: 29, minutes: 4 }]);
    // b: filled and waiting for final review.
    await attempts(b.id, [{ status: "PAUSED", attentionReason: "FINAL_REVIEW", endedHoursAgo: 5 }]);
    // c: site down twice, never recovered.
    await attempts(c.id, [{ status: "FAILED", failureType: "SITE_UNAVAILABLE", endedHoursAgo: 3 }, { status: "FAILED", failureType: "SITE_UNAVAILABLE", endedHoursAgo: 2 }]);
    // d: CAPTCHA, then stopped by the person; plus an old run outside the period.
    await attempts(d.id, [{ status: "SUCCEEDED", endedHoursAgo: 24 * 40 }, { status: "PAUSED", attentionReason: "CAPTCHA", endedHoursAgo: 1 }, { status: "CANCELLED", endedHoursAgo: 0.5 }]);
    await prisma.application.update({ where: { id: c.id }, data: { status: "QUEUED", nextAttemptAt: new Date(NOW.getTime() + 600_000), failureType: "SITE_UNAVAILABLE", lastError: "Site down: HTTP 503", attemptCount: 2 } });

    const health = await getAutomationHealth(user.id, 7, NOW);
    expect(health.totals).toEqual({ completed: 2, needed_you: 1, failed: 3, stopped: 1 });
    expect(health.runs).toBe(6);
    expect(health.successRate).toBe(33);
    expect(health.failureRate).toBe(50);
    expect(health.retries).toBe(3);
    expect(health.retriedApplications).toBe(2);
    expect(health.recoveredApplications).toBe(1);
    expect(health.recoveryRate).toBe(50);
    expect(health.medianSubmitMs).toBe(4 * 60_000);
    expect(health.failures).toEqual([{ type: "SITE_UNAVAILABLE", count: 2, share: 67 }, { type: "TIMEOUT", count: 1, share: 33 }]);
    expect(health.pauses).toEqual([{ reason: "CAPTCHA", count: 1 }]);
    expect(health.platforms.find((p) => p.platform === "GREENHOUSE")).toMatchObject({ runs: 3, completed: 2, successRate: 67, topFailure: "TIMEOUT" });
    expect(health.platforms.find((p) => p.platform === "WORKDAY")).toMatchObject({ runs: 2, completed: 0, topFailure: "SITE_UNAVAILABLE" });
    expect(health.daily).toHaveLength(7);
    expect(health.daily.reduce((s, d) => s + d.completed + d.failed + d.needed_you, 0)).toBe(6);
    expect(health.scheduled).toHaveLength(1);
    expect(health.scheduled[0]).toMatchObject({ id: c.id, failureType: "SITE_UNAVAILABLE", attempts: 2 });
    expect(health.recentFailures.map((f) => f.failureType)).toEqual(["SITE_UNAVAILABLE", "SITE_UNAVAILABLE", "TIMEOUT"]);

    // The 90-day view includes the old run.
    expect((await getAutomationHealth(user.id, 90, NOW)).totals.completed).toBe(3);
  });

  it("keeps each person's numbers to themselves", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const app = await application(owner.id);
    await attempts(app.id, [{ status: "FAILED", failureType: "TIMEOUT", endedHoursAgo: 1 }]);
    const health = await getAutomationHealth(other.id, 7, NOW);
    expect(health.runs).toBe(0);
    expect(health.successRate).toBeNull();
    expect(health.recentFailures).toHaveLength(0);
  });
});

describe("scheduled retries", () => {
  it("runs a backed-off application now, only for its owner", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const app = await application(owner.id);
    const later = new Date(Date.now() + 3600_000);
    await prisma.application.update({ where: { id: app.id }, data: { nextAttemptAt: later } });
    expect(await retryScheduledNow(other.id, [app.id])).toBe(0);
    expect(await retryScheduledNow(owner.id, [app.id])).toBe(1);
    const after = await prisma.application.findUniqueOrThrow({ where: { id: app.id }, include: { events: true } });
    expect(after.nextAttemptAt).toBeNull();
    expect(after.events.some((e) => e.message === "Retry now requested by you")).toBe(true);
    expect(await retryScheduledNow(owner.id, [app.id])).toBe(0);
  });

  it("defers a queued application once per new hold", async () => {
    const user = await makeUser();
    const app = await application(user.id);
    const until = new Date(Date.now() + 600_000);
    expect(await deferApplication(app.id, until, "Waiting for the site")).toBe(true);
    expect(await deferApplication(app.id, until, "Waiting for the site")).toBe(false);
    await prisma.application.update({ where: { id: app.id }, data: { status: "SKIPPED" } });
    expect(await deferApplication(app.id, new Date(Date.now() + 900_000), "Waiting")).toBe(false);
  });
});
