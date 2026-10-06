import { htmlToText } from "@autoapply/ai";
import { JOB_BOARD_SOURCE_NAME } from "@autoapply/database";
import {
  canonicalizeJobUrl,
  isEmptyKeywordQuery,
  matchesKeywordQuery,
  mentionsKeyword,
  parseHttpUrl,
  parseKeywordQuery,
  type KeywordQuery,
  type WorkArrangement,
} from "@autoapply/shared";
import { safeFetch, type HttpFetcher } from "../postings/safe-fetch";
import type { ImportIssue, JobSourceAdapter, RawJob, SourceParseResult } from "../types";
import { mapConcurrent } from "./url-list";

/**
 * Keyword search over companies' public job boards. Greenhouse, Lever and
 * Ashby each publish a documented, unauthenticated job board API meant for
 * anyone to read (it's what their hosted career pages are built on). None of
 * them offers a cross-company search, so the user lists the boards to search
 * and the filtering happens here. LinkedIn and other sites that don't publish
 * such an API are never searched.
 */

export const BOARD_PROVIDERS = ["greenhouse", "lever", "ashby"] as const;
export type BoardProvider = (typeof BOARD_PROVIDERS)[number];

export const BOARD_PROVIDER_LABELS: Record<BoardProvider, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby" };

export interface BoardRef {
  provider: BoardProvider;
  /** The company's board name, e.g. "acme" in boards.greenhouse.io/acme. */
  slug: string;
  /** Lever hosts EU companies separately. */
  region?: "eu";
}

export const MAX_BOARDS_PER_SEARCH = 25;
export const MAX_BOARD_RESULTS = 200;
/** Large companies publish thousands of postings with full descriptions. */
const MAX_BOARD_BYTES = 20 * 1024 * 1024;

const SLUG = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/;

const titleize = (slug: string) =>
  slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

function ref(provider: BoardProvider, rawSlug: string | undefined, region?: "eu"): BoardRef | null {
  if (!rawSlug) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(rawSlug).trim();
  } catch {
    return null;
  }
  if (!SLUG.test(slug)) return null;
  return region ? { provider, slug, region } : { provider, slug };
}

/**
 * Read a board from a link or a "provider:name" shorthand:
 * boards.greenhouse.io/acme, job-boards.greenhouse.io/acme/jobs/123,
 * jobs.lever.co/acme, jobs.eu.lever.co/acme, jobs.ashbyhq.com/acme, lever:acme.
 */
export function parseBoardRef(input: string): BoardRef | null {
  const text = input.trim();
  const short = /^(greenhouse|lever|ashby)\s*:\s*(\S+)$/i.exec(text);
  if (short) return ref(short[1]!.toLowerCase() as BoardProvider, short[2]);
  const url = parseHttpUrl(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const first = url.pathname.split("/").filter(Boolean)[0];
  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    if (first === "embed") return ref("greenhouse", url.searchParams.get("for") ?? undefined);
    return ref("greenhouse", first);
  }
  if (host === "jobs.lever.co") return ref("lever", first);
  if (host === "jobs.eu.lever.co") return ref("lever", first, "eu");
  if (host === "jobs.ashbyhq.com") return ref("ashby", first);
  return null;
}

export function boardKey(board: BoardRef): string {
  return `${board.provider}:${board.region ? `${board.region}:` : ""}${board.slug.toLowerCase()}`;
}

/** The public page for a board, for links in the UI. */
export function boardUrl(board: BoardRef): string {
  const slug = encodeURIComponent(board.slug);
  if (board.provider === "greenhouse") return `https://boards.greenhouse.io/${slug}`;
  if (board.provider === "lever") return `https://jobs.${board.region === "eu" ? "eu." : ""}lever.co/${slug}`;
  return `https://jobs.ashbyhq.com/${slug}`;
}

