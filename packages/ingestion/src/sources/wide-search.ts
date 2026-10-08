import { htmlToText } from "@autoapply/ai";
import { canonicalizeJobUrl, isEmptyKeywordQuery, locationMatchesPlace, parseKeywordQuery, type KeywordQuery } from "@autoapply/shared";
import { jobFingerprint } from "../pipeline";
import { safeFetch, type HttpFetcher } from "../postings/safe-fetch";
import type { ImportIssue, RawJob } from "../types";
import { AGGREGATOR_NAME, AggregatorError, searchAggregator } from "./aggregator";
import { DIRECTORY_BOARDS } from "./board-directory";
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
 * company boards, the user's own boards and (with a key) the JSearch feed, all
 * at once. Boards are read in parallel with a short time limit, and recently
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
}

export interface WideSearchHit extends RawJob {
  matchedIn: BoardSearchHit["matchedIn"];
  /** Everywhere this job was found, e.g. ["Greenhouse", "LinkedIn", "Indeed"]. */
  sources: string[];
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

  const aggregatorQuery = query.include.slice(0, 20).join(" ");
  const aggregatorRun: Promise<{ status: "used" | "no_key" | "failed"; error?: string; hits: RawJob[] & Array<{ publishers: string[] }> }> =
    !input.aggregatorKey || !aggregatorQuery
      ? Promise.resolve({ status: "no_key" as const, hits: [] })
      : searchAggregator({ query: input.matchAny ? query.include.slice(0, 3).join(" OR ") : aggregatorQuery, location: input.location }, input.aggregatorKey, http)
          .then((hits) => ({ status: "used" as const, hits }))
          .catch((error: unknown) => ({ status: "failed" as const, error: error instanceof AggregatorError ? error.message : "unknown error", hits: [] }));

  const [scan, aggregator] = await Promise.all([scanBoards([...own, ...directory], input, http, { concurrency: CONCURRENCY, timeoutMs: BOARD_TIMEOUT_MS }), aggregatorRun]);

  // The aggregator searches loosely; hold its listings to the same keyword and location rules.
  const aggregatorHits: WideSearchHit[] = [];
  for (const job of aggregator.hits) {
    if (input.location && !matchesLocation(job, input.location)) continue;
    const matchedIn = matchKeywords(job, job.description ? htmlToText(job.description) : "", query, { searchDescriptions: input.searchDescriptions ?? false, matchAny: input.matchAny ?? false });
    if (!matchedIn) continue;
    const { publishers, ...raw } = job;
    aggregatorHits.push({ ...raw, matchedIn, sources: publishers.length ? publishers : [AGGREGATOR_NAME] });
  }

  // Company boards come first, so a job also listed on LinkedIn or Indeed keeps the company's own link.
  const merged: WideSearchHit[] = [];
  const byKey = new Map<string, WideSearchHit>();
  const boardHits = scan.hits.map(({ provider, board: _board, ...job }): WideSearchHit => ({ ...job, sources: [BOARD_PROVIDER_LABELS[provider]] }));
  for (const job of [...boardHits, ...aggregatorHits]) {
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

  const places = input.preferPlaces ?? [];
  const inPlace = (job: WideSearchHit) => (places.some((p) => locationMatchesPlace(job.location, p)) ? 0 : 1);
  const all = merged.sort((a, b) => inPlace(a) - inPlace(b) || byRelevance(a, b));
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
    issues,
    tookMs: Date.now() - started,
  };
}
