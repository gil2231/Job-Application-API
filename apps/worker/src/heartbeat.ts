import { hostname } from "node:os";
import type Redis from "ioredis";
import { WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_TTL_SECONDS, type WorkerHeartbeat } from "@autoapply/shared";

/**
 * Publishes a short-lived heartbeat so the dashboard can show whether a
 * worker is running. If the process dies, the key expires on its own.
 */
export function startHeartbeat(redis: Redis, state: { adapters: () => string[]; activeJobs: () => number; interactive?: () => boolean }, intervalMs = 10_000) {
  const workerId = `${hostname()}:${process.pid}`;
  const startedAt = new Date().toISOString();
  const beat = async () => {
    const payload: WorkerHeartbeat = {
      workerId,
      startedAt,
      updatedAt: new Date().toISOString(),
      adapters: state.adapters(),
      activeJobs: state.activeJobs(),
      interactive: state.interactive?.() ?? false,
    };
    await redis.set(WORKER_HEARTBEAT_KEY, JSON.stringify(payload), "EX", WORKER_HEARTBEAT_TTL_SECONDS);
  };
  void beat();
  const timer = setInterval(() => void beat().catch(() => undefined), intervalMs);
  return {
    workerId,
    async stop() {
      clearInterval(timer);
      const current = await redis.get(WORKER_HEARTBEAT_KEY);
      if (current && (JSON.parse(current) as WorkerHeartbeat).workerId === workerId) await redis.del(WORKER_HEARTBEAT_KEY);
    },
  };
}
