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
 * Keyword search over companies' public job boards. Greenhouse, Lever, Ashby,
 * Workable, SmartRecruiters and Recruitee each publish an unauthenticated job
 * board API meant for anyone to read, and Workday career sites are built on a
 * public search endpoint. These are what the companies' own career pages load.
 * Most offer no cross-company search, so the boards to search are listed (by
 * the user, or from the built-in directory) and the filtering happens here.
 * LinkedIn, Handshake and other sites without such an API are never searched.
 */

export const BOARD_PROVIDERS = ["greenhouse", "lever", "ashby", "workday", "workable", "smartrecruiters", "recruitee"] as const;
export type BoardProvider = (typeof BOARD_PROVIDERS)[number];

export const BOARD_PROVIDER_LABELS: Record<BoardProvider, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workday: "Workday",
  workable: "Workable",
  smartrecruiters: "SmartRecruiters",
  recruitee: "Recruitee",
};

/** For messages: "Greenhouse, Lever, Ashby, Workday, Workable, SmartRecruiters or Recruitee". */
export const BOARD_PROVIDER_LIST = `${BOARD_PROVIDERS.slice(0, -1).map((p) => BOARD_PROVIDER_LABELS[p]).join(", ")} or ${BOARD_PROVIDER_LABELS[BOARD_PROVIDERS.at(-1)!]}`;

export interface BoardRef {
  provider: BoardProvider;
  /** The company's board name, e.g. "acme" in boards.greenhouse.io/acme. For Workday, the career site name. */
  slug: string;
  /** Lever hosts EU companies separately. */
  region?: "eu";
  /** Workday only: the tenant's host, e.g. acme.wd5.myworkdayjobs.com. */
  host?: string;
}

export const MAX_BOARDS_PER_SEARCH = 25;
export const MAX_BOARD_RESULTS = 200;
/** Large companies publish thousands of postings with full descriptions. */
const MAX_BOARD_BYTES = 20 * 1024 * 1024;

const SLUG = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/;
const WORKDAY_HOST = /^([a-z0-9][a-z0-9-]{0,62})\.(wd\d{1,3})\.myworkdayjobs\.com$/;
const LOCALE = /^[a-z]{2}-[A-Z]{2}$/;

const titleize = (slug: string) =>
  slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

function ref(provider: BoardProvider, rawSlug: string | undefined, extra: { region?: "eu"; host?: string } = {}): BoardRef | null {
  if (!rawSlug) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(rawSlug).trim();
  } catch {
    return null;
  }
  if (!SLUG.test(slug)) return null;
  return { provider, slug, ...(extra.region ? { region: extra.region } : {}), ...(extra.host ? { host: extra.host } : {}) };
}

/** A Workday career site from its host and path: acme.wd5.myworkdayjobs.com/en-US/External/... */
function workdayRef(host: string, segments: string[]): BoardRef | null {
  if (!WORKDAY_HOST.test(host)) return null;
  const site = LOCALE.test(segments[0] ?? "") ? segments[1] : segments[0];
  if (!site || /^(wday|job|jobs)$/i.test(site)) return null;
  return ref("workday", site, { host });
}

/**
 * Read a board from a link or a "provider:name" shorthand:
 * boards.greenhouse.io/acme, job-boards.greenhouse.io/acme/jobs/123,
 * jobs.lever.co/acme, jobs.eu.lever.co/acme, jobs.ashbyhq.com/acme,
 * acme.wd5.myworkdayjobs.com/en-US/External, apply.workable.com/acme,
 * jobs.smartrecruiters.com/Acme, acme.recruitee.com, lever:acme,
 * workday:acme.wd5/External.
 */
