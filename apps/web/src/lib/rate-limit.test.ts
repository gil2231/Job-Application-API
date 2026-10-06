import { describe, expect, it, vi } from "vitest";
import { rateLimit } from "./rate-limit";

describe("rateLimit", () => {
  it("allows up to the limit and blocks after it", () => {
    const key = `test-${Math.random()}`;
    expect(rateLimit(key, 2, 60_000)).toMatchObject({ allowed: true, remaining: 1 });
    expect(rateLimit(key, 2, 60_000)).toMatchObject({ allowed: true, remaining: 0 });
    const blocked = rateLimit(key, 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets once the window has passed", () => {
    vi.useFakeTimers();
    const key = `test-${Math.random()}`;
    rateLimit(key, 1, 1_000);
    expect(rateLimit(key, 1, 1_000).allowed).toBe(false);
    vi.advanceTimersByTime(1_001);
    expect(rateLimit(key, 1, 1_000).allowed).toBe(true);
    vi.useRealTimers();
  });
});
