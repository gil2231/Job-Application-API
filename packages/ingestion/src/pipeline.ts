import { createJobAnalyzer, htmlToText, type JobAnalyzer } from "@autoapply/ai";
import { detectPlatformFromUrl } from "@autoapply/ats-adapters";
import {
  finishJobImport,
  getJobsForAnalysis,
  getJobsForRescore,
  getMatchingContext,
  insertImportedJobs,
  markJobsAnalyzing,
  resetStaleAnalyzing,
  saveJobResults,
  startJobImport,
  type AnalysisJob,
  type InsertOutcome,
  type JobAnalysisUpdate,
  type PreparedJob,
} from "@autoapply/database";
import { evaluateRules, normalizeCompany, scoreMatch, type MatchPreferences, type MatchProfile, type QualificationRules } from "@autoapply/matching";
import {
  canonicalizeJobUrl,
  DEFAULT_MATCH_WEIGHTS,
  EDUCATION_LEVEL_LABELS,
  extractLinkedInJobId,
  MATCH_DIMENSIONS,
  SENIORITY_LABELS,
  type JobAnalysis,
  type MatchWeights,
  type WorkArrangement,
  createLogger,
} from "@autoapply/shared";
import { mapConcurrent } from "./sources/url-list";
import type { ImportIssue, JobSourceAdapter, RawJob, SourceContext } from "./types";
import { MAX_IMPORT_JOBS } from "./types";
import { fetchPosting } from "./postings";

const log = createLogger("ingestion");

// ── Preparing raw jobs ──────────────────────────────────────────────────────

/**
 * Normalized company + title. Two saves of one posting from different sites
 * share it. Stricter than role matching: seniority and near-synonyms (BDR vs
 * SDR) stay distinct, because a company often posts both.
 */
export function jobFingerprint(company: string, title: string): string | null {
  const c = normalizeCompany(company);
  const t = title
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\bsr\b\.?/g, "senior")
    .replace(/\bjr\b\.?/g, "junior")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
  return c && t ? `${c}|${t}` : null;
}

export function prepareJob(raw: RawJob): PreparedJob | null {
  let canonicalUrl: string;
  try {
    canonicalUrl = canonicalizeJobUrl(raw.url);
  } catch {
    return null;
  }
  const title = raw.title?.trim();
  const company = raw.company?.trim();
  if (!title || !company) return null;
  const linkedInId = extractLinkedInJobId(raw.url);
  const description = raw.description ? htmlToText(raw.description).slice(0, 50_000) : null;
  return {
    url: raw.url,
    canonicalUrl,
    // Only LinkedIn ids are stored: other sources' ids aren't unique across companies.
    externalId: linkedInId,
    applicationUrl: raw.applicationUrl ?? null,
    title: title.slice(0, 200),
    company: company.slice(0, 200),
    location: raw.location?.trim() || null,
    description: description || null,
    postedAt: raw.postedAt ?? null,
    savedAt: raw.savedAt ?? null,
    easyApply: raw.easyApply ?? false,
    platform: detectPlatformFromUrl(raw.applicationUrl ?? raw.url).platform,
    workArrangement: raw.workArrangement ?? "UNKNOWN",
    salaryText: raw.salaryText?.trim() || null,
    fingerprint: raw.needsDetails ? null : jobFingerprint(company, title),
  };
}

// ── Import ──────────────────────────────────────────────────────────────────

export interface ImportSummary {
  importId: string;
  total: number;
  created: number;
  duplicates: number;
  skipped: number;
  failed: number;
  needsDetails: number;
  issues: ImportIssue[];
  createdJobIds: string[];
  /** Existing jobs that got new details and need re-analysis. */
  enrichedJobIds: string[];
  /** What happened to each stored job, in source order (invalid rows have none). */
  outcomes: InsertOutcome[];
}

/**
 * Run a source and store its jobs. Analysis is a separate step
 * (analyzePendingJobs) so a large import returns quickly.
 */