export function parseBoardRef(input: string): BoardRef | null {
  const text = input.trim();
  const short = /^(greenhouse|lever|ashby|workday|workable|smartrecruiters|recruitee)\s*:\s*(\S+)$/i.exec(text);
  if (short) {
    const provider = short[1]!.toLowerCase() as BoardProvider;
    if (provider === "workday") {
      const [tenant, site] = short[2]!.split("/");
      return tenant && site ? workdayRef(`${tenant.toLowerCase()}.myworkdayjobs.com`, [site]) : null;
    }
    return ref(provider, short[2]);
  }
  const url = parseHttpUrl(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    if (first === "embed") return ref("greenhouse", url.searchParams.get("for") ?? undefined);
    return ref("greenhouse", first);
  }
  if (host === "jobs.lever.co") return ref("lever", first);
  if (host === "jobs.eu.lever.co") return ref("lever", first, { region: "eu" });
  if (host === "jobs.ashbyhq.com") return ref("ashby", first);
  if (host.endsWith(".myworkdayjobs.com")) return workdayRef(host, segments);
  if (host === "apply.workable.com" && first !== "api" && first !== "j") return ref("workable", first);
  if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") return ref("smartrecruiters", first);
  const recruitee = /^([a-z0-9][a-z0-9-]{0,62})\.recruitee\.com$/.exec(host);
  if (recruitee && recruitee[1] !== "www" && recruitee[1] !== "api") return ref("recruitee", recruitee[1]);
  return null;
}

export function boardKey(board: BoardRef): string {
  const scope = board.region ? `${board.region}:` : board.host ? `${board.host.split(".")[0]}:` : "";
  return `${board.provider}:${scope}${board.slug.toLowerCase()}`;
}

