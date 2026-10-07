import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type Redis from "ioredis";
import { prisma } from "@autoapply/database";
import { createApplicationQueue, createRedis } from "@autoapply/queue";
import { SITE_COOLDOWN_KEY } from "@autoapply/shared";
import { startMockSite, type MockSite } from "../mock-site/server";
import { createProcessor } from "../src/processor";
import { SiteHealth } from "../src/site-health";
import { loadApplication, makeApplicant, makeEngine, queueFor, resetDatabase, runOnce } from "./helpers";

/**
 * Failure classes and backoff against the mock site: outages and rate limits
 * are retried later (honoring Retry-After), a closed posting fails at once, and
 * a site that keeps failing is put in cooldown so other applications to it wait
 * without using up their attempts.
 */
let site: MockSite;
const { engine, browsers, workerId } = makeEngine();

beforeAll(async () => {
  site = await startMockSite();
});
afterAll(async () => {
  await browsers.close();
  await site.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase();
  site.reset();
});

const secondsUntil = (date: Date | null) => (date ? (date.getTime() - Date.now()) / 1000 : 0);

describe("failure classes", () => {
  it("retries a site outage later with a longer backoff", async () => {
    const user = await makeApplicant();
    const app = await queueFor(user.id, `${site.url}/simple`);
    site.failNext("/simple", 503);
    const outcome = await runOnce(engine, workerId, app.id);
    expect(outcome.retryInMs).toBeGreaterThanOrEqual(90_000);
    const after = await loadApplication(app.id);
    expect(after.status).toBe("QUEUED");
    expect(after.failureType).toBe("SITE_UNAVAILABLE");
    expect(after.lastError).toContain("Site down");
    expect(secondsUntil(after.nextAttemptAt)).toBeGreaterThan(90);
    expect(after.attempts[0]).toMatchObject({ status: "FAILED", failureType: "SITE_UNAVAILABLE" });

    // Once the site is back, the next attempt goes through.
    await prisma.application.update({ where: { id: app.id }, data: { nextAttemptAt: null } });
    await runOnce(engine, workerId, app.id);
    expect((await loadApplication(app.id)).status).toBe("SUBMITTED");
  });

  it("waits at least as long as a rate-limited site asks", async () => {
    const user = await makeApplicant();
    const app = await queueFor(user.id, `${site.url}/simple`);
    site.failNext("/simple", 429, 1, 3600);
    await runOnce(engine, workerId, app.id);
    const after = await loadApplication(app.id);
    expect(after.failureType).toBe("RATE_LIMITED");
    expect(secondsUntil(after.nextAttemptAt)).toBeGreaterThan(3500);
    expect(after.events.some((e) => e.type === "RETRY_SCHEDULED")).toBe(true);
  });

  it("fails a closed posting without retrying", async () => {
    const user = await makeApplicant();
    const app = await queueFor(user.id, `${site.url}/simple`);
    site.failNext("/simple", 410);
    const outcome = await runOnce(engine, workerId, app.id);
    expect(outcome.retryInMs).toBeUndefined();
    const after = await loadApplication(app.id);
    expect(after.status).toBe("FAILED");
    expect(after.failureType).toBe("POSTING_CLOSED");
    expect(after.nextAttemptAt).toBeNull();
  });

  it("records why an attempt stopped for a person", async () => {
    const user = await makeApplicant({ mode: "REVIEW" });
    const app = await queueFor(user.id, `${site.url}/simple`, { mode: "REVIEW" });
    await runOnce(engine, workerId, app.id);
    const after = await loadApplication(app.id);
    expect(after.attempts[0]).toMatchObject({ status: "PAUSED", attentionReason: "FINAL_REVIEW" });
  });
});

describe("site cooldown", () => {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  let redis: Redis | null = null;

  beforeAll(async () => {
    const probe = createRedis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    try {
      await probe.connect();
      redis = probe;
    } catch {
      probe.disconnect();
    }
  });
  afterAll(() => redis?.disconnect());
  beforeEach(async () => {
    if (!redis) return;
    await redis.del(SITE_COOLDOWN_KEY);
    const keys = await redis.keys("autoapply:site-failures:*");
    if (keys.length) await redis.del(...keys);
  });

  it("holds off a failing site for every application without using their attempts", async ({ skip }) => {
    if (!redis) return skip();
    const health = new SiteHealth(redis);
    const { engine: withHealth, browsers: guardedBrowsers, config } = makeEngine({ siteHealth: health });
    try {
      const user = await makeApplicant();
      const first = await queueFor(user.id, `${site.url}/simple`);
      const second = await queueFor(user.id, `${site.url}/simple`);
      site.failNext("/simple", 503, 2);
      await runOnce(withHealth, workerId, first.id);
      expect(await health.cooldown("127.0.0.1")).toBeNull();
      await prisma.application.update({ where: { id: first.id }, data: { nextAttemptAt: null } });
      await runOnce(withHealth, workerId, first.id);
      const cooldown = await health.cooldown("127.0.0.1");
      expect(cooldown).toMatchObject({ host: "127.0.0.1", failure: "SITE_UNAVAILABLE" });
      expect((await loadApplication(first.id)).events.some((e) => e.message.startsWith("Holding off 127.0.0.1"))).toBe(true);

      // The processor sees the cooldown and pushes the second application past it without claiming it.
      const queue = createApplicationQueue(redis);
      const process = createProcessor({ engine: withHealth, queue, config, workerId, active: new Map(), siteHealth: health });
      const result = await process({ data: { applicationId: second.id, userId: user.id } } as Parameters<typeof process>[0]);
      expect(result).toEqual({ claimed: false, reason: "site_cooldown" });
      const held = await loadApplication(second.id);
      expect(held.status).toBe("QUEUED");
      expect(held.attemptCount).toBe(0);
      expect(held.attempts).toHaveLength(0);
      expect(Math.abs(held.nextAttemptAt!.getTime() - Date.parse(cooldown!.until))).toBeLessThan(1000);
      expect(held.events.at(-1)?.message).toContain("doesn't use up an attempt");
      // Asking again doesn't add another timeline entry.
      await process({ data: { applicationId: second.id, userId: user.id } } as Parameters<typeof process>[0]);
      expect((await loadApplication(second.id)).events.filter((e) => e.type === "RETRY_SCHEDULED")).toHaveLength(1);
      await queue.close();

      // A normal answer from the site clears the cooldown.
      await health.recordSuccess("127.0.0.1");
      expect(await health.cooldown("127.0.0.1")).toBeNull();
    } finally {
      await guardedBrowsers.close();
    }
  });

  it("opens at once on a rate limit and keeps the site's requested wait", async ({ skip }) => {
    if (!redis) return skip();
    const health = new SiteHealth(redis);
    const now = Date.now();
    const cooldown = await health.recordFailure("jobs.example.com", "RATE_LIMITED", 3_600_000, now);
    expect(cooldown?.until).toBe(new Date(now + 3_600_000).toISOString());
    expect(await health.recordFailure("jobs.example.com", "CAPTCHA")).toBeNull();
    expect(await health.cooldown("jobs.example.com", now + 3_600_001)).toBeNull();
  });
});
