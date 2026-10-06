import type { FailureType } from "./enums";

/**
 * Plain-language descriptions of each failure class, for the automation
 * health page and application timelines. `retried` says whether the worker
 * tries again on its own (the retry policy lives in @autoapply/automation).
 */
export interface FailureInfo {
  label: string;
  meaning: string;
  retried: boolean;
  /** What the person can do about it. */
  fix: string;
}

export const FAILURE_INFO: Record<FailureType, FailureInfo> = {
  NETWORK_ERROR: { label: "Connection problem", meaning: "The connection to the site dropped or couldn't be made.", retried: true, fix: "Usually clears on its own. If it keeps happening, check the worker's internet connection." },
  TIMEOUT: { label: "Timed out", meaning: "A page or field took too long to respond.", retried: true, fix: "Usually clears on its own. Slow sites can be given longer with WORKER_NAVIGATION_TIMEOUT_MS." },
  SELECTOR_ERROR: { label: "Field not found", meaning: "A field or button the form needed wasn't where it was expected.", retried: true, fix: "If it repeats on one site, the site may have changed; open the application and finish it yourself." },
  BROWSER_CRASHED: { label: "Browser crashed", meaning: "The automated browser closed unexpectedly.", retried: true, fix: "Retried on a fresh browser. Repeated crashes usually mean the worker machine is short on memory." },
  SITE_UNAVAILABLE: { label: "Site down", meaning: "The employer's site returned a server error or was under maintenance.", retried: true, fix: "Retried with longer waits. Applications to that site pause briefly so it isn't hit again while it's down." },
  RATE_LIMITED: { label: "Rate limited", meaning: "The site asked us to slow down.", retried: true, fix: "Retried after the wait the site asked for. Lower your daily or concurrent limits in Rules if this repeats." },
  UNKNOWN_ERROR: { label: "Unexpected error", meaning: "Something went wrong that Applyance couldn't classify.", retried: true, fix: "Retried once, then sent to Needs Attention with the error so you can decide." },
  CAPTCHA: { label: "CAPTCHA", meaning: "The site showed a CAPTCHA. Applyance never solves or bypasses these.", retried: false, fix: "Complete it yourself from Needs Attention, then press I've completed it." },
  AUTH_REQUIRED: { label: "Sign-in needed", meaning: "The site needs you to sign in or verify your identity.", retried: false, fix: "Sign in yourself; Applyance reuses your session next time." },
  VALIDATION_ERROR: { label: "Form rejected an answer", meaning: "The site's own checks rejected a value.", retried: false, fix: "Correct the answer in Needs Attention and try again." },
  UNKNOWN_FIELD: { label: "Unclear question", meaning: "A required question couldn't be matched to your profile with enough confidence.", retried: false, fix: "Answer it in Needs Attention; save it to your Answer Library to reuse it." },
  SITE_CHANGED: { label: "Unsupported form", meaning: "The form didn't look like anything Applyance can fill safely.", retried: false, fix: "Apply on the site yourself and mark the application submitted." },
  POSTING_CLOSED: { label: "Posting closed", meaning: "The application page no longer exists, so the posting has probably closed.", retried: false, fix: "Nothing to retry. Check the job link, or skip the application." },
};

/** Time windows the automation health page offers, in days. */
export const HEALTH_PERIODS = [7, 30, 90] as const;
export type HealthPeriod = (typeof HEALTH_PERIODS)[number];

/** Redis hash of sites automation is holding off from: host → JSON {until, failure, reason}. */
export const SITE_COOLDOWN_KEY = "autoapply:site-cooldowns";

export interface SiteCooldown {
  host: string;
  /** ISO time the cooldown ends. */
  until: string;
  failure: FailureType;
  reason: string;
}

export function parseCooldown(raw: string | null | undefined): SiteCooldown | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as SiteCooldown;
    return typeof value.until === "string" && typeof value.host === "string" ? value : null;
  } catch {
    return null;
  }
}
