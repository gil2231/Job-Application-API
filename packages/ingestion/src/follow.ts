import { normalizeCompany } from "@autoapply/matching";
import { isCompanyApplicationUrl, LISTING_SITE_LABELS, listingSite, type ListingSite } from "@autoapply/shared";
import { jobFingerprint } from "./pipeline";
import { safeFetch, type HttpFetcher } from "./postings/safe-fetch";
import { searchAggregator } from "./sources/aggregator";
import { BOARD_PROVIDER_LABELS, readBoardPostings, type BoardProvider, type BoardRef } from "./sources/job-boards";
import { mapConcurrent } from "./sources/url-list";

/**
 * Following a job saved from LinkedIn, Handshake or another listing site to
 * the company's own application, which Applyance can fill. The listing site
 * itself is never fetched or signed in to. In order:
 * 1. the job's own application link, when it already points at the company;
 * 2. the company's public job board, found by its name (Greenhouse, Lever,
 *    Ashby, Workable, SmartRecruiters, Recruitee), with the same job title;
 * 3. JSearch (with a key), whose listings carry the company's direct link.
 * When none of these finds it (Easy Apply and Handshake-only jobs, or a
 * company whose board can't be found), the user applies on the listing site.
 */

export interface FollowJob {
  url: string;
  applicationUrl?: string | null;
  title: string;
  company: string;
  location?: string | null;
}

export interface FollowResult {
  /** The company's own application link. */
  url: string;
  via: "job" | "company_board" | "jsearch";
  /** Where it was found, e.g. "Greenhouse" or "JSearch". */
  foundOn: string;
}

export interface FollowOptions {
  http?: HttpFetcher;
  /** JSearch key; without one only the company's own boards are tried. */
  aggregatorKey?: string | null;
  timeoutMs?: number;
}

/** Placeholders a bare LinkedIn or Handshake link gets until the user fills in the job. */
const PLACEHOLDER_TITLE = /^(LinkedIn|Handshake) job \d+$|^Untitled job$/;
const GUESSED_PROVIDERS: BoardProvider[] = ["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "recruitee"];

const sameTitle = (a: string, b: string) => jobFingerprint("x", a) === jobFingerprint("x", b);
const city = (location: string | null | undefined) => (location ?? "").toLowerCase().split(/[,;/|(]/)[0]!.replace(/[^a-z]+/g, " ").trim();

/** Board names a company probably uses: "Acme Corp, Inc." → acme, acmecorp, acme-corp. */
export function guessBoardNames(company: string): string[] {
  const base = normalizeCompany(company);
  const words = company
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && !/^(inc|llc|ltd|corp|corporation|co|company|plc|gmbh|the)$/.test(w));
  const names = [base.replace(/\s+/g, ""), words.join(""), words.join("-"), base.split(" ")[0] ?? ""];
  return [...new Set(names.filter((n) => /^[a-z0-9][a-z0-9-]{1,60}$/.test(n)))].slice(0, 3);
}

function pick<T extends { title?: string | null; location?: string | null }>(job: FollowJob, candidates: T[]): T | null {
  const matches = candidates.filter((c) => c.title && sameTitle(c.title, job.title));
  if (matches.length <= 1) return matches[0] ?? null;
  const want = city(job.location);
  return (want && matches.find((m) => city(m.location) === want)) || matches[0]!;
}

async function fromCompanyBoards(job: FollowJob, http: HttpFetcher, timeoutMs: number): Promise<FollowResult | null> {
  const boards: BoardRef[] = guessBoardNames(job.company).flatMap((slug) =>
    GUESSED_PROVIDERS.map((provider) => ({ provider, slug: provider === "smartrecruiters" ? slug.replace(/(^|-)([a-z])/g, (_, d: string, c: string) => c.toUpperCase()) : slug })),
  );
  const found = await mapConcurrent(boards, 12, async (board) => {
    try {
      const postings = await readBoardPostings(board, http, { timeoutMs });
      const match = pick(job, postings);
      return match ? { url: match.applicationUrl ?? match.url, foundOn: BOARD_PROVIDER_LABELS[board.provider] } : null;
    } catch {
      return null; // No board by that name on this service.
    }
  });
  const hit = found.find((f) => f && isCompanyApplicationUrl(f.url));
  return hit ? { url: hit.url, via: "company_board", foundOn: hit.foundOn } : null;
}

async function fromJSearch(job: FollowJob, apiKey: string, http: HttpFetcher): Promise<FollowResult | null> {
  const hits = await searchAggregator({ query: `${job.title} ${job.company}`, location: job.location }, apiKey, http).catch(() => []);
  const company = normalizeCompany(job.company);
  const match = pick(
    job,
    hits.filter((h) => h.company && normalizeCompany(h.company) === company && isCompanyApplicationUrl(h.url)),
  );
  return match ? { url: match.url, via: "jsearch", foundOn: "JSearch" } : null;
}

/** Can this job be followed at all? Placeholder titles from a bare link can't be looked up. */
export function canFollow(job: Pick<FollowJob, "title" | "company">): boolean {
  return !PLACEHOLDER_TITLE.test(job.title.trim()) && !/^unknown company$/i.test(job.company.trim());
}

/** Find the company's own application for a job, or null when it can only be applied to on the listing site. */
export async function followToCompany(job: FollowJob, options: FollowOptions = {}): Promise<FollowResult | null> {
  if (isCompanyApplicationUrl(job.applicationUrl)) return { url: job.applicationUrl!, via: "job", foundOn: "the job" };
  if (!listingSite(job.applicationUrl ?? job.url) && isCompanyApplicationUrl(job.url)) return { url: job.url, via: "job", foundOn: "the job" };
  if (!canFollow(job)) return null;
  const http = options.http ?? safeFetch;
  return (await fromCompanyBoards(job, http, options.timeoutMs ?? 6_000)) ?? (options.aggregatorKey ? await fromJSearch(job, options.aggregatorKey, http) : null);
}

/** What to tell the user when a job can only be applied to on the listing site. */
export function applyYourselfMessage(site: ListingSite, url: string, job: Pick<FollowJob, "title" | "company">): string {
  const name = LISTING_SITE_LABELS[site];
  const why = !canFollow(job)
    ? `Add the job's title and company (Edit details) so Applyance can look for it on the company's own site, or apply on ${name} yourself`
    : site === "linkedin"
      ? "Applyance couldn't find this job on the company's own site, so it probably only takes LinkedIn Easy Apply. Applyance never signs in to LinkedIn, so apply on LinkedIn yourself"
      : site === "handshake"
        ? "Applyance couldn't find this job on the company's own site, so it probably only takes applications through Handshake. Applyance never signs in to Handshake, so apply on Handshake yourself"
        : `Applyance couldn't find this job on the company's own site. Apply on ${name} yourself`;
  return `${why}: ${url}. If you find the company's own application link, add it to the job and Applyance will fill it. Once you've applied, mark it submitted.`;
}
