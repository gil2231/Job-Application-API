import { parseHttpUrl } from "./url";

/**
 * Job listing sites: they show jobs but the application usually lives on the
 * company's own site. Applyance never signs in to them, never fetches their
 * pages and never applies through them (LinkedIn Easy Apply, Handshake's
 * built-in apply). A job saved from one is followed to the company's own
 * application, or left for the user to apply to there themselves.
 */
export const LISTING_SITES = ["linkedin", "handshake", "indeed", "glassdoor", "ziprecruiter", "builtin"] as const;
export type ListingSite = (typeof LISTING_SITES)[number];

export const LISTING_SITE_LABELS: Record<ListingSite, string> = {
  linkedin: "LinkedIn",
  handshake: "Handshake",
  indeed: "Indeed",
  glassdoor: "Glassdoor",
  ziprecruiter: "ZipRecruiter",
  builtin: "Built In",
};

const HOSTS: Array<[ListingSite, RegExp]> = [
  ["linkedin", /(^|\.)linkedin\.com$/i],
  ["handshake", /(^|\.)joinhandshake\.com$/i],
  ["indeed", /(^|\.)indeed\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/i],
  ["glassdoor", /(^|\.)glassdoor\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/i],
  ["ziprecruiter", /(^|\.)ziprecruiter\.(com|co\.uk)$/i],
  // Built In and its city sites (builtinnyc.com, builtinchicago.org, ...): applying there takes a Built In account.
  ["builtin", /(^|\.)builtin(nyc|chicago|la|sf|boston|austin|colorado|seattle)?\.(com|org)$/i],
];

/** The listing site a link belongs to, or null for any other site. */
export function listingSite(input: string | null | undefined): ListingSite | null {
  const url = input ? parseHttpUrl(input) : null;
  if (!url) return null;
  return HOSTS.find(([, host]) => host.test(url.hostname))?.[0] ?? null;
}

/** A link to an application on the company's own site (or its hiring software), not a listing site. */
export function isCompanyApplicationUrl(input: string | null | undefined): boolean {
  return !!input && !!parseHttpUrl(input) && listingSite(input) === null;
}

/** Handshake job id from app.joinhandshake.com/stu/jobs/123, /jobs/123 or /job-search/123. */
export function extractHandshakeJobId(input: string): string | null {
  const url = parseHttpUrl(input);
  if (!url || !/(^|\.)joinhandshake\.com$/i.test(url.hostname)) return null;
  const match = url.pathname.match(/\/(?:stu\/)?(?:jobs|job-search|postings)\/(\d{3,})/);
  return match ? match[1]! : null;
}
