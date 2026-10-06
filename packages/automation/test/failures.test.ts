import { describe, expect, it } from "vitest";
import { AutomationError, classifyFailure, decideRetry } from "../src/failures";
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
});

describe("decideRetry", () => {
  const noJitter = () => 0.5;
  it("backs off exponentially for transient failures", () => {
    expect(decideRetry("TIMEOUT", 1, undefined, noJitter)).toEqual({ action: "retry", delayMs: 30_000 });
    expect(decideRetry("TIMEOUT", 3, undefined, noJitter)).toEqual({ action: "retry", delayMs: 120_000 });
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