/** Parse one board per line (or comma-separated), dropping repeats. */
export function parseBoardList(text: string): { boards: BoardRef[]; invalid: string[] } {
  const boards: BoardRef[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/[\n,]+/).map((l) => l.trim()).filter(Boolean)) {
    const board = parseBoardRef(line);
    if (!board) {
      invalid.push(line.slice(0, 200));
      continue;
    }
    const key = boardKey(board);
    if (seen.has(key)) continue;
    seen.add(key);
    boards.push(board);
  }
  return { boards, invalid };
}

async function getJson<T>(http: HttpFetcher, url: string): Promise<T> {
  const response = await http(url, { accept: "application/json", maxBytes: MAX_BOARD_BYTES });
  try {
    return JSON.parse(response.text) as T;
  } catch {
    throw new Error("The board's data wasn't valid JSON");
  }
}

const formatRange = (min: number | null | undefined, max: number | null | undefined, currency: string | null | undefined, period: string) => {
  if (min == null && max == null) return null;
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const range = min != null && max != null && min !== max ? `${fmt(min)} - ${fmt(max)}` : fmt((min ?? max)!);
  return `${currency ?? "USD"} ${range} ${period}`;
};

const validDate = (value: string | number | undefined | null) => {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// ── Board readers ───────────────────────────────────────────────────────────

interface GreenhouseBoard {
  jobs?: Array<{
    id: number;
    title: string;
    company_name?: string;
    location?: { name?: string };
    content?: string;
    absolute_url?: string;
    first_published?: string;
    updated_at?: string;
  }>;
}

async function readGreenhouse(board: BoardRef, http: HttpFetcher): Promise<RawJob[]> {
  const slug = encodeURIComponent(board.slug);
  const data = await getJson<GreenhouseBoard>(http, `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
  return (data.jobs ?? []).map((job) => {
    const url = `https://boards.greenhouse.io/${slug}/jobs/${job.id}`;
    // absolute_url is often the company's own careers page with the board embedded. The Greenhouse
    // posting is the same application and keeps the platform recognizable, so only Greenhouse links are kept.
    const apply = job.absolute_url && /(^|\.)greenhouse\.io$/i.test(parseHttpUrl(job.absolute_url)?.hostname ?? "") ? job.absolute_url : null;
    return {
      url,
      externalId: String(job.id),
      title: job.title,
      company: job.company_name || titleize(board.slug),
      location: job.location?.name ?? null,
      description: job.content ?? null,
      applicationUrl: apply && apply !== url ? apply : null,
      postedAt: validDate(job.first_published ?? job.updated_at),
    };
  });
}

interface LeverPosting {
  id: string;
  text: string;
  categories?: { location?: string; commitment?: string; team?: string };
  description?: string;
  descriptionPlain?: string;
  lists?: Array<{ text: string; content: string }>;
  additional?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  workplaceType?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
}

const LEVER_ARRANGEMENT: Record<string, WorkArrangement> = { remote: "REMOTE", hybrid: "HYBRID", "on-site": "ONSITE", onsite: "ONSITE" };

async function readLever(board: BoardRef, http: HttpFetcher): Promise<RawJob[]> {
  const api = board.region === "eu" ? "api.eu.lever.co" : "api.lever.co";
  const site = encodeURIComponent(board.slug);
  const data = await getJson<LeverPosting[]>(http, `https://${api}/v0/postings/${site}?mode=json`);
  if (!Array.isArray(data)) throw new Error("The board's data wasn't in the expected format");
  return data.map((job) => {
    const lists = (job.lists ?? []).map((l) => `<h3>${l.text}</h3><ul>${l.content}</ul>`).join("");
    const interval = job.salaryRange?.interval?.replace(/-/g, " ").replace(/ salary$/, "") ?? "per year";
    return {
      url: job.hostedUrl ?? `https://jobs.${board.region === "eu" ? "eu." : ""}lever.co/${site}/${job.id}`,
      externalId: job.id,
      title: job.text,
      company: titleize(board.slug),
      location: job.categories?.location ?? null,
      description: [job.description ?? job.descriptionPlain ?? "", lists, job.additional ?? ""].join("\n"),
      applicationUrl: job.applyUrl ?? null,
      postedAt: validDate(job.createdAt),
      workArrangement: (job.workplaceType && LEVER_ARRANGEMENT[job.workplaceType.toLowerCase()]) || null,
      salaryText: job.salaryRange ? formatRange(job.salaryRange.min, job.salaryRange.max, job.salaryRange.currency, interval) : null,
    };
  });
}

