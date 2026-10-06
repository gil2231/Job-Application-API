import { describe, expect, it } from "vitest";
import { AutomationError, classifyFailure, decideRetry, failureForHttpStatus, parseRetryAfter } from "../src/failures";
import { orderLocators, requiresReview } from "../src/fields";

describe("classifyFailure", () => {
  it("classifies common Playwright and network errors", () => {
    const timeout = new Error("locator.click: Timeout 30000ms exceeded");
    expect(classifyFailure(timeout)).toBe("TIMEOUT");
    expect(classifyFailure(new Error("page.goto: net::ERR_CONNECTION_RESET"))).toBe("NETWORK_ERROR");
    expect(classifyFailure(new Error("strict mode violation: getByLabel('Email') resolved to 2 elements"))).toBe("SELECTOR_ERROR");
    expect(classifyFailure(new AutomationError("CAPTCHA", "hCaptcha iframe present"))).toBe("CAPTCHA");
    expect(classifyFailure("weird")).toBe("UNKNOWN_ERROR");
  });
  it("recognizes crashed browsers, rate limits and outages", () => {
    expect(classifyFailure(new Error("page.fill: Target page, context or browser has been closed"))).toBe("BROWSER_CRASHED");
    expect(classifyFailure(new Error("Request failed: 429 Too Many Requests"))).toBe("RATE_LIMITED");
    expect(classifyFailure(new Error("503 Service Unavailable"))).toBe("SITE_UNAVAILABLE");
  });
});

describe("failureForHttpStatus", () => {
  it("turns blocking page statuses into failures and leaves others alone", () => {
    const limited = failureForHttpStatus(429, "120");
    expect(limited?.type).toBe("RATE_LIMITED");
    expect(limited?.retryAfterMs).toBe(120_000);
    expect(failureForHttpStatus(404)?.type).toBe("POSTING_CLOSED");
    expect(failureForHttpStatus(410)?.type).toBe("POSTING_CLOSED");
    expect(failureForHttpStatus(503)?.type).toBe("SITE_UNAVAILABLE");
    expect(failureForHttpStatus(200)).toBeNull();
    expect(failureForHttpStatus(403)).toBeNull();
  });
  it("reads Retry-After as seconds or a date, ignoring nonsense", () => {
    const now = Date.parse("2026-10-06T12:00:00Z");
    expect(parseRetryAfter("30", now)).toBe(30_000);
    expect(parseRetryAfter("Tue, 06 Oct 2026 12:05:00 GMT", now)).toBe(300_000);
    expect(parseRetryAfter("soon", now)).toBeUndefined();
    expect(parseRetryAfter("999999", now)).toBe(6 * 3600_000);
  });
});

describe("decideRetry", () => {
  const noJitter = () => 0.5;
  it("backs off exponentially for transient failures", () => {
    expect(decideRetry("TIMEOUT", 1, { random: noJitter })).toEqual({ action: "retry", delayMs: 30_000 });
    expect(decideRetry("TIMEOUT", 3, { random: noJitter })).toEqual({ action: "retry", delayMs: 120_000 });
  });
  it("gives outages and rate limits longer to recover, and honors Retry-After", () => {
    expect(decideRetry("SITE_UNAVAILABLE", 1, { random: noJitter })).toEqual({ action: "retry", delayMs: 120_000 });
    expect(decideRetry("RATE_LIMITED", 1, { random: noJitter })).toEqual({ action: "retry", delayMs: 600_000 });
    expect(decideRetry("RATE_LIMITED", 1, { random: noJitter, retryAfterMs: 3_600_000 })).toEqual({ action: "retry", delayMs: 3_600_000 });
    expect(decideRetry("SITE_UNAVAILABLE", 4, { random: noJitter }).action).toBe("retry");
    expect(decideRetry("SITE_UNAVAILABLE", 5)).toEqual({ action: "needs_attention", reason: "REPEATED_FAILURE" });
  });
  it("retries an unexplained error once, then asks a person", () => {
    expect(decideRetry("UNKNOWN_ERROR", 1).action).toBe("retry");
    expect(decideRetry("UNKNOWN_ERROR", 2)).toEqual({ action: "needs_attention", reason: "REPEATED_FAILURE" });
  });
  it("fails a closed posting without retrying", () => {
    expect(decideRetry("POSTING_CLOSED", 1)).toEqual({ action: "fail" });
  });
  it("stops retrying after the attempt limit", () => {
    expect(decideRetry("NETWORK_ERROR", 4)).toEqual({ action: "needs_attention", reason: "REPEATED_FAILURE" });
  });
  it("never auto-retries human-only blockers", () => {
    expect(decideRetry("CAPTCHA", 1)).toEqual({ action: "needs_attention", reason: "CAPTCHA" });
    expect(decideRetry("AUTH_REQUIRED", 1)).toEqual({ action: "needs_attention", reason: "AUTH_REQUIRED" });
  });
});

describe("fields", () => {
  it("prefers accessible labels over DOM relationships", () => {
    const ordered = orderLocators([{ strategy: "dom", value: "x" }, { strategy: "id", value: "y" }, { strategy: "label", value: "Email" }]);
    expect(ordered.map((l) => l.strategy)).toEqual(["label", "id", "dom"]);
  });
  it("requires review below the threshold or for unknown/empty required fields", () => {
    const field = { label: "Phone", kind: "phone" as const, required: true, pageIndex: 0, locators: [] };
    const base = { field, detectedLabel: "Phone", mappedField: "masterProfile.phone" as const, value: "555", confidence: 90, source: "profile" as const };
    expect(requiresReview(base, 85)).toBe(false);
    expect(requiresReview({ ...base, confidence: 80 }, 85)).toBe(true);
    expect(requiresReview({ ...base, value: null }, 85)).toBe(true);
    expect(requiresReview({ ...base, mappedField: "unknown" }, 0)).toBe(true);
  });
});
