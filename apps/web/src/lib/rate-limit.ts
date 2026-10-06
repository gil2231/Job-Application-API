import "server-only";
import { createHash } from "node:crypto";
import { createLogger } from "@autoapply/shared";
import { getRedis } from "./redis";

const log = createLogger("rate-limit");

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();
let lastSweep = Date.now();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Fixed-window limiter in process memory: the fallback when Redis is unavailable. */
export function rateLimitInMemory(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    for (const [k, w] of buckets) if (w.resetAt <= now) buckets.delete(k);
    lastSweep = now;
  }
  let window = buckets.get(key);
  if (!window || window.resetAt <= now) {
    window = { count: 0, resetAt: now + windowMs };
    buckets.set(key, window);
  }
  window.count += 1;
  return {
    allowed: window.count <= limit,
    remaining: Math.max(0, limit - window.count),
    retryAfterSeconds: Math.ceil((window.resetAt - now) / 1000),
  };
}

/** Keys can hold an email address; Redis only ever sees a hash of them. */
const redisKey = (key: string) => `autoapply:ratelimit:${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;

/**
 * Fixed-window rate limiter shared by every web instance through Redis, so
 * limits hold behind a load balancer and across restarts. Falls back to the
 * in-memory limiter if Redis isn't configured or doesn't answer.
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const redis = await getRedis();
  if (redis) {
    try {
      const k = redisKey(key);
      const result = await redis.multi().set(k, 0, "PX", windowMs, "NX").incr(k).pttl(k).exec();
      const count = Number(result?.[1]?.[1]);
      const ttl = Number(result?.[2]?.[1]);
      if (Number.isFinite(count)) {
        return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterSeconds: Math.max(1, Math.ceil((ttl > 0 ? ttl : windowMs) / 1000)) };
      }
    } catch (error) {
      log.warn("Redis rate limit failed; using this instance's memory", { error });
    }
  }
  return rateLimitInMemory(key, limit, windowMs);
}

// Local development and end-to-end runs create many accounts from one IP.
const relaxed = process.env.NODE_ENV !== "production";

export const LIMITS = {
  signIn: { limit: relaxed ? 200 : 10, windowMs: 15 * 60_000 },
  signUp: { limit: relaxed ? 500 : 5, windowMs: 60 * 60_000 },
  upload: { limit: 30, windowMs: 60 * 60_000 },
  /** Imports and posting lookups fetch other sites, so they're limited separately. */
  jobImport: { limit: relaxed ? 500 : 30, windowMs: 60 * 60_000 },
  postingLookup: { limit: relaxed ? 500 : 60, windowMs: 60 * 60_000 },
  /** Each search reads up to 25 job boards. */
  boardSearch: { limit: relaxed ? 500 : 30, windowMs: 60 * 60_000 },
  /** Tailored resumes and cover letters may call the AI provider. */
  generate: { limit: relaxed ? 500 : 40, windowMs: 60 * 60_000 },
  mutation: { limit: 120, windowMs: 60_000 },
} as const;