interface AshbyBoard {
  jobs?: Array<{
    id: string;
    title: string;
    location?: string;
    isListed?: boolean;
    descriptionHtml?: string;
    descriptionPlain?: string;
    publishedAt?: string;
    isRemote?: boolean;
    workplaceType?: string;
    jobUrl?: string;
    applyUrl?: string;
    compensation?: { compensationTierSummary?: string; scrapeableCompensationSalarySummary?: string };
  }>;
}

async function readAshby(board: BoardRef, http: HttpFetcher): Promise<RawJob[]> {
  const org = encodeURIComponent(board.slug);
  const data = await getJson<AshbyBoard>(http, `https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true`);
  return (data.jobs ?? [])
    .filter((job) => job.isListed !== false)
    .map((job) => {
      const workplace = job.workplaceType?.toUpperCase();
      return {
        url: job.jobUrl ?? `https://jobs.ashbyhq.com/${org}/${job.id}`,
        externalId: job.id,
        title: job.title,
        company: titleize(board.slug),
        location: job.location ?? null,
        description: job.descriptionHtml ?? job.descriptionPlain ?? null,
        applicationUrl: job.applyUrl ?? null,
        postedAt: validDate(job.publishedAt),
        workArrangement: job.isRemote || workplace === "REMOTE" ? "REMOTE" : workplace === "HYBRID" ? "HYBRID" : workplace === "ONSITE" ? "ONSITE" : null,
        salaryText: job.compensation?.scrapeableCompensationSalarySummary ?? job.compensation?.compensationTierSummary ?? null,
      };
    });
}

const READERS: Record<BoardProvider, (board: BoardRef, http: HttpFetcher) => Promise<RawJob[]>> = {
  greenhouse: readGreenhouse,
  lever: readLever,
  ashby: readAshby,
};

// ── Search ──────────────────────────────────────────────────────────────────

export interface BoardSearchInput {
  boards: BoardRef[];
  /** Keyword query: words and "phrases" must all appear; -word excludes. */
  query: string;
  /** Optional location filter, e.g. "New York" or "Remote". */
  location?: string | null;
  /** Match keywords in descriptions too, not just job titles. Exclusions always check the whole posting. */
  searchDescriptions?: boolean;
  /** Only return these postings (canonical or raw URLs), e.g. the ones the user picked from the results. */
  onlyUrls?: string[];
}

export interface BoardSearchHit extends RawJob {
  provider: BoardProvider;
  board: string;
  matchedIn: "title" | "description";
}

export interface BoardSearchResult {
  jobs: BoardSearchHit[];
  /** Matches before the result cap. */
  totalMatches: number;
  boards: Array<{ key: string; provider: BoardProvider; slug: string; url: string; postings: number; matches: number; error: string | null }>;
  issues: ImportIssue[];
}

function matchesLocation(job: RawJob, location: string): boolean {
  const wanted = location.trim();
  if (!wanted) return true;
  if (/^(remote|anywhere|work from home|wfh)$/i.test(wanted)) return job.workArrangement === "REMOTE" || mentionsKeyword(job.location ?? "", "remote");
  if (!job.location) return false;
  return job.location.toLowerCase().includes(wanted.toLowerCase()) || mentionsKeyword(job.location, wanted);
}

function matchKeywords(job: RawJob, descriptionText: string, query: KeywordQuery, searchDescriptions: boolean): BoardSearchHit["matchedIn"] | null {
  const heading = [job.title, job.company].filter(Boolean).join("\n");
  const everything = `${heading}\n${job.location ?? ""}\n${descriptionText}`;
  if (query.exclude.length && !matchesKeywordQuery(everything, { include: [], exclude: query.exclude })) return null;
  const include = { include: query.include, exclude: [] };
  if (matchesKeywordQuery(heading, include)) return "title";
  if (searchDescriptions && matchesKeywordQuery(everything, include)) return "description";
  return null;
}

