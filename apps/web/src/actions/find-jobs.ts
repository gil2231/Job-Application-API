"use server";

import { revalidatePath } from "next/cache";
import { audit, findKnownJobUrls, getSavedBoardSearch, getSearchPreferences, saveSearchPreferences } from "@autoapply/database";
import { BoardSearchError, foundJobsSource, parseBoardList, runImport, safeFetch, searchEverywhere, type WideSearchInput, type WideSearchResult } from "@autoapply/ingestion";
import { canonicalizeJobUrl, foundJobsSchema, jobFinderSchema, parsePreferences, searchPreferencesSchema, splitPreferences, type JobFinderInput } from "@autoapply/shared";
import { authedAction, formToObject, validationFailed, type ActionResult } from "@/lib/action";
import { FAKE_DIRECTORY, fakeJobSources } from "@/lib/fake-job-sources";
import { analyzeInBackground } from "@/lib/pipeline";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import type { ImportResultData } from "./ingestion";

export interface FoundJobRow {
  url: string;
  title: string;
  company: string;
  location: string | null;
  postedAt: string | null;
  salaryText: string | null;
  workArrangement: string | null;
  /** Everywhere the job was found, e.g. ["Greenhouse", "LinkedIn"]. */
  sources: string[];
  matchedIn: "title" | "description";
  /** new: not in the list yet; in_list: already saved; removed: deleted earlier, so it won't be re-added. */
  known: "new" | "in_list" | "removed";
}

export interface FoundJobsData {
  results: FoundJobRow[];
  totalMatches: number;
  /** Problems with boards the user listed themselves, and other notes. */
  notices: string[];
  boardsSearched: number;
  seconds: number;
}

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

/** Stand-in boards for end-to-end tests and demos; never in production. */
const fake = process.env.E2E_FAKE_JOB_SOURCES === "1" && process.env.NODE_ENV !== "production";

function sources(): { http: typeof safeFetch; directory?: readonly string[]; aggregatorKey: string | null } {
  if (fake) return { http: fakeJobSources, directory: FAKE_DIRECTORY, aggregatorKey: "fake" };
  return { http: safeFetch, aggregatorKey: process.env.JSEARCH_API_KEY?.trim() || null };
}

async function runSearch(userId: string, input: Omit<WideSearchInput, "directory" | "aggregatorKey" | "boards"> & { aggregator: boolean }) {
  const { http, directory, aggregatorKey } = sources();
  const saved = await getSavedBoardSearch(userId);
  const boards = parseBoardList((saved?.boards ?? []).join("\n")).boards;
  return searchEverywhere({ ...input, boards, directory, aggregatorKey: input.aggregator ? aggregatorKey : null }, http);
}

async function toData(userId: string, result: WideSearchResult): Promise<FoundJobsData> {
  const canonical = result.jobs.map((j) => {
    try {
      return canonicalizeJobUrl(j.url);
    } catch {
      return j.url;
    }
  });
  const known = await findKnownJobUrls(userId, canonical);
  const notices = [
    ...result.userBoardErrors.map((b) => `${b.label}: ${b.error}`),
    ...result.issues.filter((i) => i.kind === "limit").map((i) => i.message),
    ...(result.aggregator.status === "failed" ? [`LinkedIn and Indeed listings weren't included this time: ${result.aggregator.error}.`] : []),
  ];
  return {
    results: result.jobs.map((j, i): FoundJobRow => {
      const k = known.get(canonical[i]!);
      return {
        url: j.url,
        title: j.title ?? "Untitled job",
        company: j.company ?? "Unknown company",
        location: j.location ?? null,
        postedAt: j.postedAt?.toISOString() ?? null,
        salaryText: j.salaryText ?? null,
        workArrangement: j.workArrangement ?? null,
        sources: j.sources,
        matchedIn: j.matchedIn,
        known: !k ? "new" : k.removed ? "removed" : "in_list",
      };
    }),
    totalMatches: result.totalMatches,
    notices,
    boardsSearched: result.boardsSearched,
    seconds: Math.max(0.1, Math.round(result.tookMs / 100) / 10),
  };
}

