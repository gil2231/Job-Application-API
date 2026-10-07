import "server-only";
import { parseCooldown, SITE_COOLDOWN_KEY, WORKER_HEARTBEAT_KEY, type SiteCooldown, type WorkerHeartbeat } from "@autoapply/shared";
import { getRedis } from "./redis";

export type WorkerStatus = { state: "online"; heartbeat: WorkerHeartbeat } | { state: "offline" } | { state: "unreachable" };

/** Whether a worker process is currently running, from its Redis heartbeat. */
export async function getWorkerStatus(): Promise<WorkerStatus> {
  const redis = await getRedis();
  if (!redis) return { state: "unreachable" };
  try {
    const raw = await redis.get(WORKER_HEARTBEAT_KEY);
    if (!raw) return { state: "offline" };
    return { state: "online", heartbeat: JSON.parse(raw) as WorkerHeartbeat };
  } catch {
    return { state: "unreachable" };
  }
}

/** Employer sites the worker is holding off from after outages or rate limits. Empty if Redis can't be reached. */
export async function getSiteCooldowns(now: number = Date.now()): Promise<SiteCooldown[]> {
  const redis = await getRedis();
  if (!redis) return [];
  try {
    const all = await redis.hgetall(SITE_COOLDOWN_KEY);
    return Object.values(all)
      .map(parseCooldown)
      .filter((c): c is SiteCooldown => !!c && Date.parse(c.until) > now)
      .sort((a, b) => a.until.localeCompare(b.until));
  } catch {
    return [];
  }
}
