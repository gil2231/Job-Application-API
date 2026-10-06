import { parseHttpUrl, type Platform } from "@autoapply/shared";

interface UrlRule {
  platform: Platform;
  host: RegExp;
  path?: RegExp;
}

// Hostname patterns for supported applicant tracking systems.
const URL_RULES: UrlRule[] = [
  { platform: "WORKDAY", host: /(^|\.)myworkdayjobs\.com$|(^|\.)myworkdaysite\.com$|(^|\.)workday\.com$/i },
  { platform: "GREENHOUSE", host: /(^|\.)greenhouse\.io$/i },
  { platform: "LEVER", host: /(^|\.)lever\.co$/i },
  { platform: "ASHBY", host: /(^|\.)ashbyhq\.com$/i },
  { platform: "SMARTRECRUITERS", host: /(^|\.)smartrecruiters\.com$/i },
  { platform: "LINKEDIN_EASY_APPLY", host: /(^|\.)linkedin\.com$/i, path: /^\/jobs\// },
];

// Markers that identify an ATS embedded on an employer's own careers page.
const HTML_MARKERS: Array<[Platform, RegExp]> = [
  ["GREENHOUSE", /boards\.greenhouse\.io|grnhse_app|greenhouse\.io\/embed/i],
  ["LEVER", /jobs\.lever\.co|lever-jobs-embed/i],
  ["ASHBY", /jobs\.ashbyhq\.com|ashby_embed/i],
  ["WORKDAY", /myworkdayjobs\.com|wd\d+\.myworkday/i],
  ["SMARTRECRUITERS", /smartrecruiters\.com|smrtr/i],
];

export interface PlatformDetection {
  platform: Platform;
  /** 0..100 */
  confidence: number;
  evidence: string;
}

/** Detect the application platform from a URL alone. Unknown hosts are GENERIC web forms. */
export function detectPlatformFromUrl(input: string): PlatformDetection {
  const url = parseHttpUrl(input);
  if (!url) return { platform: "UNKNOWN", confidence: 0, evidence: "Not a valid URL" };
  for (const rule of URL_RULES) {
    if (rule.host.test(url.hostname) && (!rule.path || rule.path.test(url.pathname))) {
      return { platform: rule.platform, confidence: 95, evidence: `Hostname ${url.hostname}` };
    }
  }
  return { platform: "GENERIC", confidence: 50, evidence: `No known ATS for ${url.hostname}` };
}

/**
 * Refine detection with page HTML (used by the worker once a page is loaded):
 * employer career pages often embed Greenhouse, Lever, etc.
 */
export function detectPlatformFromHtml(url: string, html: string): PlatformDetection {
  const byUrl = detectPlatformFromUrl(url);
  if (byUrl.platform !== "GENERIC") return byUrl;
  for (const [platform, marker] of HTML_MARKERS) {
    if (marker.test(html)) return { platform, confidence: 80, evidence: `Embedded ${platform.toLowerCase()} markup` };
  }
  return byUrl;
}
