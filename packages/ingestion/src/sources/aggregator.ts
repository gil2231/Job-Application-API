import type { WorkArrangement } from "@autoapply/shared";
import { safeFetch, type HttpFetcher } from "../postings/safe-fetch";
import type { RawJob } from "../types";

/**
 * One licensed aggregator feed: JSearch (by OpenWeb Ninja, on RapidAPI) returns
 * listings from Google for Jobs, which include LinkedIn, Indeed, Glassdoor,
 * ZipRecruiter and company career sites. Applyance only calls JSearch's API with
 * the operator's key; it never visits LinkedIn or any of those sites itself.
 * Without JSEARCH_API_KEY the wide search simply runs without it.
 */

export const AGGREGATOR_NAME = "JSearch";
const HOST = "jsearch.p.rapidapi.com";

export interface AggregatorHit extends RawJob {
  /** Where the listing is posted, e.g. ["LinkedIn", "Indeed", "Acme Careers"]. */
  publishers: string[];
}

interface JSearchJob {
  job_id?: string;
  employer_name?: string;
  job_publisher?: string;
  job_title?: string;
  job_apply_link?: string;
  job_apply_is_direct?: boolean;
  apply_options?: Array<{ publisher?: string; apply_link?: string; is_direct?: boolean }>;
  job_description?: string;
  job_is_remote?: boolean;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_location?: string;
  job_posted_at_datetime_utc?: string;
  job_min_salary?: number | null;
  job_max_salary?: number | null;
  job_salary_currency?: string | null;
  job_salary_period?: string | null;
}

/** Sites whose pages Applyance never fetches; a listing's direct company link is preferred over them. */
const NEVER_FETCHED = /(^|\.)(linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com|joinhandshake\.com)$/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** The best link for a listing: the company's own posting when JSearch knows it. */
function bestLink(job: JSearchJob): string | null {
  const options = (job.apply_options ?? []).filter((o) => o.apply_link && /^https:\/\//i.test(o.apply_link));
  const direct = options.find((o) => o.is_direct) ?? options.find((o) => !NEVER_FETCHED.test(hostOf(o.apply_link!)));
  if (direct) return direct.apply_link!;
  return job.job_apply_link && /^https:\/\//i.test(job.job_apply_link) ? job.job_apply_link : (options[0]?.apply_link ?? null);
}

const PERIOD: Record<string, string> = { YEAR: "per year", MONTH: "per month", WEEK: "per week", HOUR: "per hour" };

export class AggregatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AggregatorError";
  }
}

/** The same search within this time reuses the last answer, so repeat searches don't spend the plan's requests. */
const CACHE_TTL_MS = 60 * 60_000;
const CACHE_MAX_ENTRIES = 200;
const caches = new WeakMap<HttpFetcher, Map<string, { at: number; hits: AggregatorHit[] }>>();

/** Search JSearch for the query. One request (about 10 listings), so the free plan's allowance lasts. */
export async function searchAggregator(input: { query: string; location?: string | null; remoteOnly?: boolean }, apiKey: string, http: HttpFetcher = safeFetch): Promise<AggregatorHit[]> {
  const where = input.location?.trim() && !/^remote$/i.test(input.location.trim()) ? ` in ${input.location.trim()}` : "";
  const params = new URLSearchParams({ query: `${input.query}${where}`.slice(0, 300), page: "1", num_pages: "1", date_posted: "month" });
  if (input.remoteOnly || /^remote$/i.test(input.location?.trim() ?? "")) params.set("work_from_home", "true");
  let cache = caches.get(http);
  if (!cache) caches.set(http, (cache = new Map()));
  const cacheKey = `${apiKey.slice(0, 8)}|${params}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.hits;
  const hits = await fetchAggregator(params, apiKey, http);
  cache.delete(cacheKey);
  cache.set(cacheKey, { at: Date.now(), hits });
  if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return hits;
}

async function fetchAggregator(params: URLSearchParams, apiKey: string, http: HttpFetcher): Promise<AggregatorHit[]> {
  let text: string;
  try {
    const response = await http(`https://${HOST}/search?${params}`, {
      accept: "application/json",
      headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": HOST },
      timeoutMs: 10_000,
    });
    text = response.text;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new AggregatorError(/40[13]/.test(message) ? "the JSearch key was refused" : /429/.test(message) ? "the JSearch plan's limit was reached" : message);
  }
  let data: { data?: JSearchJob[] };
  try {
    data = JSON.parse(text) as { data?: JSearchJob[] };
  } catch {
    throw new AggregatorError("JSearch's answer wasn't valid JSON");
  }
  const hits: AggregatorHit[] = [];
  for (const job of data.data ?? []) {
    const url = bestLink(job);
    if (!url || !job.job_title || !job.employer_name) continue;
    const location = job.job_location || [job.job_city, job.job_state, job.job_country].filter(Boolean).join(", ") || null;
    const posted = job.job_posted_at_datetime_utc ? new Date(job.job_posted_at_datetime_utc) : null;
    const salary =
      job.job_min_salary != null || job.job_max_salary != null
        ? `${job.job_salary_currency ?? "USD"} ${[job.job_min_salary, job.job_max_salary].filter((n) => n != null).map((n) => n!.toLocaleString("en-US")).join(" - ")} ${PERIOD[job.job_salary_period ?? "YEAR"] ?? ""}`.trim()
        : null;
    const publishers = [...new Set([job.job_publisher, ...(job.apply_options ?? []).map((o) => o.publisher)].filter((p): p is string => !!p))];
    hits.push({
      url,
      externalId: job.job_id ?? null,
      title: job.job_title.slice(0, 200),
      company: job.employer_name.slice(0, 200),
      location: location?.slice(0, 200) ?? null,
      description: job.job_description?.slice(0, 100_000) ?? null,
      postedAt: posted && !Number.isNaN(posted.getTime()) ? posted : null,
      salaryText: salary,
      workArrangement: job.job_is_remote ? ("REMOTE" as WorkArrangement) : null,
      publishers: publishers.slice(0, 6),
    });
  }
  return hits;
}
