import { enumLabel, parseHttpUrl, type Platform } from "@autoapply/shared";

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

/**
 * Markers that identify an ATS in page HTML: its embed scripts on an
 * employer's own careers page, or the structure of its application form
 * (field names and automation ids each platform generates).
 */
export const HTML_MARKERS: Record<Exclude<Platform, "GENERIC" | "UNKNOWN" | "LINKEDIN_EASY_APPLY">, { embed: RegExp; form: RegExp }> = {
  GREENHOUSE: { embed: /boards\.greenhouse\.io|job-boards\.greenhouse\.io|grnhse_app|greenhouse\.io\/embed/i, form: /name="job_application\[|id="application_form"|data-source="greenhouse"/i },
  LEVER: { embed: /jobs\.lever\.co|lever-jobs-embed/i, form: /class="[^"]*\bpostings-btn\b|class="[^"]*\bapplication-question\b|name="urls\[LinkedIn\]"/i },
  ASHBY: { embed: /jobs\.ashbyhq\.com|ashby_embed/i, form: /_systemfield_|class="[^"]*\bashby-(application-form|job-posting)/i },
  WORKDAY: { embed: /myworkdayjobs\.com|wd\d+\.myworkday/i, form: /data-automation-id="(adventureButton|applyManually|legalNameSection_firstName|bottom-navigation-next-button|jobPostingHeader)"/i },
  SMARTRECRUITERS: { embed: /smartrecruiters\.com|smrtr/i, form: /<spl-(input|select|form-field|textarea)\b|oneclick-ui/i },
};

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
  for (const [platform, markers] of Object.entries(HTML_MARKERS) as Array<[Platform, { embed: RegExp; form: RegExp }]>) {
    if (markers.form.test(html)) return { platform, confidence: 85, evidence: `${enumLabel(platform)} form structure` };
  }
  for (const [platform, markers] of Object.entries(HTML_MARKERS) as Array<[Platform, { embed: RegExp; form: RegExp }]>) {
    if (markers.embed.test(html)) return { platform, confidence: 80, evidence: `Embedded ${enumLabel(platform)} markup` };
  }
  return byUrl;
}

/** 0-100: how sure we are that a page belongs to this platform, from its URL and (when loaded) its HTML. */
export function platformScore(platform: Platform, url: string, html?: string): number {
  if (detectPlatformFromUrl(url).platform === platform) return 95;
  const markers = HTML_MARKERS[platform as keyof typeof HTML_MARKERS];
  if (!markers || !html) return 0;
  if (markers.form.test(html)) return 85;
  if (markers.embed.test(html)) return 80;
  return 0;
}
