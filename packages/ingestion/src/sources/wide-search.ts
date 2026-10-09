import { htmlToText } from "@autoapply/ai";
import { canonicalizeJobUrl, isEmptyKeywordQuery, locationMatchesPlace, parseKeywordQuery, preferenceFit, type KeywordQuery } from "@autoapply/shared";
import { jobFingerprint } from "../pipeline";
import { safeFetch, type HttpFetcher } from "../postings/safe-fetch";
import type { ImportIssue, RawJob } from "../types";
import { AGGREGATOR_NAME, AggregatorError, searchAggregator, type AggregatorHit } from "./aggregator";
import { DIRECTORY_BOARDS } from "./board-directory";
import { searchFeeds, type FeedKeys, type FeedStatus } from "./feeds";
import {
  BOARD_PROVIDER_LABELS,
  BoardSearchError,
  boardKey,
  byRelevance,
  matchesLocation,
  matchKeywords,
  MAX_BOARD_RESULTS,
  parseBoardList,
  scanBoards,
  type BoardRef,
  type BoardSearchHit,
} from "./job-boards";

/**
 * The wide search behind the Jobs page search bar: the built-in directory of
 * company boards, the user's own boards, the free job feeds (The Muse,
 * Himalayas, Jobicy, and Adzuna with a key) and (with a key) the JSearch feed,
 * all at once. Boards are read in parallel with a short time limit, and recently
 * read boards come from a cache, so a search answers in seconds. The same job
 * found in several places is listed once, with every place it was found.
 */

export interface WideSearchInput {
  /** Keyword query: words and "phrases" must all appear (or any, with matchAny); -word excludes. */
  query: string;
  location?: string | null;
  matchAny?: boolean;
  searchDescriptions?: boolean;
  /** The user's own boards, searched alongside the directory. */
  boards?: BoardRef[];
  /** Boards searched by default, as "provider:board" lines. */
  directory?: readonly string[];
  /** JSearch key; without one the aggregator is skipped. */
  aggregatorKey?: string | null;
  /** Terms already split up, used instead of query (a preference list can have more terms than a typed query). */
  terms?: KeywordQuery;
  /** Places the user prefers (e.g. NYC): jobs there are listed first. */
  preferPlaces?: string[];
  /** The user's preferences: jobs that fit more of them are listed first. */
  preferences?: { keywords: string[]; places: string[] };
  /** Only list jobs in the preferred places (when any job is in one). */
  onlyPreferredPlaces?: boolean;
  /** Keys for the free feeds; null skips the feeds altogether. */
  feeds?: FeedKeys | null;
  /** Where JSearch and the feeds look when no location is given (results aren't held to it). */
  searchNear?: string | null;
  /** Preference terms that help the feeds pick categories, e.g. "Entry Level". */
  feedHints?: string[];
}

export interface WideSearchHit extends RawJob {
  matchedIn: BoardSearchHit["matchedIn"];
  /** Everywhere this job was found, e.g. ["Greenhouse", "LinkedIn", "Indeed"]. */
  sources: string[];
  /** The user's preferences this job fits, e.g. ["Account Executive", "FinTech", "NYC"]. */
  fits: string[];
}

export interface WideSearchResult {
  jobs: WideSearchHit[];
  totalMatches: number;
  /** Boards read and how many answered. */
  boardsSearched: number;
  boardsAnswered: number;
  /** Problems with boards the user listed themselves (directory boards that fail are skipped quietly). */
  userBoardErrors: Array<{ url: string; label: string; error: string }>;
  aggregator: { status: "used" | "no_key" | "failed"; error?: string; matches: number };
  feeds: FeedStatus[];
  issues: ImportIssue[];
  tookMs: number;
}

/** Boards read at once, and how long each may take. */
const CONCURRENCY = 32;
const BOARD_TIMEOUT_MS = 8_000;

