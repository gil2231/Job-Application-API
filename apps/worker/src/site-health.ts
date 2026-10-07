import type Redis from "ioredis";
import { parseCooldown, SITE_COOLDOWN_KEY, type FailureType, type SiteCooldown } from "@autoapply/shared";

/**
 * A circuit breaker per employer site. When a site is down or asks us to slow
 * down, every queued application to it would fail the same way, so the worker
 * holds off that site for a while instead of hammering it and burning each
 * application's retries. Shared through Redis so every worker process (and the
 * automation health page) sees the same cooldowns. Best effort: without Redis
 * nothing is held back and the per-application retries still apply.
 */

export interface SiteHealthOptions {
  /** Failures within the window that open the breaker. Rate limiting opens it at once. */
  threshold: Partial<Record<FailureType, number>>;
  windowMs: number;
  cooldownMs: number;
}

export const DEFAULT_SITE_HEALTH: SiteHealthOptions = {
  threshold: { RATE_LIMITED: 1, SITE_UNAVAILABLE: 2, NETWORK_ERROR: 3, TIMEOUT: 3 },
  windowMs: 10 * 60_000,
  cooldownMs: 10 * 60_000,
};

const failuresKey = (host: string) => `autoapply:site-failures:${host}`;

export class SiteHealth {
  constructor(
    private readonly redis: Redis | null,
    private readonly options: SiteHealthOptions = DEFAULT_SITE_HEALTH,
  ) {}

  /** The cooldown in force for a host, if any. */
  async cooldown(host: string, now: number = Date.now()): Promise<SiteCooldown | null> {
    if (!this.redis || !host) return null;
    try {
      const raw = await this.redis.hget(SITE_COOLDOWN_KEY, host);
      const cooldown = parseCooldown(raw);
      if (!cooldown) return null;
      if (Date.parse(cooldown.until) <= now) {
        await this.redis.hdel(SITE_COOLDOWN_KEY, host);
        return null;
      }
      return cooldown;
    } catch {
      return null;
    }
  }

  /** Count a failure against the site; returns the cooldown it opened, if it opened one. */
  async recordFailure(host: string, failure: FailureType, retryAfterMs?: number, now: number = Date.now()): Promise<SiteCooldown | null> {
    const threshold = this.options.threshold[failure];
    if (!this.redis || !host || !threshold) return null;
    try {
      const key = `${failuresKey(host)}:${failure}`;
      const [[, count]] = (await this.redis.multi().incr(key).pexpire(key, this.options.windowMs).exec()) as [[unknown, number], unknown];
      if (count < threshold) return null;
      const cooldown: SiteCooldown = {
        host,
        until: new Date(now + Math.max(this.options.cooldownMs, retryAfterMs ?? 0)).toISOString(),
        failure,
        reason: failure === "RATE_LIMITED" ? "the site asked us to slow down" : `${count} ${count === 1 ? "failure" : "failures"} in a row reaching it`,
      };
      await this.redis.multi().hset(SITE_COOLDOWN_KEY, host, JSON.stringify(cooldown)).del(key).exec();
      return cooldown;
    } catch {
      return null;
    }
  }

  /** The site answered normally: forget its recent failures and any cooldown. */
  async recordSuccess(host: string): Promise<void> {
    if (!this.redis || !host) return;
    try {
      const keys = Object.keys(this.options.threshold).map((f) => `${failuresKey(host)}:${f}`);
      await this.redis.multi().del(...keys).hdel(SITE_COOLDOWN_KEY, host).exec();
    } catch {
      /* best effort */
    }
  }
}
