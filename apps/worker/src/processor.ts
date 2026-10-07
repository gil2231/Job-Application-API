import type { Job, Queue } from "bullmq";
import { claimApplication, deferApplication, getApplicationTarget, renewLease, settlePauseAfterCurrent } from "@autoapply/database";
import { addApplicationJobs, type ApplicationJobData } from "@autoapply/queue";
import { createLogger } from "@autoapply/shared";
import type { WorkerConfig } from "./config";
import { ABORT_REASONS, type ApplicationEngine } from "./engine";
import type { SiteHealth } from "./site-health";

const log = createLogger("processor");

export interface ActiveRun {
  userId: string;
  controller: AbortController;
}

/**
 * The BullMQ job handler. A job only says "this application may be ready";
 * the claim in Postgres decides whether this worker actually runs it (queue
 * paused, user at their concurrency or daily limit, already taken, not due).
 */
export function createProcessor(deps: {
  engine: ApplicationEngine;
  queue: Queue<ApplicationJobData>;
  config: WorkerConfig;
  workerId: string;
  active: Map<string, ActiveRun>;
  siteHealth?: SiteHealth;
  onSettled?: (userId: string) => void;
}) {
  const { engine, queue, config, workerId, active } = deps;
  return async (job: Job<ApplicationJobData>) => {
    const { applicationId } = job.data;
    const held = await holdForSiteCooldown(applicationId, deps.siteHealth);
    if (held) return { claimed: false, reason: "site_cooldown" };
    const claim = await claimApplication(applicationId, workerId, config.leaseMs);
    if (!claim.claimed) {
      log.debug("Not claimed", { applicationId, reason: claim.reason });
      return { claimed: false, reason: claim.reason };
    }
    const runLog = log.child({ applicationId, attempt: claim.attemptNumber, workerId });
    const startedAt = Date.now();
    runLog.info("Attempt started");

    const controller = new AbortController();
    active.set(applicationId, { userId: claim.userId, controller });
    const lease = setInterval(() => {
      void renewLease(applicationId, workerId, config.leaseMs)
        .then((held) => {
          if (!held && active.has(applicationId)) controller.abort(ABORT_REASONS.leaseLost);
        })
        .catch(() => undefined);
    }, Math.max(1000, Math.floor(config.leaseMs / 3)));

    try {
      const outcome = await engine.run({ applicationId, attemptId: claim.attemptId, attemptNumber: claim.attemptNumber, userId: claim.userId, signal: controller.signal });
      if (outcome.retryInMs) await addApplicationJobs(queue, [{ applicationId, userId: claim.userId, delayMs: outcome.retryInMs }]).catch(() => undefined);
      runLog.info("Attempt ended", { result: outcome.result, retryInMs: outcome.retryInMs, durationMs: Date.now() - startedAt });
      return { claimed: true, ...outcome };
    } catch (error) {
      runLog.error("Attempt crashed", { error, durationMs: Date.now() - startedAt });
      throw error;
    } finally {
      clearInterval(lease);
      active.delete(applicationId);
      await settlePauseAfterCurrent(claim.userId).catch(() => undefined);
      deps.onSettled?.(claim.userId);
    }
  };
}

/** A site in cooldown: push the application's next run past it without using an attempt. */
async function holdForSiteCooldown(applicationId: string, siteHealth: SiteHealth | undefined): Promise<boolean> {
  if (!siteHealth) return false;
  const target = await getApplicationTarget(applicationId);
  if (!target || target.status !== "QUEUED" || !target.host) return false;
  const cooldown = await siteHealth.cooldown(target.host);
  if (!cooldown) return false;
  const minutes = Math.max(1, Math.ceil((Date.parse(cooldown.until) - Date.now()) / 60_000));
  await deferApplication(applicationId, new Date(cooldown.until), `Waiting about ${minutes} min before trying ${cooldown.host} again (${cooldown.reason}). This doesn't use up an attempt.`);
  return true;
}
