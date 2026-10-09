import type { WorkArrangement } from "@autoapply/shared";
import { safeFetch, type HttpFetcher } from "../postings/safe-fetch";
import type { AggregatorHit } from "./aggregator";

/**
 * Free public job feeds searched alongside the company boards and JSearch:
 * - The Muse: US and international jobs by category, level and city. No key
 *   needed (500 requests an hour); THEMUSE_API_KEY raises that to 3,600.
 * - Himalayas and Jobicy: remote jobs. No key; both ask that listings link
 *   back to them and name them as the source, which the results do.
 * - Adzuna: a large aggregator of US job sites. Free, but needs an app id and
 *   key from developer.adzuna.com (ADZUNA_APP_ID and ADZUNA_APP_KEY).
 * Each feed is called through its documented API only. Answers are cached so
 * repeat searches don't spend the feeds' allowances.
 */

export const FEEDS = ["themuse", "himalayas", "jobicy", "adzuna"] as const;
export type FeedName = (typeof FEEDS)[number];

export const FEED_LABELS: Record<FeedName, string> = { themuse: "The Muse", himalayas: "Himalayas", jobicy: "Jobicy", adzuna: "Adzuna" };

export interface FeedKeys {
  theMuse?: string | null;
  adzuna?: { appId: string; appKey: string; country?: string } | null;
}

export interface FeedSearch {
  /** Words and phrases to look for. */
  terms: string[];
  /** Any term (true) or every term (false). */
  matchAny: boolean;
  location?: string | null;
  /** Preference or query terms, used to pick The Muse's categories and level. */
  hints?: string[];
}

export interface FeedStatus {
  feed: FeedName;
  label: string;
  status: "used" | "skipped" | "failed";
  /** Why a feed was skipped or failed, for notices. */
  reason?: string;
  found: number;
}

const TIMEOUT_MS = 8_000;
/** Jobicy asks for at most one pass an hour; the others are fine with less. */
const CACHE_TTL_MS: Record<FeedName, number> = { themuse: 30 * 60_000, himalayas: 30 * 60_000, jobicy: 60 * 60_000, adzuna: 60 * 60_000 };
const CACHE_MAX_ENTRIES = 500;
const caches = new WeakMap<HttpFetcher, Map<string, { at: number; value: unknown }>>();

async function getJson<T>(feed: FeedName, url: string, http: HttpFetcher, headers?: Record<string, string>): Promise<T> {
  let cache = caches.get(http);
  if (!cache) caches.set(http, (cache = new Map()));
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS[feed]) return hit.value as T;
  let text: string;
  try {
    text = (await http(url, { accept: "application/json", timeoutMs: TIMEOUT_MS, ...(headers ? { headers } : {}) })).text;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(/40[13]/.test(message) ? "the key was refused" : /429/.test(message) ? "its request limit was reached" : /aborted|timeout/i.test(message) ? "it took too long to answer" : message);
  }
  let value: T;
  try {
    value = JSON.parse(text) as T;
  } catch {
    throw new Error("its answer wasn't valid JSON");
  }
  cache.delete(url);
  cache.set(url, { at: Date.now(), value });
  if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return value;
}

