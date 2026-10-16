import "server-only";
import { getSavedBoardSearch, getSearchPreferences } from "@autoapply/database";
import { parseBoardList, safeFetch, searchEverywhere, type FeedKeys, type WideSearchInput, type WideSearchResult } from "@autoapply/ingestion";
import { isSeniorTitle, parsePreferences, splitPreferences, wantsEarlyCareer } from "@autoapply/shared";
import { FAKE_DIRECTORY, fakeJobSources } from "./fake-job-sources";

/** Stand-in boards for end-to-end tests and demos; never in production. */
export const usingFakeJobSources = process.env.E2E_FAKE_JOB_SOURCES === "1" && process.env.NODE_ENV !== "production";

function feedKeys(): FeedKeys {
  const appId = process.env.ADZUNA_APP_ID?.trim();
  const appKey = process.env.ADZUNA_APP_KEY?.trim();
  return {
    theMuse: process.env.THEMUSE_API_KEY?.trim() || null,
    adzuna: appId && appKey ? { appId, appKey, country: process.env.ADZUNA_COUNTRY?.trim() || "us" } : null,
  };
}

function sources(): { http: typeof safeFetch; directory?: readonly string[]; aggregatorKey: string | null; feeds: FeedKeys } {
  if (usingFakeJobSources) return { http: fakeJobSources, directory: FAKE_DIRECTORY, aggregatorKey: "fake", feeds: { adzuna: { appId: "fake", appKey: "fake" } } };
  return { http: safeFetch, aggregatorKey: process.env.JSEARCH_API_KEY?.trim() || null, feeds: feedKeys() };
}

/** The user's preferences, split into roles and keywords versus places. */
export async function preferencesOf(userId: string) {
  const { text } = await getSearchPreferences(userId);
  const terms = parsePreferences(text);
  return { terms, ...splitPreferences(terms) };
}

/** Search every company board, the user's own boards, the free feeds and (with a key, when asked) JSearch. */
export async function runSearch(userId: string, input: Omit<WideSearchInput, "directory" | "aggregatorKey" | "boards" | "feeds"> & { aggregator: boolean }) {
  const { http, directory, aggregatorKey, feeds } = sources();
  const saved = await getSavedBoardSearch(userId);
  const boards = parseBoardList((saved?.boards ?? []).join("\n")).boards;
  return searchEverywhere({ ...input, boards, directory, aggregatorKey: input.aggregator ? aggregatorKey : null, feeds }, http);
}

/**
 * Openings that fit the user's saved preferences: a preference in the title,
 * ranked by how many they fit, in a preferred place when the preferences name
 * any. Null when the preferences name no roles or keywords.
 */
export async function searchOpenings(userId: string): Promise<WideSearchResult | null> {
  const prefs = await preferencesOf(userId);
  const { keywords, places } = prefs;
  if (!keywords.length) return null;
  const city = places.find((p) => p.toLowerCase() !== "remote") ?? places[0] ?? null;
  const result = await runSearch(userId, {
    query: "",
    terms: { include: keywords, exclude: [] },
    matchAny: true,
    preferences: prefs,
    onlyPreferredPlaces: true,
    searchNear: city,
    feedHints: prefs.terms,
    aggregator: true,
  });
  // Someone looking for entry-level or new-graduate jobs doesn't want the Director and Senior Manager openings "Sales" also finds.
  if (wantsEarlyCareer(prefs.terms)) result.jobs = result.jobs.filter((j) => !isSeniorTitle(j.title ?? ""));
  return result;
}
