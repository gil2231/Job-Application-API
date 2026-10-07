import "server-only";
import Redis from "ioredis";

let client: Redis | null = null;

/**
 * The web app's shared Redis connection (worker heartbeat, site cooldowns,
 * rate limits). Null when REDIS_URL isn't set. Commands fail fast instead of
 * queueing while Redis is down, so callers can fall back.
 */
export async function getRedis(): Promise<Redis | null> {
  if (!process.env.REDIS_URL) return null;
  if (!client) {
    client = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1000, enableOfflineQueue: false });
    client.on("error", () => undefined);
  }
  if (client.status === "wait") await client.connect().catch(() => undefined);
  return client;
}