export class BoardSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardSearchError";
  }
}

/** Search the given boards. Boards that fail are reported per board; the rest still return results. */
export async function searchJobBoards(input: BoardSearchInput, http: HttpFetcher = safeFetch): Promise<BoardSearchResult> {
  const query = parseKeywordQuery(input.query);
  if (!input.boards.length) throw new BoardSearchError("Add at least one job board to search.");
  if (isEmptyKeywordQuery(query) && !input.location?.trim()) throw new BoardSearchError("Enter keywords to search for.");
  if (input.boards.length > MAX_BOARDS_PER_SEARCH) throw new BoardSearchError(`Search up to ${MAX_BOARDS_PER_SEARCH} boards at a time.`);

  const only = input.onlyUrls ? new Set(input.onlyUrls.map(safeCanonical).filter(Boolean)) : null;
  const issues: ImportIssue[] = [];
  const perBoard = await mapConcurrent(input.boards, 4, async (board) => {
    const summary = { key: boardKey(board), provider: board.provider, slug: board.slug, url: boardUrl(board), postings: 0, matches: 0, error: null as string | null };
    let postings: RawJob[];
    try {
      postings = await READERS[board.provider](board, http);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      summary.error = /not found/i.test(reason) ? "No public board found with this name." : `Couldn't read this board (${reason}).`;
      issues.push({ url: summary.url, kind: "fetch_failed", message: `${BOARD_PROVIDER_LABELS[board.provider]} board "${board.slug}": ${summary.error}` });
      return { summary, hits: [] as BoardSearchHit[] };
    }
    summary.postings = postings.length;
    const hits: BoardSearchHit[] = [];
    for (const job of postings) {
      if (!job.title || !job.url) continue;
      if (only && !only.has(safeCanonical(job.url))) continue;
      if (input.location && !matchesLocation(job, input.location)) continue;
      const text = job.description ? htmlToText(job.description) : "";
      const matchedIn = matchKeywords(job, text, query, input.searchDescriptions ?? false);
      if (!matchedIn) continue;
      hits.push({ ...job, title: job.title.slice(0, 200), company: job.company?.slice(0, 200) ?? null, location: job.location?.slice(0, 200) ?? null, description: job.description?.slice(0, 100_000) ?? null, provider: board.provider, board: board.slug, matchedIn });
    }
    summary.matches = hits.length;
    return { summary, hits };
  });

  // Title matches first, then the newest postings.
  const all = perBoard
    .flatMap((b) => b.hits)
    .sort((a, b) => (a.matchedIn === b.matchedIn ? (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0) : a.matchedIn === "title" ? -1 : 1));
  if (all.length > MAX_BOARD_RESULTS) issues.push({ kind: "limit", message: `Showing the first ${MAX_BOARD_RESULTS} of ${all.length} matches. Add more keywords to narrow the search.` });
  return { jobs: all.slice(0, MAX_BOARD_RESULTS), totalMatches: all.length, boards: perBoard.map((b) => b.summary), issues };
}

function safeCanonical(url: string): string {
  try {
    return canonicalizeJobUrl(url);
  } catch {
    return "";
  }
}

/**
 * Job board search as an import source: the matching postings (or the ones the
 * user picked) go through the same dedup, analysis and scoring as every import.
 */
export const jobBoardSearchSource: JobSourceAdapter<BoardSearchInput & { http?: HttpFetcher }> = {
  id: "job-boards",
  type: "JOB_BOARD",
  name: JOB_BOARD_SOURCE_NAME,
  async parse(input, context): Promise<SourceParseResult> {
    const result = await searchJobBoards(input, input.http);
    const jobs = result.jobs.slice(0, context.maxJobs).map(({ provider: _provider, board: _board, matchedIn: _matchedIn, ...job }) => job);
    return { sourceType: "JOB_BOARD", sourceName: JOB_BOARD_SOURCE_NAME, jobs, issues: result.issues };
  },
};
