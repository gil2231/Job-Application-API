import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Worker } from "bullmq";
import { prisma, setQueueState } from "@autoapply/database";
import { createApplicationQueue, createRedis, type ApplicationJobData } from "@autoapply/queue";
import { QUEUE_NAMES } from "@autoapply/shared";
import { startMockSite, type MockSite } from "../mock-site/server";
import { createProcessor, type ActiveRun } from "../src/processor";
import { Scheduler } from "../src/scheduler";
import { makeApplicant, makeEngine, queueFor, resetDatabase } from "./helpers";

/**
 * The whole queue path with real Redis and BullMQ: the scheduler hands due
 * applications to BullMQ, the worker claims and runs them, and pause / resume /
 * concurrency limits hold. Skipped when Redis isn't running.
 */
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
let redisUp = true;
let site: MockSite;
const { engine, browsers, config, workerId } = makeEngine();
const queueName = `${QUEUE_NAMES.applications}`;

beforeAll(async () => {
  const probe = createRedis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await probe.connect();
    await probe.flushdb();
  } catch {
    redisUp = false;
  } finally {
    probe.disconnect();
  }
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

async function waitFor(check: () => Promise<boolean>, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Timed out waiting for condition");
}

function startWorker() {
  const connection = createRedis(redisUrl);
  const queue = createApplicationQueue(connection);
  const active = new Map<string, ActiveRun>();
  const scheduler = new Scheduler(queue, 300);
  const worker = new Worker<ApplicationJobData>(queueName, createProcessor({ engine, queue, config, workerId, active, onSettled: () => void scheduler.wake() }), { connection: createRedis(redisUrl), concurrency: 3 });
  scheduler.start();
  return {
    scheduler,
    active,
    async stop() {
      scheduler.stop();
      await worker.close();
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
      connection.disconnect();
    },
  };
}

describe("queue", () => {
  it("processes queued applications end to end, respecting pause and resume", async (t) => {
    if (!redisUp) return t.skip();
    const user = await makeApplicant();
    await setQueueState(user.id, "pause");
    const a = await queueFor(user.id, `${site.url}/simple`);
    const b = await queueFor(user.id, `${site.url}/dropdowns`);
    const w = startWorker();
    try {
      await new Promise((r) => setTimeout(r, 1500));
      // Paused: nothing starts.
      expect((await prisma.application.findMany({ where: { userId: user.id } })).every((x) => x.status === "QUEUED")).toBe(true);

      await setQueueState(user.id, "resume");
      await w.scheduler.wake();
      await waitFor(async () => (await prisma.application.count({ where: { userId: user.id, status: "SUBMITTED" } })) === 2);
      expect(site.submissions.map((s) => s.form).sort()).toEqual(["dropdowns", "simple"]);
      expect((await prisma.application.findUniqueOrThrow({ where: { id: a.id } })).lockedBy).toBeNull();
      expect((await prisma.application.findUniqueOrThrow({ where: { id: b.id } })).attemptCount).toBe(1);
    } finally {
      await w.stop();
    }
  });

  it("runs one application at a time when the user's limit is one, and pauses after the current one when asked", async (t) => {
    if (!redisUp) return t.skip();
    const user = await makeApplicant();
    await prisma.automationRule.update({ where: { userId: user.id }, data: { maxConcurrentApplications: 1 } });
    const apps = [await queueFor(user.id, `${site.url}/multi-page`), await queueFor(user.id, `${site.url}/simple`), await queueFor(user.id, `${site.url}/dropdowns`)];
    const w = startWorker();
    let maxSeen = 0;
    const sampler = setInterval(async () => {
      const n = await prisma.application.count({ where: { userId: user.id, status: "PROCESSING" } });
      maxSeen = Math.max(maxSeen, n);
    }, 50);
    try {
      await waitFor(async () => (await prisma.application.count({ where: { userId: user.id, status: "PROCESSING" } })) === 1);
      await setQueueState(user.id, "pause_after_current");
      await waitFor(async () => (await prisma.userSetting.findUniqueOrThrow({ where: { userId: user.id } })).queuePaused);
      const statuses = await prisma.application.findMany({ where: { id: { in: apps.map((x) => x.id) } }, select: { status: true } });
      expect(statuses.filter((s) => s.status === "SUBMITTED")).toHaveLength(1);
      expect(statuses.filter((s) => s.status === "QUEUED")).toHaveLength(2);
      expect(maxSeen).toBe(1);
    } finally {
      clearInterval(sampler);
      await w.stop();
    }
  });
});
