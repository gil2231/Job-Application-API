import { hostname } from "node:os";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Worker } from "bullmq";
import { createDefaultRegistry } from "@autoapply/ats-adapters";
import { prisma } from "@autoapply/database";
import { getStorage } from "@autoapply/documents";
import { createEmailSender } from "@autoapply/notifications";
import { captureException, flushErrorReports, initErrorReporting, installProcessHandlers } from "@autoapply/ops";
import { createApplicationQueue, createRedis, parseControlMessage, type ApplicationJobData } from "@autoapply/queue";
import { CONTROL_CHANNEL, QUEUE_NAMES } from "@autoapply/shared";
import { BrowserPool } from "./browser";
import { loadConfig } from "./config";
import { ABORT_REASONS, ApplicationEngine } from "./engine";
import { startHeartbeat } from "./heartbeat";
import { Notifier } from "./notifier";
import { startMaintenance } from "./maintenance";
import { createProcessor, type ActiveRun } from "./processor";
import { Scheduler } from "./scheduler";
import { MailSyncLoop } from "./mail-sync";

/**
 * AutoApply browser worker: claims queued applications, fills them with
 * Playwright through the adapter registry, and pauses for a person whenever a
 * CAPTCHA, sign-in or uncertain answer comes up. It also sends the email
 * alerts (see notifier.ts).
 */
const rootEnv = resolve(import.meta.dirname, "../../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

initErrorReporting("worker");
installProcessHandlers();

const config = loadConfig();
const workerId = `${hostname()}:${process.pid}`;

const registry = createDefaultRegistry();
const browsers = new BrowserPool(config);
const connection = createRedis(config.redisUrl);
const publisher = createRedis(config.redisUrl);
const subscriber = createRedis(config.redisUrl);
const queue = createApplicationQueue(connection);
const active = new Map<string, ActiveRun>();
const engine = new ApplicationEngine({ config, browsers, registry, storage: getStorage(), redis: publisher, workerId });
const scheduler = new Scheduler(queue, config.schedulerIntervalMs);
const mailSync = new MailSyncLoop(config.mailSyncIntervalMs);
const emailSender = createEmailSender();
const notifier = config.notificationsEnabled ? new Notifier(emailSender, config.notifierIntervalMs) : null;

const worker = new Worker<ApplicationJobData>(QUEUE_NAMES.applications, createProcessor({ engine, queue, config, workerId, active, onSettled: () => void scheduler.wake() }), {
  connection: createRedis(config.redisUrl),
  concurrency: config.concurrency,
  // Our own lease handles crashed workers; BullMQ's stalled check is a second net.
  lockDuration: 60_000,
});
// Applications that fail on an employer's site are recorded on the application; this is the processor itself crashing.
worker.on("failed", (job, error) => {
  console.error(`[worker] job ${job?.id} errored`, error);
  captureException(error, { tags: { queue: QUEUE_NAMES.applications }, extra: { applicationId: job?.data.applicationId }, userId: job?.data.userId });
});
worker.on("error", (error) => captureException(error, { tags: { queue: QUEUE_NAMES.applications, kind: "worker-error" } }));

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
mailSync.start();
notifier?.start();
if (notifier && !emailSender.configured) console.warn("[worker] email alerts are recorded but not sent: no email provider is set up (EMAIL_PROVIDER)");
const maintenance = await startMaintenance(config.redisUrl).catch((error: unknown) => {
  console.error("[worker] could not start backups", error);
  captureException(error, { tags: { component: "maintenance" } });
  return null;
});
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
  await mailSync.stop().catch(() => undefined);
  await notifier?.stop().catch(() => undefined);
  for (const run of active.values()) run.controller.abort(ABORT_REASONS.shutdown);
  await worker.close().catch(() => undefined);
  await maintenance?.close();
  await heartbeat.stop().catch(() => undefined);
  await browsers.close();
  await queue.close().catch(() => undefined);
  for (const r of [connection, publisher, subscriber]) r.disconnect();
  await prisma.$disconnect();
  await flushErrorReports(2000);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
