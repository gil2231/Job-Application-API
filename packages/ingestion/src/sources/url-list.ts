import { isIP } from "node:net";
import { canonicalizeJobUrl, extractHandshakeJobId, extractLinkedInJobId, parseHttpUrl } from "@autoapply/shared";
import type { ImportIssue, JobSourceAdapter, RawJob, SourceParseResult } from "../types";
import { MAX_URLS_PER_PASTE } from "../types";

/** Pull every http(s) URL out of pasted text (one per line, or mixed with other text). */
export function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"'(),]+[^\s<>"'(),.;:!?]/gi) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of found) {
    if (!parseHttpUrl(url)) continue;
    const key = canonicalizeJobUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

const titleize = (slug: string) => slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

/** ATS hosts whose first path segment is the company's board, e.g. boards.greenhouse.io/acme. */
const BOARD_HOSTS = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|workable\.com|breezy\.hr|recruitee\.com)$/i;

/**
 * A readable stand-in for the company until the user adds it:
 * "careers.acme.com" → "Acme", "boards.greenhouse.io/acme-corp/…" → "Acme Corp",
 * "acme.wd5.myworkdayjobs.com" → "Acme".
 */
export function companyFromUrl(url: string): string {
  const parsed = parseHttpUrl(url);
  if (!parsed) return "Unknown company";
  const host = parsed.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, ""))) return "Unknown company";
  if (BOARD_HOSTS.test(host)) {
    const slug = parsed.pathname.split("/").filter(Boolean)[0];
    if (slug && !/^(embed|jobs|j|o|en|en-us)$/i.test(slug)) return titleize(decodeURIComponent(slug)).slice(0, 100);
  }
  if (/\.myworkdayjobs\.com$/.test(host)) return titleize(host.split(".")[0]!);
  const label = host.replace(/^(www|careers|jobs|apply|boards|job-boards)\./, "").split(".")[0];
  return label ? titleize(label) : "Unknown company";
}

/**
 * Pasted job URLs. Public ATS postings (Greenhouse, Lever, Ashby, SmartRecruiters,
 * Workday, and pages with schema.org JobPosting data) are filled in from their
 * public posting data. LinkedIn and Handshake URLs are never fetched: they are
 * added with their job id and marked as needing details.
 */
export const urlListSource: JobSourceAdapter<{ text: string }> = {
  id: "urls",
  type: "MANUAL",
  name: "Pasted URLs",
  async parse(input, context): Promise<SourceParseResult> {
    const urls = extractUrls(input.text);
    const issues: ImportIssue[] = [];
    const limit = Math.min(context.maxJobs, MAX_URLS_PER_PASTE);
    if (urls.length > limit) issues.push({ kind: "limit", message: `Only the first ${limit} URLs are imported at a time.` });

    const jobs = await mapConcurrent(urls.slice(0, limit), 4, async (url): Promise<RawJob> => {
      const linkedInId = extractLinkedInJobId(url);
      if (linkedInId) {
        return { url, externalId: linkedInId, title: `LinkedIn job ${linkedInId}`, company: "Unknown company", needsDetails: true };
      }
      // Handshake jobs need a school sign-in, so they're kept like LinkedIn ones: the link, for the user to fill in.
      const handshakeId = extractHandshakeJobId(url);
      if (handshakeId) {
        return { url, externalId: handshakeId, title: `Handshake job ${handshakeId}`, company: "Unknown company", needsDetails: true };
      }
      if (context.fetchPosting) {
        try {
          const posting = await context.fetchPosting(url);
          if (posting?.title && posting.company) return { ...posting, url };
        } catch (error) {
          issues.push({ url, kind: "fetch_failed", message: `Couldn't read the posting (${error instanceof Error ? error.message : "unknown error"}). Added it so you can fill in the details.` });
        }
      }
      return { url, title: "Untitled job", company: companyFromUrl(url), needsDetails: true };
    });
    return { sourceType: "MANUAL", sourceName: "Pasted URLs", jobs, issues };
  },
};

export async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}