const validDate = (value: string | number | null | undefined) => {
  if (value == null || value === "") return null;
  const date = new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const salary = (min: number | null | undefined, max: number | null | undefined, currency: string | null | undefined, period: string | null | undefined) => {
  if (!min && !max) return null;
  const range = [min, max].filter((n): n is number => !!n).map((n) => Math.round(n).toLocaleString("en-US"));
  return `${currency || "USD"} ${[...new Set(range)].join(" - ")}${period ? ` ${period}` : ""}`;
};

const isRemote = (location: string | null | undefined) => /^(remote|anywhere|work from home|wfh)$/i.test(location?.trim() ?? "");
const https = (url: string | null | undefined) => (url && /^https:\/\//i.test(url) ? url : null);

// ── The Muse ────────────────────────────────────────────────────────────────

/** The Muse has no text search, so terms pick its categories. */
const MUSE_CATEGORIES: Array<[RegExp, string[]]> = [
  [/\b(sales|account executive|business development|sdr|bdr|sales development|investment sales|technology sales)\b/i, ["Sales"]],
  [/\b(marketing|growth|brand|go-to-market|gtm|e-commerce|ecommerce|advertising)\b/i, ["Marketing", "Advertising and Marketing"]],
  [/\b(customer success|client success|account management|relationship management|client-facing|customer service)\b/i, ["Account Management", "Account Management/Customer Success"]],
  [/\b(operations|strategy|consulting|consultant|rotational|business analyst|partnerships|solutions)\b/i, ["Business Operations"]],
  [/\b(finance|financial|banking|investment|wealth management|trading|markets|fintech|accounting|analyst)\b/i, ["Accounting and Finance"]],
  [/\b(data|analytics|research|competitive intelligence)\b/i, ["Data and Analytics"]],
  [/\b(product)\b/i, ["Product Management"]],
  [/\b(real estate)\b/i, ["Real Estate"]],
  [/\b(software|engineer|engineering|developer)\b/i, ["Software Engineering"]],
  [/\b(design|ux)\b/i, ["Design and UX"]],
  [/\b(recruiting|recruiter|hr|human resources|people operations)\b/i, ["Human Resources and Recruitment"]],
  [/\b(project management|project manager|program manager)\b/i, ["Project Management"]],
  [/\b(pr|public relations|communications|media)\b/i, ["Media, PR, and Communications"]],
];

const MUSE_PLACES: Record<string, string> = {
  nyc: "New York, NY",
  "new york": "New York, NY",
  "new york city": "New York, NY",
  manhattan: "New York, NY",
  brooklyn: "New York, NY",
  sf: "San Francisco, CA",
  "san francisco": "San Francisco, CA",
  "bay area": "San Francisco, CA",
  la: "Los Angeles, CA",
  "los angeles": "Los Angeles, CA",
  boston: "Boston, MA",
  chicago: "Chicago, IL",
  austin: "Austin, TX",
  seattle: "Seattle, WA",
  denver: "Denver, CO",
  atlanta: "Atlanta, GA",
  dc: "Washington, DC",
  "washington dc": "Washington, DC",
  remote: "Flexible / Remote",
};

export function museQuery(search: FeedSearch): URLSearchParams | null {
  // The whole query too, since a typed search arrives as single words (account, executive).
  const words = [search.terms.join(" "), ...search.terms, ...(search.hints ?? [])];
  const categories = [...new Set(MUSE_CATEGORIES.filter(([pattern]) => words.some((w) => pattern.test(w))).flatMap(([, c]) => c))];
  if (!categories.length) return null;
  const params = new URLSearchParams({ descending: "true" });
  for (const c of categories.slice(0, 8)) params.append("category", c);
  if (words.some((w) => /\b(entry[\s-]level|new grad(uate)?|junior|early career)\b/i.test(w))) params.append("level", "Entry Level");
  if (words.some((w) => /\bintern(ship)?s?\b/i.test(w))) params.append("level", "Internship");
  const where = search.location?.trim();
  if (where) {
    const place = MUSE_PLACES[where.toLowerCase()] ?? (/^[^,]+,\s*[A-Z]{2}$/.test(where) ? where : null);
    if (place) params.append("location", place);
  }
  return params;
}

interface MuseJob {
  id?: number;
  name?: string;
  contents?: string;
  publication_date?: string;
  locations?: Array<{ name?: string }>;
  refs?: { landing_page?: string };
  company?: { name?: string };
}

/** Pages of 20, newest first. */
const MUSE_PAGES = 3;

async function searchMuse(search: FeedSearch, keys: FeedKeys, http: HttpFetcher): Promise<AggregatorHit[]> {
  const params = museQuery(search);
  if (!params) throw new SkipFeed("no matching category");
  if (keys.theMuse) params.set("api_key", keys.theMuse);
  const pages = await Promise.all(
    Array.from({ length: MUSE_PAGES }, (_, page) => {
      const p = new URLSearchParams(params);
      p.set("page", String(page));
      return getJson<{ results?: MuseJob[]; page_count?: number }>("themuse", `https://www.themuse.com/api/public/jobs?${p}`, http).catch((error: unknown) => {
        // Later pages past the end are fine to lose; the first page failing is the feed failing.
        if (page === 0) throw error;
        return { results: [] };
      });
    }),
  );
  const hits: AggregatorHit[] = [];
  for (const job of pages.flatMap((p) => p.results ?? [])) {
    const url = https(job.refs?.landing_page);
    if (!url || !job.name || !job.company?.name) continue;
    const location = (job.locations ?? []).map((l) => l.name).filter(Boolean).join("; ") || null;
    hits.push({
      url,
      externalId: job.id != null ? `muse-${job.id}` : null,
      title: job.name.slice(0, 200),
      company: job.company.name.slice(0, 200),
      location: location?.slice(0, 200) ?? null,
      description: job.contents?.slice(0, 100_000) ?? null,
      postedAt: validDate(job.publication_date),
      workArrangement: location && /remote/i.test(location) ? ("REMOTE" as WorkArrangement) : null,
      publishers: [FEED_LABELS.themuse],
    });
  }
  return hits;
}

// ── Himalayas (remote) ──────────────────────────────────────────────────────

interface HimalayasJob {
  title?: string;
  companyName?: string;
  description?: string;
  excerpt?: string;
  minSalary?: number | null;
  maxSalary?: number | null;
  currency?: string | null;
  salaryPeriod?: string | null;
  locationRestrictions?: string[];
  pubDate?: number;
  applicationLink?: string;
  guid?: string;
}

/** Separate requests for "any" searches, so each term gets its own results. */
const MAX_TERM_REQUESTS = 3;

function termQueries(search: FeedSearch): string[] {
  if (!search.terms.length) return [];
  return search.matchAny ? search.terms.slice(0, MAX_TERM_REQUESTS) : [search.terms.join(" ")];
}

const remoteLocation = (where: string[] | undefined) => (where?.length ? `Remote (${where.slice(0, 3).join(", ")})` : "Remote");

async function searchHimalayas(search: FeedSearch, http: HttpFetcher): Promise<AggregatorHit[]> {
  const queries = termQueries(search);
  if (!queries.length) throw new SkipFeed("nothing to search for");
  const answers = await Promise.all(queries.map((q) => getJson<{ jobs?: HimalayasJob[] }>("himalayas", `https://himalayas.app/jobs/api/search?${new URLSearchParams({ q, sort: "recent" })}`, http)));
  const hits: AggregatorHit[] = [];
  for (const job of answers.flatMap((a) => a.jobs ?? [])) {
    // Himalayas asks that listings link to its own page for the job.
    const url = https(job.guid) ?? https(job.applicationLink);
    if (!url || !job.title || !job.companyName) continue;
    hits.push({
      url,
      title: job.title.slice(0, 200),
      company: job.companyName.slice(0, 200),
      location: remoteLocation(job.locationRestrictions),
      description: (job.description ?? job.excerpt)?.slice(0, 100_000) ?? null,
      postedAt: validDate(job.pubDate),
      salaryText: salary(job.minSalary, job.maxSalary, job.currency, job.salaryPeriod === "annual" ? "per year" : job.salaryPeriod),
      workArrangement: "REMOTE" as WorkArrangement,
      publishers: [FEED_LABELS.himalayas],
    });
  }
  return hits;
}

// ── Jobicy (remote) ─────────────────────────────────────────────────────────

interface JobicyJob {
  id?: number;
  url?: string;
  jobTitle?: string;
  companyName?: string;
  jobGeo?: string;
  jobDescription?: string;
  jobExcerpt?: string;
  pubDate?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  salaryPeriod?: string | null;
}

async function searchJobicy(search: FeedSearch, http: HttpFetcher): Promise<AggregatorHit[]> {
  const queries = termQueries(search);
  if (!queries.length) throw new SkipFeed("nothing to search for");
  const answers = await Promise.all(queries.map((tag) => getJson<{ jobs?: JobicyJob[] }>("jobicy", `https://jobicy.com/api/v2/remote-jobs?${new URLSearchParams({ count: "50", tag })}`, http)));
  const hits: AggregatorHit[] = [];
  for (const job of answers.flatMap((a) => a.jobs ?? [])) {
    // Without a paid key, url is Jobicy's page for the job, which Jobicy asks listings to keep.
    const url = https(job.url);
    if (!url || !job.jobTitle || !job.companyName) continue;
    hits.push({
      url,
      externalId: job.id != null ? `jobicy-${job.id}` : null,
      title: job.jobTitle.slice(0, 200),
      company: job.companyName.slice(0, 200),
      location: remoteLocation(job.jobGeo ? [job.jobGeo] : undefined),
      description: (job.jobDescription ?? job.jobExcerpt)?.slice(0, 100_000) ?? null,
      postedAt: validDate(job.pubDate),
      salaryText: salary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod === "yearly" ? "per year" : job.salaryPeriod),
      workArrangement: "REMOTE" as WorkArrangement,
      publishers: [FEED_LABELS.jobicy],
    });
  }
  return hits;
}

// ── Adzuna ──────────────────────────────────────────────────────────────────

interface AdzunaJob {
  id?: string;
  title?: string;
  description?: string;
  redirect_url?: string;
  created?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  salary_min?: number | null;
  salary_max?: number | null;
  salary_is_predicted?: string | number;
}

/** Adzuna searches by place name, so nicknames are spelled out. */
const ADZUNA_PLACES: Record<string, string> = { nyc: "New York", "new york city": "New York", sf: "San Francisco", "bay area": "San Francisco", la: "Los Angeles", dc: "Washington DC" };

export function adzunaQuery(search: FeedSearch): URLSearchParams | null {
  if (!search.terms.length) return null;
  const params = new URLSearchParams({ results_per_page: "50", max_days_old: "30", sort_by: "date", "content-type": "application/json" });
  // what_or takes single words, so phrases are split; the results are checked against the real terms afterwards.
  if (search.matchAny) params.set("what_or", [...new Set(search.terms.slice(0, 10).flatMap((t) => t.toLowerCase().split(/[\s-]+/)))].join(" "));
  else params.set("what", search.terms.join(" "));
  const where = search.location?.trim();
  if (where && !isRemote(where)) params.set("where", ADZUNA_PLACES[where.toLowerCase()] ?? where);
  return params;
}

async function searchAdzuna(search: FeedSearch, keys: FeedKeys, http: HttpFetcher): Promise<AggregatorHit[]> {
  if (!keys.adzuna) throw new SkipFeed("no key");
  const params = adzunaQuery(search);
  if (!params) throw new SkipFeed("nothing to search for");
  const country = (keys.adzuna.country ?? "us").toLowerCase();
  const base = `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country)}/search/1?${params}`;
  const data = await getJson<{ results?: AdzunaJob[] }>("adzuna", `${base}&${new URLSearchParams({ app_id: keys.adzuna.appId, app_key: keys.adzuna.appKey })}`, http);
  const hits: AggregatorHit[] = [];
  for (const job of data.results ?? []) {
    const url = https(job.redirect_url);
    const company = job.company?.display_name;
    if (!url || !job.title || !company) continue;
    const predicted = job.salary_is_predicted === "1" || job.salary_is_predicted === 1;
    hits.push({
      url,
      externalId: job.id ? `adzuna-${job.id}` : null,
      title: job.title.replace(/<[^>]+>/g, "").slice(0, 200),
      company: company.slice(0, 200),
      location: job.location?.display_name?.slice(0, 200) ?? null,
      description: job.description?.slice(0, 100_000) ?? null,
      postedAt: validDate(job.created),
      // Adzuna estimates a salary when the posting has none; only real ones are shown.
      salaryText: predicted ? null : salary(job.salary_min, job.salary_max, "USD", "per year"),
      workArrangement: job.location?.display_name && /remote/i.test(job.location.display_name) ? ("REMOTE" as WorkArrangement) : null,
      publishers: [FEED_LABELS.adzuna],
    });
  }
  return hits;
}

// ── All feeds ───────────────────────────────────────────────────────────────

class SkipFeed extends Error {}

/** Search every feed that fits the search at once. A feed that fails is reported, never fatal. */
export async function searchFeeds(search: FeedSearch, keys: FeedKeys = {}, http: HttpFetcher = safeFetch): Promise<{ hits: AggregatorHit[]; feeds: FeedStatus[] }> {
  // Himalayas and Jobicy only list remote jobs, so a search in a city skips them.
  const remoteOk = !search.location?.trim() || isRemote(search.location);
  const runs: Array<[FeedName, () => Promise<AggregatorHit[]>]> = [
    ["themuse", () => searchMuse(search, keys, http)],
    ["himalayas", () => (remoteOk ? searchHimalayas(search, http) : Promise.reject(new SkipFeed("remote jobs only")))],
    ["jobicy", () => (remoteOk ? searchJobicy(search, http) : Promise.reject(new SkipFeed("remote jobs only")))],
    ["adzuna", () => searchAdzuna(search, keys, http)],
  ];
  const results = await Promise.all(
    runs.map(async ([feed, run]): Promise<{ status: FeedStatus; hits: AggregatorHit[] }> => {
      try {
        const hits = await run();
        return { status: { feed, label: FEED_LABELS[feed], status: "used", found: hits.length }, hits };
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown error";
        return { status: { feed, label: FEED_LABELS[feed], status: error instanceof SkipFeed ? "skipped" : "failed", reason, found: 0 }, hits: [] };
      }
    }),
  );
  return { hits: results.flatMap((r) => r.hits), feeds: results.map((r) => r.status) };
}
