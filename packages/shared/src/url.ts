/** Query parameters that only track where a click came from and never identify a job. */
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "ref",
  "refid",
  "trk",
  "trackingid",
  "src",
  "source",
  "lipi",
  "originalsubdomain",
  "ebp",
  "eid",
  "currentjobid",
  "_ga",
]);

/** Returns a parsed http(s) URL or null when the input is not one. */
export function parseHttpUrl(input: string): URL | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Extract LinkedIn's numeric job id from any of its job URL shapes. */
export function extractLinkedInJobId(input: string): string | null {
  const url = parseHttpUrl(input);
  if (!url || !/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
  const view = url.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/);
  if (view) return view[1]!;
  const current = url.searchParams.get("currentJobId");
  if (current && /^\d{6,}$/.test(current)) return current;
  return null;
}

/**
 * Normalize a job URL so the same posting saved twice (with different tracking
 * parameters, casing, trailing slashes or fragments) produces the same key.
 * This key backs the per-user unique constraint on jobs.
 */
export function canonicalizeJobUrl(input: string): string {
  const url = parseHttpUrl(input);
  if (!url) throw new Error("Invalid job URL");

  const linkedInId = extractLinkedInJobId(input);
  if (linkedInId) return `https://www.linkedin.com/jobs/view/${linkedInId}`;

  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hash = "";
  url.port = "";

  const kept = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()) && !key.toLowerCase().startsWith("utm_"))
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);

  let path = url.pathname.replace(/\/+$/, "");
  if (path === "") path = "/";
  url.pathname = path;

  return url.toString().replace(/\/$/, "");
}