/** The public page for a board, for links in the UI. */
export function boardUrl(board: BoardRef): string {
  const slug = encodeURIComponent(board.slug);
  switch (board.provider) {
    case "greenhouse":
      return `https://boards.greenhouse.io/${slug}`;
    case "lever":
      return `https://jobs.${board.region === "eu" ? "eu." : ""}lever.co/${slug}`;
    case "ashby":
      return `https://jobs.ashbyhq.com/${slug}`;
    case "workday":
      return `https://${board.host}/${slug}`;
    case "workable":
      return `https://apply.workable.com/${slug}`;
    case "smartrecruiters":
      return `https://jobs.smartrecruiters.com/${slug}`;
    case "recruitee":
      return `https://${board.slug.toLowerCase()}.recruitee.com`;
  }
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

/** How a board is read for one search. */
interface ReadOptions {
  /** Keywords the board's own search can narrow by (Workday, SmartRecruiters), or null to list everything. */
  searchText: string | null;
  /** Whether full descriptions are needed; without them big boards load much faster. */
  descriptions: boolean;
  timeoutMs?: number;
  /** Skip the cache. */
  fresh?: boolean;
}

async function getJson<T>(http: HttpFetcher, url: string, options: Pick<ReadOptions, "timeoutMs"> & { method?: "POST"; body?: string } = {}): Promise<T> {
  const response = await http(url, { accept: "application/json", maxBytes: MAX_BOARD_BYTES, timeoutMs: options.timeoutMs, method: options.method, body: options.body });
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

async function readGreenhouse(board: BoardRef, http: HttpFetcher, options: ReadOptions): Promise<RawJob[]> {
  const slug = encodeURIComponent(board.slug);
  const data = await getJson<GreenhouseBoard>(http, `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs${options.descriptions ? "?content=true" : ""}`, options);
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

async function readLever(board: BoardRef, http: HttpFetcher, options: ReadOptions): Promise<RawJob[]> {
  const api = board.region === "eu" ? "api.eu.lever.co" : "api.lever.co";
  const site = encodeURIComponent(board.slug);
  const data = await getJson<LeverPosting[]>(http, `https://${api}/v0/postings/${site}?mode=json`, options);
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

async function readAshby(board: BoardRef, http: HttpFetcher, options: ReadOptions): Promise<RawJob[]> {
  const org = encodeURIComponent(board.slug);
  const data = await getJson<AshbyBoard>(http, `https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true`, options);
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

interface WorkdayPage {
  total?: number;
  jobPostings?: Array<{ title?: string; externalPath?: string; locationsText?: string; postedOn?: string; bulletFields?: string[] }>;
}

/** Workday lists at most 20 postings per request; this many pages are read (newest or best matches first). */
const WORKDAY_PAGES = 3;
const WORKDAY_PAGE_SIZE = 20;

/** "Posted Today", "Posted Yesterday", "Posted 3 Days Ago", "Posted 30+ Days Ago". */
function workdayPostedAt(text: string | undefined, now = Date.now()): Date | null {
  if (!text) return null;
  const day = 86_400_000;
  if (/today/i.test(text)) return new Date(now);
  if (/yesterday/i.test(text)) return new Date(now - day);
  const days = /(\d+)\+?\s+days?\s+ago/i.exec(text);
  return days ? new Date(now - Number(days[1]) * day) : null;
}

async function readWorkday(board: BoardRef, http: HttpFetcher, options: ReadOptions): Promise<RawJob[]> {
  const host = board.host!;
  const tenant = host.split(".")[0]!;
  const site = encodeURIComponent(board.slug);
  const api = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;
  const page = (offset: number) =>
    getJson<WorkdayPage>(http, api, {
      ...options,
      method: "POST",
      body: JSON.stringify({ appliedFacets: {}, limit: WORKDAY_PAGE_SIZE, offset, searchText: options.searchText ?? "" }),
    });
  const first = await page(0);
  const total = Math.min(first.total ?? 0, WORKDAY_PAGES * WORKDAY_PAGE_SIZE);
  const offsets: number[] = [];
  for (let offset = WORKDAY_PAGE_SIZE; offset < total; offset += WORKDAY_PAGE_SIZE) offsets.push(offset);
  const rest = await Promise.all(offsets.map((o) => page(o).catch(() => ({ jobPostings: [] }) as WorkdayPage)));
  return [first, ...rest]
    .flatMap((p) => p.jobPostings ?? [])
    .filter((job) => job.title && job.externalPath)
    .map((job) => ({
      url: `https://${host}/${site}${job.externalPath}`,
      externalId: job.bulletFields?.[0] ?? null,
      title: job.title!,
      company: titleize(tenant),
      location: job.locationsText ?? null,
      description: null,
      postedAt: workdayPostedAt(job.postedOn),
    }));
}

interface WorkableAccount {
  name?: string;
  jobs?: Array<{
    title?: string;
    shortcode?: string;
    url?: string;
    application_url?: string;
    city?: string;
    state?: string;
    country?: string;
    telecommuting?: boolean;
    published_on?: string;
    created_at?: string;
    description?: string;
    employment_type?: string;
  }>;
}

async function readWorkable(board: BoardRef, http: HttpFetcher, options: ReadOptions): Promise<RawJob[]> {
  const slug = encodeURIComponent(board.slug);
  const data = await getJson<WorkableAccount>(http, `https://apply.workable.com/api/v1/widget/accounts/${slug}${options.descriptions ? "?details=true" : ""}`, options);
  return (data.jobs ?? [])
    .filter((job) => job.title && (job.url || job.shortcode))
    .map((job) => ({
      url: job.url ?? `https://apply.workable.com/${slug}/j/${job.shortcode}/`,
      externalId: job.shortcode ?? null,
      title: job.title!,
      company: data.name || titleize(board.slug),
      location: [job.city, job.state, job.country].filter(Boolean).join(", ") || null,
      description: job.description ?? null,
      applicationUrl: job.application_url ?? null,
      postedAt: validDate(job.published_on ?? job.created_at),
      workArrangement: job.telecommuting ? "REMOTE" : null,
    }));
}

interface SmartRecruitersList {
  content?: Array<{
    id?: string;
    name?: string;
    releasedDate?: string;
    company?: { name?: string; identifier?: string };
    location?: { city?: string; region?: string; country?: string; remote?: boolean; hybrid?: boolean; fullLocation?: string };
  }>;
}

async function readSmartRecruiters(board: BoardRef, http: HttpFetcher, options: ReadOptions): Promise<RawJob[]> {
  const company = encodeURIComponent(board.slug);
  const q = options.searchText ? `&q=${encodeURIComponent(options.searchText)}` : "";
  const data = await getJson<SmartRecruitersList>(http, `https://api.smartrecruiters.com/v1/companies/${company}/postings?limit=100${q}`, options);
  return (data.content ?? [])
    .filter((job) => job.id && job.name)
    .map((job) => {
      const loc = job.location;
      return {
        url: `https://jobs.smartrecruiters.com/${company}/${job.id}`,
        externalId: job.id!,
        title: job.name!,
        company: job.company?.name || titleize(board.slug),
        location: loc?.fullLocation ?? ([loc?.city, loc?.region, loc?.country?.toUpperCase()].filter(Boolean).join(", ") || null),
        description: null,
        postedAt: validDate(job.releasedDate),
        workArrangement: loc?.remote ? "REMOTE" : loc?.hybrid ? "HYBRID" : null,
      };
    });
}

interface RecruiteeOffers {
  offers?: Array<{
    id?: number;
    title?: string;
    careers_url?: string;
    careers_apply_url?: string;
    location?: string;
    remote?: boolean;
    description?: string;
    requirements?: string;
    published_at?: string;
    company_name?: string;
  }>;
}

async function readRecruitee(board: BoardRef, http: HttpFetcher, options: ReadOptions): Promise<RawJob[]> {
  const sub = board.slug.toLowerCase();
  const data = await getJson<RecruiteeOffers>(http, `https://${sub}.recruitee.com/api/offers/`, options);
  return (data.offers ?? [])
    .filter((job) => job.title && job.careers_url)
    .map((job) => ({
      url: job.careers_url!,
      externalId: job.id != null ? String(job.id) : null,
      title: job.title!,
      company: job.company_name || titleize(board.slug),
      location: job.location ?? null,
      description: [job.description, job.requirements].filter(Boolean).join("\n") || null,
      applicationUrl: job.careers_apply_url ?? null,
      postedAt: validDate(job.published_at),
      workArrangement: job.remote ? "REMOTE" : null,
    }));
}

const READERS: Record<BoardProvider, (board: BoardRef, http: HttpFetcher, options: ReadOptions) => Promise<RawJob[]>> = {
  greenhouse: readGreenhouse,
  lever: readLever,
  ashby: readAshby,
  workday: readWorkday,
  workable: readWorkable,
  smartrecruiters: readSmartRecruiters,
  recruitee: readRecruitee,
};

// ── Cache ───────────────────────────────────────────────────────────────────

/** Boards are re-read at most this often, so repeat searches come back almost instantly. */
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 1_000;
const caches = new WeakMap<HttpFetcher, Map<string, { at: number; jobs: RawJob[] }>>();

async function readBoard(board: BoardRef, http: HttpFetcher, options: ReadOptions): Promise<RawJob[]> {
  let cache = caches.get(http);
  if (!cache) caches.set(http, (cache = new Map()));
  // Only Greenhouse and Workable read differently with descriptions; the others always (or never) include them.
  if (board.provider !== "greenhouse" && board.provider !== "workable") options = { ...options, descriptions: false };
  const key = `${boardKey(board)}|${options.searchText ?? ""}|${options.descriptions}`;
  const hit = options.fresh ? undefined : cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.jobs;
  // Without descriptions, a cached read with them answers just as well.
  if (!options.descriptions && !options.fresh) {
    const full = cache.get(`${boardKey(board)}|${options.searchText ?? ""}|true`);
    if (full && Date.now() - full.at < CACHE_TTL_MS) return full.jobs;
  }
  const jobs = await READERS[board.provider](board, http, options);
  cache.delete(key);
  cache.set(key, { at: Date.now(), jobs });
  if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return jobs;
}

// ── Search ──────────────────────────────────────────────────────────────────

export interface BoardSearchInput {
  boards: BoardRef[];
  /** Keyword query: words and "phrases" must all appear; -word excludes. */
  query: string;
  /** Optional location filter, e.g. "New York" or "Remote". */
  location?: string | null;
  /** Match keywords in descriptions too, not just job titles. Exclusions always check the whole posting. */
  searchDescriptions?: boolean;
  /** Match postings with any included term instead of all of them (used for recommendation keywords). */
  matchAny?: boolean;
  /** Only return these postings (canonical or raw URLs), e.g. the ones the user picked from the results. */
  onlyUrls?: string[];
  /** Terms already split up, used instead of query (preference lists can be longer than a typed query). */
  terms?: KeywordQuery;
  /** Read every board afresh instead of from the recent-reads cache (scheduled alerts compare runs). */
  fresh?: boolean;
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

export function matchesLocation(job: RawJob, location: string): boolean {
  const wanted = location.trim();
  if (!wanted) return true;
  if (/^(remote|anywhere|work from home|wfh)$/i.test(wanted)) return job.workArrangement === "REMOTE" || mentionsKeyword(job.location ?? "", "remote");
  if (!job.location) return false;
  return job.location.toLowerCase().includes(wanted.toLowerCase()) || mentionsKeyword(job.location, wanted);
}

export function matchKeywords(job: RawJob, descriptionText: string, query: KeywordQuery, options: { searchDescriptions: boolean; matchAny: boolean }): BoardSearchHit["matchedIn"] | null {
  const heading = [job.title, job.company].filter(Boolean).join("\n");
  const everything = `${heading}\n${job.location ?? ""}\n${descriptionText}`;
  if (query.exclude.length && !matchesKeywordQuery(everything, { include: [], exclude: query.exclude })) return null;
  const includes = (text: string) =>
    !query.include.length || (options.matchAny ? query.include.some((t) => mentionsKeyword(text, t)) : matchesKeywordQuery(text, { include: query.include, exclude: [] }));
  if (includes(heading)) return "title";
  if (options.searchDescriptions && includes(everything)) return "description";
  return null;
}

export class BoardSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardSearchError";
  }
}

/** Board-level search options shared by the board search and the wide search. */
export interface BoardScanOptions {
  /** How many boards are read at once. */
  concurrency: number;
  /** Per-request time limit. */
  timeoutMs?: number;
}

/** Read the boards in parallel and keep the matching postings. Failures are reported per board. */
export async function scanBoards(boards: BoardRef[], input: Omit<BoardSearchInput, "boards">, http: HttpFetcher, scan: BoardScanOptions) {
  const query = input.terms ?? parseKeywordQuery(input.query);
  const only = input.onlyUrls ? new Set(input.onlyUrls.map(safeCanonical).filter(Boolean)) : null;
  const matchAny = input.matchAny ?? false;
  const searchDescriptions = input.searchDescriptions ?? false;
  const options: ReadOptions = {
    // A board's own search only helps when every term must appear; with "any", the whole list is read.
    searchText: !matchAny && query.include.length ? query.include.join(" ") : null,
    // Imports need descriptions; exclusions check the whole posting.
    descriptions: searchDescriptions || !!only || query.exclude.length > 0,
    timeoutMs: scan.timeoutMs,
    fresh: input.fresh,
  };
  const issues: ImportIssue[] = [];
  const perBoard = await mapConcurrent(boards, scan.concurrency, async (board) => {
    const summary = { key: boardKey(board), provider: board.provider, slug: board.slug, url: boardUrl(board), postings: 0, matches: 0, error: null as string | null };
    let postings: RawJob[];
    try {
      postings = await readBoard(board, http, options);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      summary.error = /not found/i.test(reason) ? "No public board found with this name." : /aborted|timeout/i.test(reason) ? "The board took too long to answer." : `Couldn't read this board (${reason}).`;
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
      const matchedIn = matchKeywords(job, text, query, { searchDescriptions, matchAny });
      if (!matchedIn) continue;
      hits.push({ ...job, title: job.title.slice(0, 200), company: job.company?.slice(0, 200) ?? null, location: job.location?.slice(0, 200) ?? null, description: job.description?.slice(0, 100_000) ?? null, provider: board.provider, board: board.slug, matchedIn });
    }
    summary.matches = hits.length;
    return { summary, hits };
  });
  return { hits: perBoard.flatMap((b) => b.hits), boards: perBoard.map((b) => b.summary), issues };
}

/** Title matches first, then the newest postings. */
export function byRelevance(a: { matchedIn: "title" | "description"; postedAt?: Date | null }, b: { matchedIn: "title" | "description"; postedAt?: Date | null }) {
  return a.matchedIn === b.matchedIn ? (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0) : a.matchedIn === "title" ? -1 : 1;
}

/** Search the given boards. Boards that fail are reported per board; the rest still return results. */
export async function searchJobBoards(input: BoardSearchInput, http: HttpFetcher = safeFetch): Promise<BoardSearchResult> {
  const query = parseKeywordQuery(input.query);
  if (!input.boards.length) throw new BoardSearchError("Add at least one job board to search.");
  if (isEmptyKeywordQuery(query) && !input.location?.trim()) throw new BoardSearchError("Enter keywords to search for.");
  if (input.boards.length > MAX_BOARDS_PER_SEARCH) throw new BoardSearchError(`Search up to ${MAX_BOARDS_PER_SEARCH} boards at a time.`);

  const { hits, boards, issues } = await scanBoards(input.boards, input, http, { concurrency: 8 });
  const all = hits.sort(byRelevance);
  if (all.length > MAX_BOARD_RESULTS) issues.push({ kind: "limit", message: `Showing the first ${MAX_BOARD_RESULTS} of ${all.length} matches. Add more keywords to narrow the search.` });
  return { jobs: all.slice(0, MAX_BOARD_RESULTS), totalMatches: all.length, boards, issues };
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
