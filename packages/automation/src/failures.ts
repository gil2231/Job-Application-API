import type { AttentionReason, FailureType } from "@autoapply/shared";

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
    /** How long the site asked us to wait (an HTTP Retry-After header), if it said. */
    public readonly retryAfterMs?: number,
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
  // A browser that died mid-run says so in several ways; it's worth one more try on a fresh one.
  if (/target (page, context or browser )?(has been )?closed|browser has been closed|browser has disconnected|page crashed|context closed/i.test(message)) return "BROWSER_CRASHED";
  if (/\b429\b|too many requests|rate.?limit/i.test(message)) return "RATE_LIMITED";
  if (/\b(502|503|504)\b|service unavailable|bad gateway|temporarily unavailable|under maintenance/i.test(message)) return "SITE_UNAVAILABLE";
  if (name === "TimeoutError" || /timeout|timed out/i.test(message)) return "TIMEOUT";
  if (/net::ERR_|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(message)) return "NETWORK_ERROR";
  if (/captcha|recaptcha|hcaptcha|turnstile/i.test(message)) return "CAPTCHA";
  if (/sign in|log in|login required|two-factor|verification code|mfa/i.test(message)) return "AUTH_REQUIRED";
  if (/strict mode violation|waiting for (locator|selector)|no element|not attached|not visible/i.test(message)) return "SELECTOR_ERROR";
  return "UNKNOWN_ERROR";
}

/**
 * Classify the HTTP status of the application page itself. Only statuses that
 * mean "this run can't work" are failures; anything else lets the run go on.
 */
export function failureForHttpStatus(status: number, retryAfter?: string | null): AutomationError | null {
  if (status === 429) return new AutomationError("RATE_LIMITED", `The site is limiting requests (HTTP 429)`, undefined, parseRetryAfter(retryAfter));
  if (status === 404 || status === 410) return new AutomationError("POSTING_CLOSED", `The application page is gone (HTTP ${status}); the posting may have closed`);
  if (status >= 500 && status <= 599) return new AutomationError("SITE_UNAVAILABLE", `The site returned an error (HTTP ${status})`, undefined, parseRetryAfter(retryAfter));
  return null;
}

/** Retry-After is either seconds or an HTTP date. Unreasonable values are ignored. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const ms = /^\d+$/.test(trimmed) ? Number(trimmed) * 1000 : Date.parse(trimmed) - now;
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return Math.min(ms, 6 * 3600_000);
}

export interface RetryPolicy {
  /** Total attempts (the first run included) before a person is asked to look. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/** The default policy, used for network errors and timeouts. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 30_000, maxDelayMs: 30 * 60_000 };

/**
 * How each retryable failure class backs off. A site that is down or limiting
 * requests is given much longer to recover than a dropped connection, and a
 * problem we can't explain is retried only once before a person looks.
 */
export const RETRY_POLICIES: Partial<Record<FailureType, RetryPolicy>> = {
  NETWORK_ERROR: DEFAULT_RETRY_POLICY,
  TIMEOUT: DEFAULT_RETRY_POLICY,
  SELECTOR_ERROR: { maxAttempts: 3, baseDelayMs: 60_000, maxDelayMs: 10 * 60_000 },
  BROWSER_CRASHED: { maxAttempts: 3, baseDelayMs: 15_000, maxDelayMs: 5 * 60_000 },
  SITE_UNAVAILABLE: { maxAttempts: 5, baseDelayMs: 2 * 60_000, maxDelayMs: 60 * 60_000 },
  RATE_LIMITED: { maxAttempts: 4, baseDelayMs: 10 * 60_000, maxDelayMs: 2 * 3600_000 },
  UNKNOWN_ERROR: { maxAttempts: 2, baseDelayMs: 30_000, maxDelayMs: 30 * 60_000 },
};

export type RetryDecision =
  | { action: "retry"; delayMs: number }
  | { action: "needs_attention"; reason: AttentionReason }
  | { action: "fail" };

/**
 * Decide what happens after a failed attempt. Retryable failures back off
 * exponentially (with jitter) under their class's policy, waiting at least as
 * long as the site asked; human-only blockers go straight to Needs Attention;
 * anything that keeps failing ends in Needs Attention rather than retrying
 * forever; a closed posting fails outright.
 */
export function decideRetry(
  failure: FailureType,
  attemptNumber: number,
  options: { policy?: RetryPolicy; retryAfterMs?: number; random?: () => number } = {},
): RetryDecision {
  const human = HUMAN_REQUIRED[failure];
  if (human) return { action: "needs_attention", reason: human };
  const policy = options.policy ?? RETRY_POLICIES[failure];
  if (!policy) return { action: "fail" };
  if (attemptNumber >= policy.maxAttempts) return { action: "needs_attention", reason: "REPEATED_FAILURE" };
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attemptNumber - 1));
  const jitter = exponential * 0.2 * ((options.random ?? Math.random)() * 2 - 1);
  const delayMs = Math.max(Math.round(exponential + jitter), options.retryAfterMs ?? 0);
  return { action: "retry", delayMs };
}

/** The Retry-After a failure carried, if any. */
export function retryAfterOf(error: unknown): number | undefined {
  return error instanceof AutomationError ? error.retryAfterMs : undefined;
}
