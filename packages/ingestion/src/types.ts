import type { JobSourceType, WorkArrangement } from "@autoapply/shared";

/**
 * A job as a source produced it, before deduplication and analysis. Only url
 * is guaranteed; sources fill in whatever they legitimately have.
 */
export interface RawJob {
  url: string;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  description?: string | null;
  /** Source-specific id, e.g. the LinkedIn job id. */
  externalId?: string | null;
  applicationUrl?: string | null;
  postedAt?: Date | null;
  savedAt?: Date | null;
  easyApply?: boolean | null;
  salaryText?: string | null;
  workArrangement?: WorkArrangement | null;
  /** Row number in the uploaded file, for error messages. */
  row?: number;
  /** True when title/company are placeholders because the source had no details (e.g. a bare LinkedIn URL). */
  needsDetails?: boolean;
}

export interface ImportIssue {
  row?: number;
  url?: string;
  title?: string;
  kind: "invalid" | "duplicate" | "previously_removed" | "already_processed" | "fetch_failed" | "limit";
  message: string;
}

export interface SourceParseResult {
  sourceType: JobSourceType;
  /** Display name of the JobSource the jobs are attributed to. */
  sourceName: string;
  jobs: RawJob[];
  issues: ImportIssue[];
}

/**
 * A pluggable job source. Each source turns one kind of user-supplied input
 * into RawJobs; deduplication, storage and analysis are shared by all of them.
 * To add a source, implement this and register it in sources/index.ts.
 */
export interface JobSourceAdapter<TInput> {
  id: string;
  type: JobSourceType;
  name: string;
  parse(input: TInput, context: SourceContext): Promise<SourceParseResult>;
}

export interface SourceContext {
  /** Fetches public posting details for a URL, or null when the URL isn't supported. */
  fetchPosting?: (url: string) => Promise<RawJob | null>;
  /** Most rows one import may contain. */
  maxJobs: number;
}

export const MAX_IMPORT_JOBS = 1000;
export const MAX_URLS_PER_PASTE = 100;