export async function runImport<TInput>(
  userId: string,
  source: JobSourceAdapter<TInput>,
  input: TInput,
  options: { fileName?: string | null; context?: Partial<SourceContext> } = {},
): Promise<ImportSummary> {
  const context: SourceContext = { maxJobs: MAX_IMPORT_JOBS, fetchPosting: (url) => fetchPosting(url), ...options.context };
  const parsed = await source.parse(input, context);
  const { importId, sourceId } = await startJobImport(userId, { sourceType: parsed.sourceType, sourceName: parsed.sourceName, fileName: options.fileName });
  const issues: ImportIssue[] = [...parsed.issues];
  try {
    const prepared: PreparedJob[] = [];
    const placeholders = new Set<string>();
    for (const raw of parsed.jobs) {
      const job = prepareJob(raw);
      if (!job) {
        issues.push({ row: raw.row, url: raw.url, kind: "invalid", message: !raw.title || !raw.company ? "Missing job title or company." : "Invalid job URL." });
        continue;
      }
      if (raw.needsDetails) placeholders.add(job.canonicalUrl);
      prepared.push(job);
    }
    const outcomes = await insertImportedJobs(userId, { importId, sourceId, sourceType: parsed.sourceType }, prepared);

    const summary: ImportSummary = { importId, total: parsed.jobs.length, created: 0, duplicates: 0, skipped: 0, failed: 0, needsDetails: 0, issues, createdJobIds: [], enrichedJobIds: [], outcomes };
    outcomes.forEach((outcome, i) => {
      const job = prepared[i]!;
      const row = parsed.jobs.find((r) => r.url === job.url)?.row;
      if (outcome.kind === "created") {
        summary.created++;
        summary.createdJobIds.push(outcome.jobId);
        if (placeholders.has(job.canonicalUrl)) summary.needsDetails++;
      } else if (outcome.kind === "duplicate") {
        summary.duplicates++;
        if (outcome.enriched) summary.enrichedJobIds.push(outcome.jobId);
        const message =
          outcome.reason === "batch"
            ? "Listed more than once in this import."
            : outcome.enriched
              ? `Already in your list as "${outcome.title}". Added the details it was missing.`
              : outcome.reason === "fingerprint"
                ? `Looks like "${outcome.title}", which is already in your list.`
                : `Already in your list as "${outcome.title}".`;
        issues.push({ row, url: job.url, title: job.title, kind: "duplicate", message });
      } else {
        summary.skipped++;
        issues.push({
          row,
          url: job.url,
          title: job.title,
          kind: outcome.kind,
          message: outcome.kind === "previously_removed" ? "You deleted this job earlier, so it wasn't added again." : "Already applied to or skipped.",
        });
      }
    });
    summary.failed = issues.filter((i) => i.kind === "invalid" || i.kind === "fetch_failed").length;
    await finishJobImport(
      userId,
      importId,
      { totalCount: summary.total, createdCount: summary.created, duplicateCount: summary.duplicates, skippedCount: summary.skipped, failedCount: summary.failed },
      issues,
    );
    return summary;
  } catch (error) {
    await finishJobImport(userId, importId, { totalCount: parsed.jobs.length, createdCount: 0, duplicateCount: 0, skippedCount: 0, failedCount: parsed.jobs.length }, issues, "The import failed before it finished.");
    throw error;
  }
}

// ── Analysis, scoring and qualification ─────────────────────────────────────

type MatchingContext = Awaited<ReturnType<typeof getMatchingContext>>;

function readWeights(value: unknown): MatchWeights {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return Object.fromEntries(MATCH_DIMENSIONS.map((d) => [d, typeof source[d] === "number" ? source[d] : DEFAULT_MATCH_WEIGHTS[d]])) as MatchWeights;
}

export function toMatchProfile(ctx: MatchingContext): MatchProfile {
  const p = ctx.profile;
  return {
    currentTitle: p.currentTitle,
    targetTitles: p.targetTitles,
    industries: p.industries,
    yearsExperience: p.yearsExperience == null ? null : Number(p.yearsExperience),
    city: p.city,
    state: p.state,
    skills: p.skills.map((s) => s.name),
    education: p.education,
    employment: p.employment,
  };
}

function toRules(ctx: MatchingContext): { rules: QualificationRules; prefs: MatchPreferences; weights: MatchWeights } {
  const r = ctx.rule;
  const rules: QualificationRules = {
    minMatchScore: r?.minMatchScore ?? 70,
    minSalary: r?.minSalary ?? null,
    preferredLocations: r?.preferredLocations ?? [],
    workArrangements: r?.workArrangements ?? [],
    employmentTypes: r?.employmentTypes ?? [],
    excludedIndustries: r?.excludedIndustries ?? [],
    excludedCompanies: r?.excludedCompanies ?? [],
    excludedKeywords: r?.excludedKeywords ?? [],
    requiredKeywords: r?.requiredKeywords ?? [],
    requiresSponsorship: r?.requiresSponsorship ?? false,
  };
  return {
    rules,
    prefs: { preferredLocations: rules.preferredLocations, workArrangements: rules.workArrangements, minSalary: rules.minSalary },
    weights: readWeights(r?.matchWeights),
  };
}

function analysisColumns(a: JobAnalysis, job: AnalysisJob): JobAnalysisUpdate {
  return {
    analysis: a as unknown as JobAnalysisUpdate["analysis"],
    department: a.department,
    seniority: a.seniority ? SENIORITY_LABELS[a.seniority] : null,
    workArrangement: a.workArrangement as WorkArrangement,
    employmentType: a.employmentType,
    salaryText: job.salaryText ?? a.salary?.text ?? null,
    salaryMin: a.salary ? Math.round(a.salary.min) : null,
    salaryMax: a.salary ? Math.round(a.salary.max) : null,
    salaryCurrency: a.salary?.currency ?? null,
    salaryPeriod: a.salary?.period ?? null,
    salaryAnnualMax: a.salary?.annualMax ?? null,
    requiredQualifications: a.requiredQualifications,
    preferredQualifications: a.preferredQualifications,
    experienceYearsMin: a.experienceYearsMin,
    educationRequirement: a.education ? a.education.text || EDUCATION_LEVEL_LABELS[a.education.level] : null,
    skills: a.skills,
    industry: a.industry,
    sponsorshipAvailable: a.sponsorship.available,
    travelRequirement: a.travel.text ?? (a.travel.percent != null ? `${a.travel.percent}% travel` : null),
    analyzedAt: new Date(a.analyzedAt),
  };
}

