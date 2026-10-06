import { hostname } from "node:os";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Worker } from "bullmq";
import type { Page } from "playwright-core";
import { AdapterRegistry, GenericWebFormAdapter } from "@autoapply/ats-adapters";
import { prisma } from "@autoapply/database";
import { getStorage } from "@autoapply/documents";
import { createApplicationQueue, createRedis, parseControlMessage, type ApplicationJobData } from "@autoapply/queue";
import { CONTROL_CHANNEL, QUEUE_NAMES } from "@autoapply/shared";
import { BrowserPool } from "./browser";
import { loadConfig } from "./config";
import { ABORT_REASONS, ApplicationEngine } from "./engine";
import { startHeartbeat } from "./heartbeat";
import { createProcessor, type ActiveRun } from "./processor";
import { Scheduler } from "./scheduler";

/**
 * AutoApply browser worker: claims queued applications, fills them with
 * Playwright through the adapter registry, and pauses for a person whenever a
 * CAPTCHA, sign-in or uncertain answer comes up.
 */
const rootEnv = resolve(import.meta.dirname, "../../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config = loadConfig();
const workerId = `${hostname()}:${process.pid}`;

const registry = new AdapterRegistry<Page>().register(new GenericWebFormAdapter());
const browsers = new BrowserPool(config);
const connection = createRedis(config.redisUrl);
const publisher = createRedis(config.redisUrl);
const subscriber = createRedis(config.redisUrl);
const queue = createApplicationQueue(connection);
const active = new Map<string, ActiveRun>();
const engine = new ApplicationEngine({ config, browsers, registry, storage: getStorage(), redis: publisher, workerId });
const scheduler = new Scheduler(queue, config.schedulerIntervalMs);

const worker = new Worker<ApplicationJobData>(QUEUE_NAMES.applications, createProcessor({ engine, queue, config, workerId, active, onSettled: () => void scheduler.wake() }), {
  connection: createRedis(config.redisUrl),
  concurrency: config.concurrency,
  // Our own lease handles crashed workers; BullMQ's stalled check is a second net.
  lockDuration: 60_000,
});
worker.on("failed", (job, error) => console.error(`[worker] job ${job?.id} errored`, error));

await subscriber.subscribe(CONTROL_CHANNEL);
subscriber.on("message", (_channel, raw) => {
  const message = parseControlMessage(raw);
  if (!message) return;
  if (message.type === "stop") {
    for (const run of active.values()) if (run.userId === message.userId) run.controller.abort(ABORT_REASONS.stop);
  } else {
    void scheduler.wake();
  }
});

const heartbeat = startHeartbeat(publisher, { adapters: () => registry.list().map((a) => a.platform), activeJobs: () => active.size, interactive: () => browsers.interactive });
scheduler.start();
console.warn(
  `[worker] ${workerId} running: concurrency ${config.concurrency}, ${config.headless ? "headless" : "visible"} browser, ` +
    (config.allowAllHosts ? "all public sites allowed" : `sites limited to ${config.allowedHosts.join(", ")}`),
);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.warn(`[worker] ${signal} received; returning running applications to the queue`);
  scheduler.stop();
  for (const run of active.values()) run.controller.abort(ABORT_REASONS.shutdown);
  await worker.close().catch(() => undefined);
  await heartbeat.stop().catch(() => undefined);
  await browsers.close();
  await queue.close().catch(() => undefined);
  for (const r of [connection, publisher, subscriber]) r.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
