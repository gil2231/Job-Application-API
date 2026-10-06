import "server-only";
import Redis from "ioredis";
import { WORKER_HEARTBEAT_KEY, type WorkerHeartbeat } from "@autoapply/shared";

let client: Redis | null = null;

function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  client ??= new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1000, enableOfflineQueue: false });
  return client;
}

export type WorkerStatus = { state: "online"; heartbeat: WorkerHeartbeat } | { state: "offline" } | { state: "unreachable" };

/** Whether a worker process is currently running, from its Redis heartbeat. */
export async function getWorkerStatus(): Promise<WorkerStatus> {
  const redis = getRedis();
  if (!redis) return { state: "unreachable" };
  try {
    if (redis.status === "wait") await redis.connect();
    const raw = await redis.get(WORKER_HEARTBEAT_KEY);
    if (!raw) return { state: "offline" };
    return { state: "online", heartbeat: JSON.parse(raw) as WorkerHeartbeat };
  } catch {
    return { state: "unreachable" };
  }
}
