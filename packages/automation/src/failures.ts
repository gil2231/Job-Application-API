import type { AttentionReason, FailureType } from "@autoapply/shared";

/** Failures that may succeed if the same step is simply tried again later. */
const TRANSIENT: ReadonlySet<FailureType> = new Set(["NETWORK_ERROR", "TIMEOUT", "SELECTOR_ERROR"]);

/** Failures only a human can resolve. They are never retried automatically. */
const HUMAN_REQUIRED: Partial<Record<FailureType, AttentionReason>> = {
  CAPTCHA: "CAPTCHA",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  UNKNOWN_FIELD: "LOW_CONFIDENCE_MAPPING",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  SITE_CHANGED: "UNSUPPORTED_SITE",
};

export class AutomationError extends Error {
  constructor(
    public readonly type: FailureType,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AutomationError";
  }
}

/** Map an arbitrary thrown error to a failure type. */
export function classifyFailure(error: unknown): FailureType {
  if (error instanceof AutomationError) return error.type;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "TimeoutError" || /timeout|timed out/i.test(message)) return "TIMEOUT";
  if (/net::ERR_|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(message)) return "NETWORK_ERROR";
  if (/captcha|recaptcha|hcaptcha|turnstile/i.test(message)) return "CAPTCHA";
  if (/sign in|log in|login required|two-factor|verification code|mfa/i.test(message)) return "AUTH_REQUIRED";
  if (/strict mode violation|waiting for (locator|selector)|no element|not attached|not visible/i.test(message)) return "SELECTOR_ERROR";
  return "UNKNOWN_ERROR";
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 30_000, maxDelayMs: 30 * 60_000 };

export type RetryDecision =
  | { action: "retry"; delayMs: number }
  | { action: "needs_attention"; reason: AttentionReason }
  | { action: "fail" };

/**
 * Decide what happens after a failed attempt. Transient failures back off
 * exponentially (with jitter); human-only blockers go straight to Needs
 * Attention; anything that keeps failing ends in Needs Attention rather than
 * retrying forever.
 */
export function decideRetry(
  failure: FailureType,
  attemptNumber: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
): RetryDecision {
  const human = HUMAN_REQUIRED[failure];
  if (human) return { action: "needs_attention", reason: human };
  if (TRANSIENT.has(failure) || failure === "UNKNOWN_ERROR") {
    if (attemptNumber >= policy.maxAttempts) return { action: "needs_attention", reason: "REPEATED_FAILURE" };
    if (failure === "UNKNOWN_ERROR" && attemptNumber >= 2) return { action: "needs_attention", reason: "REPEATED_FAILURE" };
    const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attemptNumber - 1));
    const jitter = exponential * 0.2 * (random() * 2 - 1);
    return { action: "retry", delayMs: Math.round(exponential + jitter) };
  }
  return { action: "fail" };
}