/** The Jobs page search bar: every company board, the user's own boards and, with a key, LinkedIn and Indeed listings via JSearch. */
export async function findJobsAction(input: JobFinderInput): Promise<ActionResult<FoundJobsData>> {
  return authedAction<FoundJobsData>(async (user) => {
    const parsed = jobFinderSchema.safeParse(input);
    if (!parsed.success) return validationFailed(parsed.error);
    if (!parsed.data.query && !parsed.data.location) return { ok: false, message: "Type a job title or keywords to search for", errors: { query: "Type a job title or keywords to search for" } };
    const limit = await rateLimit(`board-search:${user.id}`, LIMITS.boardSearch.limit, LIMITS.boardSearch.windowMs);
    if (!limit.allowed) return { ok: false, message: `Search limit reached. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.` };
    let result: WideSearchResult;
    try {
      result = await runSearch(user.id, { query: parsed.data.query, location: parsed.data.location ?? null, aggregator: true });
    } catch (error) {
      if (error instanceof BoardSearchError) return { ok: false, message: error.message, errors: { query: error.message } };
      throw error;
    }
    const data = await toData(user.id, result);
    return { ok: true, message: `Found ${plural(result.totalMatches, "job")} across ${plural(result.boardsAnswered, "job board")}${result.aggregator.status === "used" ? ", LinkedIn, Indeed and more" : ""}.`, data };
  });
}

/** New openings that fit the user's preferences, shown under the search bar. Company boards only, so it costs no JSearch requests. */
export async function recommendedOpeningsAction(): Promise<ActionResult<FoundJobsData>> {
  return authedAction<FoundJobsData>(async (user) => {
    const { text } = await getSearchPreferences(user.id);
    const { keywords, places } = splitPreferences(parsePreferences(text));
    if (!keywords.length) return { ok: true, data: { results: [], totalMatches: 0, notices: [], boardsSearched: 0, seconds: 0 } };
    const limit = await rateLimit(`recommended-openings:${user.id}`, LIMITS.boardSearch.limit * 2, LIMITS.boardSearch.windowMs);
    if (!limit.allowed) return { ok: false, message: "New openings refresh again in a few minutes." };
    const result = await runSearch(user.id, { query: "", terms: { include: keywords, exclude: [] }, matchAny: true, preferPlaces: places, aggregator: false });
    const data = await toData(user.id, result);
    // Only openings not already in the list; the saved ones are recommended above.
    data.results = data.results.filter((r) => r.known === "new").slice(0, 50);
    return { ok: true, data };
  });
}

/** Add the picked search results to the list. Each posting is read again for its full description where its site allows. */
export async function addFoundJobsAction(input: { jobs: Array<Pick<FoundJobRow, "url" | "title" | "company" | "location" | "postedAt" | "salaryText" | "workArrangement">> }): Promise<ActionResult<ImportResultData>> {
  return authedAction<ImportResultData>(async (user) => {
    const parsed = foundJobsSchema.safeParse(input);
    if (!parsed.success) return validationFailed(parsed.error);
    const limit = await rateLimit(`import:${user.id}`, LIMITS.jobImport.limit, LIMITS.jobImport.windowMs);
    if (!limit.allowed) return { ok: false, message: `Import limit reached. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.` };
    const summary = await runImport(user.id, foundJobsSource, { jobs: parsed.data.jobs }, fake ? { context: { fetchPosting: async () => null } } : {});
    await audit(user.id, "jobs.imported", { entityType: "JobImport", entityId: summary.importId, metadata: { source: "job_search", created: summary.created, duplicates: summary.duplicates } });
    if (summary.created || summary.enrichedJobIds.length) analyzeInBackground(user.id);
    revalidatePath("/jobs");
    revalidatePath("/dashboard");
    const parts = [`Added ${plural(summary.created, "new job")}`];
    if (summary.duplicates) parts.push(`${summary.duplicates} already in your list`);
    if (summary.skipped) parts.push(`${summary.skipped} previously removed`);
    return {
      ok: summary.created > 0 || summary.duplicates > 0,
      message: `${parts.join(", ")}.`,
      data: { created: summary.created, duplicates: summary.duplicates, skipped: summary.skipped, failed: summary.failed, needsDetails: summary.needsDetails, issues: summary.issues.slice(0, 100) },
    };
  });
}

export async function saveSearchPreferencesAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return authedAction(async (user) => {
    const parsed = searchPreferencesSchema.safeParse(formToObject(formData));
    if (!parsed.success) return validationFailed(parsed.error);
    const terms = parsePreferences(parsed.data.preferences);
    const text = terms.join(", ");
    await saveSearchPreferences(user.id, text);
    await audit(user.id, "recommendations.preferences_updated", { entityType: "MasterProfile", metadata: { terms: terms.length } });
    revalidatePath("/jobs");
    return { ok: true, message: terms.length ? `Preferences saved (${plural(terms.length, "term")}). Recommendations updated.` : "Preferences cleared. Recommendations now use your match score only." };
  });
}
