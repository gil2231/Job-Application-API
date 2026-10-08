import { parseHttpUrl, type WorkArrangement } from "@autoapply/shared";
import type { ImportIssue, JobSourceAdapter, RawJob, SourceParseResult } from "../types";
import { mapConcurrent } from "./url-list";

export const FOUND_JOBS_SOURCE_NAME = "Applyance search";

/** A search result the user picked, as the results list showed it. */
export interface FoundJob {
  url: string;
  title: string;
  company: string;
  location?: string | null;
  postedAt?: Date | null;
  salaryText?: string | null;
  workArrangement?: WorkArrangement | null;
}

/** Listing sites Applyance never fetches pages from. Their listings keep what the search returned. */
const NOT_FETCHED = /(^|\.)(linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com|joinhandshake\.com)$/i;

/**
 * Jobs picked from the Jobs page search. Each posting is read again from its
 * public page (Greenhouse, Lever, Ashby, SmartRecruiters, Workday or schema.org
 * job data) to get the full description; when that isn't possible the job is
 * added with what the search showed.
 */
export const foundJobsSource: JobSourceAdapter<{ jobs: FoundJob[] }> = {
  id: "found-jobs",
  type: "JOB_BOARD",
  name: FOUND_JOBS_SOURCE_NAME,
  async parse(input, context): Promise<SourceParseResult> {
    const issues: ImportIssue[] = [];
    const picked = input.jobs.slice(0, context.maxJobs);
    const jobs = await mapConcurrent(picked, 6, async (found): Promise<RawJob> => {
      const base: RawJob = { ...found };
      const host = parseHttpUrl(found.url)?.hostname ?? "";
      if (!context.fetchPosting || NOT_FETCHED.test(host)) return base;
      try {
        const posting = await context.fetchPosting(found.url);
        if (!posting) return base;
        return {
          ...base,
          ...Object.fromEntries(Object.entries(posting).filter(([, v]) => v != null && v !== "")),
          url: found.url,
          title: posting.title || found.title,
          company: posting.company || found.company,
        };
      } catch (error) {
        issues.push({ url: found.url, kind: "fetch_failed", message: `Couldn't read the full posting for ${found.title} (${error instanceof Error ? error.message : "unknown error"}). Added it with what the search found.` });
        return base;
      }
    });
    return { sourceType: "JOB_BOARD", sourceName: FOUND_JOBS_SOURCE_NAME, jobs, issues };
  },
};