function dedupeKeys(job: RawJob): string[] {
  const keys: string[] = [];
  try {
    keys.push(`url:${canonicalizeJobUrl(job.url)}`);
  } catch {
    // Not a URL we can normalize; the fingerprint still dedupes it.
  }
  const fingerprint = job.company && job.title ? jobFingerprint(job.company, job.title) : null;
  if (fingerprint) {
    // The same title at the same company in another city is a different opening.
    const city = (job.location ?? "").toLowerCase().split(/[,;/|(]/)[0]!.replace(/[^a-z]+/g, " ").trim();
    keys.push(`fp:${fingerprint}|${city}`);
  }
  return keys;
}

export async function searchEverywhere(input: WideSearchInput, http: HttpFetcher = safeFetch): Promise<WideSearchResult> {
  const started = Date.now();
  const query = input.terms ?? parseKeywordQuery(input.query);
  if (isEmptyKeywordQuery(query) && !input.location?.trim()) throw new BoardSearchError("Enter a job title or keywords to search for.");

  const own = input.boards ?? [];
  const ownKeys = new Set(own.map(boardKey));
  const directory = parseBoardList((input.directory ?? DIRECTORY_BOARDS).join("\n")).boards.filter((b) => !ownKeys.has(boardKey(b)));

  // Without a location typed, the outside sources still look near the preferred place.
  const near = input.location?.trim() || input.searchNear?.trim() || null;
  const aggregatorQuery = query.include.slice(0, 20).join(" ");
  const aggregatorRun: Promise<{ status: "used" | "no_key" | "failed"; error?: string; hits: AggregatorHit[] }> =
    !input.aggregatorKey || !aggregatorQuery
      ? Promise.resolve({ status: "no_key" as const, hits: [] })
      : searchAggregator({ query: input.matchAny ? query.include.slice(0, 3).join(" OR ") : aggregatorQuery, location: near }, input.aggregatorKey, http)
          .then((hits) => ({ status: "used" as const, hits }))
          .catch((error: unknown) => ({ status: "failed" as const, error: error instanceof AggregatorError ? error.message : "unknown error", hits: [] }));

  const feedRun = input.feeds
    ? searchFeeds({ terms: query.include, matchAny: input.matchAny ?? false, location: near, hints: input.feedHints }, input.feeds, http)
    : Promise.resolve({ hits: [], feeds: [] as FeedStatus[] });

  const [scan, aggregator, feeds] = await Promise.all([scanBoards([...own, ...directory], input, http, { concurrency: CONCURRENCY, timeoutMs: BOARD_TIMEOUT_MS }), aggregatorRun, feedRun]);

  // The aggregator and feeds search loosely; hold their listings to the same keyword and location rules.
  const looseHits = (jobs: AggregatorHit[], fallback: string) => {
    const kept: WideSearchHit[] = [];
    for (const job of jobs) {
      if (input.location && !matchesLocation(job, input.location)) continue;
      const matchedIn = matchKeywords(job, job.description ? htmlToText(job.description) : "", query, { searchDescriptions: input.searchDescriptions ?? false, matchAny: input.matchAny ?? false });
      if (!matchedIn) continue;
      const { publishers, ...raw } = job;
      kept.push({ ...raw, matchedIn, sources: publishers.length ? publishers : [fallback], fits: [] });
    }
    return kept;
  };
  const aggregatorHits = looseHits(aggregator.hits, AGGREGATOR_NAME);
  const feedHits = looseHits(feeds.hits, "Job feed");

  // Company boards come first, so a job also listed on LinkedIn or Indeed keeps the company's own link.
  const merged: WideSearchHit[] = [];
  const byKey = new Map<string, WideSearchHit>();
  const boardHits = scan.hits.map(({ provider, board: _board, ...job }): WideSearchHit => ({ ...job, sources: [BOARD_PROVIDER_LABELS[provider]], fits: [] }));
  for (const job of [...boardHits, ...aggregatorHits, ...feedHits]) {
    const keys = dedupeKeys(job);
    const existing = keys.map((k) => byKey.get(k)).find(Boolean);
    if (existing) {
      for (const source of job.sources) if (!existing.sources.includes(source)) existing.sources.push(source);
      existing.description ??= job.description;
      existing.salaryText ??= job.salaryText;
      if (job.matchedIn === "title") existing.matchedIn = "title";
      for (const k of keys) byKey.set(k, existing);
      continue;
    }
    merged.push(job);
    for (const k of keys) byKey.set(k, job);
  }

  const prefs = input.preferences ?? { keywords: [], places: input.preferPlaces ?? [] };
  const places = [...new Set([...prefs.places, ...(input.preferPlaces ?? [])])];
  const score = new Map<WideSearchHit, { inPlace: number; fit: number }>();
  for (const job of merged) {
    const fit = preferenceFit(
      { title: job.title, company: job.company, location: job.location, description: job.description ? htmlToText(job.description) : null, remote: job.workArrangement === "REMOTE" },
      { keywords: prefs.keywords, places },
    );
    job.fits = [...fit.matched, ...fit.places];
    score.set(job, { inPlace: fit.places.length || places.some((p) => locationMatchesPlace(job.location, p)) ? 0 : 1, fit: fit.score });
  }
  let all = merged.sort((a, b) => score.get(a)!.inPlace - score.get(b)!.inPlace || score.get(b)!.fit - score.get(a)!.fit || byRelevance(a, b));
  // Only jobs in the preferred places, unless none are (then the rest still beat an empty list).
  if (input.onlyPreferredPlaces && places.length && all.some((j) => score.get(j)!.inPlace === 0)) all = all.filter((j) => score.get(j)!.inPlace === 0);
  const ownSummaries = scan.boards.filter((b) => ownKeys.has(b.key));
  const ownUrls = new Set(ownSummaries.map((b) => b.url));
  const issues = scan.issues.filter((i) => i.url && ownUrls.has(i.url));
  if (all.length > MAX_BOARD_RESULTS) issues.push({ kind: "limit", message: `Showing the first ${MAX_BOARD_RESULTS} of ${all.length} matches. Add keywords or a location to narrow the search.` });
  return {
    jobs: all.slice(0, MAX_BOARD_RESULTS),
    totalMatches: all.length,
    boardsSearched: scan.boards.length,
    boardsAnswered: scan.boards.filter((b) => !b.error).length,
    userBoardErrors: ownSummaries.filter((b) => b.error).map((b) => ({ url: b.url, label: `${BOARD_PROVIDER_LABELS[b.provider]} · ${b.slug}`, error: b.error! })),
    aggregator: { status: aggregator.status, error: aggregator.error, matches: aggregatorHits.length },
    feeds: feeds.feeds.map((f) => ({ ...f, found: feedHits.filter((j) => j.sources.includes(f.label)).length })),
    issues,
    tookMs: Date.now() - started,
  };
}
