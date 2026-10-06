import { describe, expect, it, vi } from "vitest";
import { rateLimit, rateLimitInMemory } from "./rate-limit";

describe("rateLimitInMemory", () => {
  it("allows up to the limit and blocks after it", () => {
    const key = `test-${Math.random()}`;
    expect(rateLimitInMemory(key, 2, 60_000)).toMatchObject({ allowed: true, remaining: 1 });
    expect(rateLimitInMemory(key, 2, 60_000)).toMatchObject({ allowed: true, remaining: 0 });
    const blocked = rateLimitInMemory(key, 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets once the window has passed", () => {
    vi.useFakeTimers();
    const key = `test-${Math.random()}`;
    rateLimitInMemory(key, 1, 1_000);
    expect(rateLimitInMemory(key, 1, 1_000).allowed).toBe(false);
    vi.advanceTimersByTime(1_001);
    expect(rateLimitInMemory(key, 1, 1_000).allowed).toBe(true);
    vi.useRealTimers();
  });
});

describe("rateLimit", () => {
  it("shares one window through Redis, and falls back to memory without it", async () => {
    const key = `test-${Math.random()}`;
    expect(await rateLimit(key, 1, 60_000)).toMatchObject({ allowed: true, remaining: 0 });
    const blocked = await rateLimit(key, 1, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });
});
