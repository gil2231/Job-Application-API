import type { Job, Queue } from "bullmq";
import { claimApplication, renewLease, settlePauseAfterCurrent } from "@autoapply/database";
import { addApplicationJobs, type ApplicationJobData } from "@autoapply/queue";
import type { WorkerConfig } from "./config";
import { ABORT_REASONS, type ApplicationEngine } from "./engine";

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
  onSettled?: (userId: string) => void;
}) {
  const { engine, queue, config, workerId, active } = deps;
  return async (job: Job<ApplicationJobData>) => {
    const { applicationId } = job.data;
    const claim = await claimApplication(applicationId, workerId, config.leaseMs);
    if (!claim.claimed) return { claimed: false, reason: claim.reason };

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
      return { claimed: true, ...outcome };
    } finally {
      clearInterval(lease);
      active.delete(applicationId);
      await settlePauseAfterCurrent(claim.userId).catch(() => undefined);
      deps.onSettled?.(claim.userId);
    }
  };
}
