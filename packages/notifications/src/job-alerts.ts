import {
  claimJobAlertRun,
  findJobAlertCandidates,
  findKnownJobUrls,
  findSeenMatchUrls,
  getAlertRecipient,
  listAlertSearchesForUser,
  recordNotification,
  recordSavedSearchFailure,
  recordSavedSearchRun,
  type SavedSearchRow,
  type SearchMatchInput,
} from "@autoapply/database";
import { parseBoardList, safeFetch, searchJobBoards, type HttpFetcher } from "@autoapply/ingestion";
import { canonicalizeJobUrl } from "@autoapply/shared";
import type { EmailSender } from "./email";
import { appUrl, unsubscribeHeaders, unsubscribeUrl } from "./links";
import { jobAlertEmail, MAX_POSTINGS_PER_SEARCH_EMAIL, type JobAlertSection } from "./templates";
import { localDateHour } from "./time";

export interface SavedSearchRunResult {
  /** Postings this run found for the first time that the user doesn't already have. */
  newMatches: SearchMatchInput[];
  totalMatches: number;
  /** True when this run only recorded what's open now (the search's first run). */
  baseline: boolean;
  error: string | null;
}

const canonical = (url: string) => {
  try {
    return canonicalizeJobUrl(url);
  } catch {
    return null;
  }
};

/**
 * Run one saved search against its job boards and remember every posting it
 * found. The first run is the baseline: what's open today is recorded as seen
 * and not reported, so the first alert email isn't every job on the boards.
 * Postings the user already has in their jobs are never reported as new.
 */
export async function runSavedSearch(search: SavedSearchRow, options: { http?: HttpFetcher; now?: Date } = {}): Promise<SavedSearchRunResult> {
  const baseline = search.lastRunAt === null;
  const { boards } = parseBoardList(search.boards.join("\n"));
  let result;
  try {
    result = await searchJobBoards(
      { boards, query: search.query, location: search.location, searchDescriptions: search.searchDescriptions, matchAny: search.matchAny, fresh: true },
      options.http ?? safeFetch,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "The search failed";
    await recordSavedSearchFailure(search.id, message);
    return { newMatches: [], totalMatches: 0, baseline, error: message };
  }
  const failed = result.boards.filter((b) => b.error);
  const error = failed.length ? `${failed.length} of ${result.boards.length} boards couldn't be read: ${failed.map((b) => `${b.slug} (${b.error})`).join("; ")}` : null;
  if (failed.length === result.boards.length) {
    await recordSavedSearchFailure(search.id, error ?? "No board could be read");
    return { newMatches: [], totalMatches: 0, baseline, error };
  }

  const found = new Map<string, SearchMatchInput>();
  for (const job of result.jobs) {
    const url = canonical(job.url);
    if (!url || found.has(url)) continue;
    found.set(url, {
      canonicalUrl: url,
      url: job.url,
      title: (job.title ?? "Untitled job").slice(0, 200),
      company: (job.company ?? "Unknown company").slice(0, 200),
      location: job.location ?? null,
      salaryText: job.salaryText?.slice(0, 200) ?? null,
      postedAt: job.postedAt ?? null,
      wasNew: !baseline,
    });
  }
  const urls = [...found.keys()];
  const [seen, known] = await Promise.all([findSeenMatchUrls(search.id, urls), findKnownJobUrls(search.userId, urls)]);
  const unseen = [...found.values()].filter((m) => !seen.has(m.canonicalUrl)).map((m) => (known.has(m.canonicalUrl) ? { ...m, wasNew: false } : m));
  await recordSavedSearchRun({ userId: search.userId, savedSearchId: search.id, matches: unseen, error, at: options.now });
  return { newMatches: unseen.filter((m) => m.wasNew), totalMatches: found.size, baseline, error };
}

export interface JobAlertOptions {
  sender: EmailSender;
  now?: Date;
  http?: HttpFetcher;
  env?: NodeJS.ProcessEnv;
}

export interface JobAlertResult {
  usersRun: number;
  emailsSent: number;
  failed: number;
  skipped: number;
}

/**
 * Daily job alerts. Once a day per user, at or after their chosen local hour,
 * run each saved search with alerts on and email the new postings in one
 * email. Nothing is sent when nothing is new.
 */
export async function runDueJobAlerts(options: JobAlertOptions): Promise<JobAlertResult> {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const result: JobAlertResult = { usersRun: 0, emailsSent: 0, failed: 0, skipped: 0 };

  for (const candidate of await findJobAlertCandidates()) {
    const local = localDateHour(now, candidate.timezone);
    if (local.hour < candidate.jobAlertHour || candidate.jobAlertsRanOn === local.date) continue;
    if (!(await claimJobAlertRun(candidate.userId, local.date, candidate.jobAlertsRanOn))) continue;
    result.usersRun += 1;

    const sections: JobAlertSection[] = [];
    for (const search of await listAlertSearchesForUser(candidate.userId)) {
      const run = await runSavedSearch(search, { http: options.http, now });
      if (!run.newMatches.length) continue;
      const newest = [...run.newMatches].sort((a, b) => (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0));
      sections.push({
        searchName: search.name,
        query: search.query,
        postings: newest.slice(0, MAX_POSTINGS_PER_SEARCH_EMAIL).map((m) => ({ title: m.title, company: m.company, location: m.location, salaryText: m.salaryText, url: m.url })),
        more: Math.max(0, newest.length - MAX_POSTINGS_PER_SEARCH_EMAIL),
      });
    }
    if (!sections.length) continue;

    const user = await getAlertRecipient(candidate.userId);
    if (!user) continue;
    const message = jobAlertEmail({
      to: user.email,
      name: user.name,
      sections,
      alertsUrl: appUrl("/job-alerts", env),
      settingsUrl: appUrl("/settings#notifications", env),
      unsubscribeUrl: unsubscribeUrl(user.id, "job_alerts", env),
      headers: unsubscribeHeaders(user.id, "job_alerts", env),
      alertHour: candidate.jobAlertHour,
    });
    const data = { searches: sections.map((s) => ({ name: s.searchName, newJobs: s.postings.length + s.more })) };
    if (!options.sender.configured) {
      await recordNotification({ userId: user.id, createdAt: now, kind: "JOB_ALERT", status: "SKIPPED", recipient: user.email, subject: message.subject, data, error: "No email provider is set up" });
      result.skipped += 1;
      continue;
    }
    try {
      const sent = await options.sender.send(message);
      await recordNotification({ userId: user.id, createdAt: now, kind: "JOB_ALERT", status: "SENT", recipient: user.email, subject: message.subject, data, providerMessageId: sent.id });
      result.emailsSent += 1;
    } catch (error) {
      // The new postings stay listed on the Job alerts page; tomorrow's email covers only what's new by then.
      await recordNotification({ userId: user.id, createdAt: now, kind: "JOB_ALERT", status: "FAILED", recipient: user.email, subject: message.subject, data, error: error instanceof Error ? error.message : String(error) });
      result.failed += 1;
    }
  }
  return result;
}
