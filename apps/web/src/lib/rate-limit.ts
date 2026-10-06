import "server-only";

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

/**
 * Fixed-window rate limiter kept in process memory. This is enough for a
 * single web instance; the hardening phase swaps it for a Redis-backed one
 * behind the same function signature.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
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

// Local development and end-to-end runs create many accounts from one IP.
const relaxed = process.env.NODE_ENV !== "production";

export const LIMITS = {
  signIn: { limit: relaxed ? 200 : 10, windowMs: 15 * 60_000 },
  signUp: { limit: relaxed ? 500 : 5, windowMs: 60 * 60_000 },
  upload: { limit: 30, windowMs: 60 * 60_000 },
  /** Imports and posting lookups fetch other sites, so they're limited separately. */
  jobImport: { limit: relaxed ? 500 : 30, windowMs: 60 * 60_000 },
  postingLookup: { limit: relaxed ? 500 : 60, windowMs: 60 * 60_000 },
  mutation: { limit: 120, windowMs: 60_000 },
} as const;
