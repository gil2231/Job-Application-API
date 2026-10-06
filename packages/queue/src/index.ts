import { Queue, type ConnectionOptions } from "bullmq";
import Redis, { type RedisOptions } from "ioredis";
import { CONTROL_CHANNEL, QUEUE_NAMES, type ControlMessage } from "@autoapply/shared";

/**
 * The BullMQ side of the application queue.
 *
 * Postgres is the source of truth for application state (Application.status);
 * a BullMQ job is only a signal that an application may be ready to run. The
 * worker claims the application atomically in Postgres before doing anything,
 * so a duplicate or stale queue entry is harmless, and the worker's scheduler
 * re-adds anything Redis lost.
 */
export interface ApplicationJobData {
  applicationId: string;
  userId: string;
}

export interface EnqueueItem extends ApplicationJobData {
  /** Wait this long before the job becomes runnable (retry backoff). */
  delayMs?: number;
  /** Lower runs first (BullMQ priority). */
  priority?: number;
}

export function createRedis(url: string, options: RedisOptions = {}): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, ...options });
}

export function createApplicationQueue(connection: ConnectionOptions): Queue<ApplicationJobData> {
  return new Queue<ApplicationJobData>(QUEUE_NAMES.applications, {
    connection,
    defaultJobOptions: { removeOnComplete: true, removeOnFail: true, attempts: 1 },
  });
}

/** Add applications to the queue. The job id is the application id, so re-adding a waiting job is a no-op. */
export async function addApplicationJobs(queue: Queue<ApplicationJobData>, items: EnqueueItem[]): Promise<void> {
  if (!items.length) return;
  await queue.addBulk(
    items.map((item) => ({
      name: "process-application",
      data: { applicationId: item.applicationId, userId: item.userId },
      opts: {
        jobId: item.applicationId,
        delay: item.delayMs && item.delayMs > 0 ? item.delayMs : undefined,
        priority: item.priority && item.priority > 0 ? Math.min(item.priority, 2_000_000) : undefined,
      },
    })),
  );
}

// ─── Producer used by the web app ───────────────────────────────────────────

let producerRedis: Redis | null = null;
let producerQueue: Queue<ApplicationJobData> | null = null;

function producer(): { redis: Redis; queue: Queue<ApplicationJobData> } | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  producerRedis ??= createRedis(url, { lazyConnect: false, connectTimeout: 2000, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  producerQueue ??= createApplicationQueue(producerRedis);
  return { redis: producerRedis, queue: producerQueue };
}

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Redis timeout")), ms))]);

/**
 * Best-effort enqueue from the web app. If Redis is down the applications stay
 * QUEUED in Postgres and the worker's scheduler picks them up on its next sweep,
 * so a failure here never loses work.
 */
export async function enqueueApplications(items: EnqueueItem[]): Promise<boolean> {
  const p = producer();
  if (!p || !items.length) return false;
  try {
    await withTimeout(addApplicationJobs(p.queue, items), 3000);
    return true;
  } catch (error) {
    console.warn("[queue] enqueue failed; the worker scheduler will pick these up", error instanceof Error ? error.message : error);
    return false;
  }
}

/** Tell running workers to stop or re-check a user's queue. Best effort, like enqueueApplications. */
export async function publishControl(message: ControlMessage): Promise<boolean> {
  const p = producer();
  if (!p) return false;
  try {
    await withTimeout(p.redis.publish(CONTROL_CHANNEL, JSON.stringify(message)), 3000);
    return true;
  } catch (error) {
    console.warn("[queue] control message failed", error instanceof Error ? error.message : error);
    return false;
  }
}

export function parseControlMessage(raw: string): ControlMessage | null {
  try {
    const value = JSON.parse(raw) as Partial<ControlMessage>;
    if ((value.type === "stop" || value.type === "wake") && typeof value.userId === "string") return value as ControlMessage;
  } catch {
    /* ignore malformed messages */
  }
  return null;
}