function scoreJob(job: AnalysisJob, analysis: JobAnalysis, profile: MatchProfile, config: ReturnType<typeof toRules>, now: Date) {
  const match = scoreMatch({ title: job.title, location: job.location, analysis }, profile, config.prefs, config.weights, now);
  const qualification = evaluateRules(
    { title: job.title, company: job.company, location: job.location, description: job.description, salaryText: job.salaryText, matchScore: match.score, analysis },
    config.rules,
    now,
  );
  // Without a description only the title is known; leave the job unscored rather than show a guess.
  const scored = analysis.hasDescription;
  return {
    matchScore: scored ? match.score : null,
    matchBreakdown: (scored ? match.breakdown : []) as unknown as JobAnalysisUpdate["analysis"] & object,
    qualification: qualification as unknown as JobAnalysisUpdate["analysis"] & object,
    status: qualification.status,
    scoredAt: now,
  };
}

export interface AnalyzeSummary {
  analyzed: number;
  qualified: number;
  notQualified: number;
  needsDetails: number;
  failed: number;
  method: "ai" | "heuristic";
}

/**
 * Analyze, score and qualify jobs: the given ones, or every job waiting in
 * IMPORTED. Uses the user's AI provider when configured, the deterministic
 * analyzer otherwise. Safe to run concurrently with imports.
 */
export async function analyzeJobs(userId: string, options: { jobIds?: string[]; analyzer?: JobAnalyzer & { info?: { method: "ai" | "heuristic" } }; now?: Date } = {}): Promise<AnalyzeSummary> {
  const now = options.now ?? new Date();
  await resetStaleAnalyzing(userId, new Date(now.getTime() - 10 * 60_000));
  const [jobs, ctx] = await Promise.all([getJobsForAnalysis(userId, options.jobIds), getMatchingContext(userId)]);
  const analyzer = options.analyzer ?? createJobAnalyzer({ provider: ctx.settings?.aiProvider, model: ctx.settings?.aiModel });
  const method = analyzer.info?.method ?? "heuristic";
  const summary: AnalyzeSummary = { analyzed: 0, qualified: 0, notQualified: 0, needsDetails: 0, failed: 0, method };
  if (!jobs.length) return summary;

  const profile = toMatchProfile(ctx);
  const config = toRules(ctx);
  const knownSkills = [...new Set([...profile.skills, ...profile.employment.flatMap((e) => e.skills)])];
  await markJobsAnalyzing(userId, jobs.map((j) => j.id));

  await mapConcurrent(jobs, method === "ai" ? 4 : 8, async (job) => {
    try {
      const analysis = await analyzer.analyze({
        title: job.title,
        company: job.company,
        location: job.location,
        description: job.description,
        salaryText: job.salaryText,
        workArrangement: job.workArrangement,
        platform: job.platform,
        knownSkills,
      });
      const score = scoreJob(job, analysis, profile, config, now);
      await saveJobResults(userId, job.id, analysisColumns(analysis, job), score);
      summary.analyzed++;
      if (score.status === "QUALIFIED") summary.qualified++;
      else if (score.status === "NOT_QUALIFIED") summary.notQualified++;
      else summary.needsDetails++;
    } catch (error) {
      summary.failed++;
      log.error("Job analysis failed", { jobId: job.id, error });
      // Leave the job retryable rather than stuck in ANALYZING.
      await saveJobResults(userId, job.id, null, {
        matchScore: null,
        matchBreakdown: [],
        qualification: { qualified: false, status: "NEEDS_DETAILS", checks: [], evaluatedAt: now.toISOString(), error: "Analysis failed" },
        status: "NEEDS_DETAILS",
        scoredAt: now,
      }).catch(() => undefined);
    }
  });
  return summary;
}

/**
 * Re-score and re-qualify every analyzed job without an application, using
 * stored analysis. Run after the profile or rules change; no AI calls.
 */
export async function rescoreJobs(userId: string, now: Date = new Date()) {
  const [jobs, ctx] = await Promise.all([getJobsForRescore(userId), getMatchingContext(userId)]);
  const profile = toMatchProfile(ctx);
  const config = toRules(ctx);
  const counts = { rescored: 0, qualified: 0 };
  await mapConcurrent(jobs, 8, async (job) => {
    const analysis = job.analysis as unknown as JobAnalysis | null;
    if (!analysis || analysis.version !== 1) return;
    const score = scoreJob(job, analysis, profile, config, now);
    await saveJobResults(userId, job.id, null, score);
    counts.rescored++;
    if (score.status === "QUALIFIED") counts.qualified++;
  });
  return counts;
}
