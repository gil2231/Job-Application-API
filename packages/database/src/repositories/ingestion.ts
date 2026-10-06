import type { Prisma } from "@prisma/client";
import type { JobSourceType, Platform, WorkArrangement } from "@autoapply/shared";
import { prisma } from "../client";
import { NotFoundError } from "./errors";

/** A job ready to store: normalized by the ingestion package. */
export interface PreparedJob {
  url: string;
  canonicalUrl: string;
  externalId: string | null;
  applicationUrl: string | null;
  title: string;
  company: string;
  location: string | null;
  description: string | null;
  postedAt: Date | null;
  savedAt: Date | null;
  easyApply: boolean;
  platform: Platform;
  workArrangement: WorkArrangement;
  salaryText: string | null;
  /** Null for placeholder jobs (bare URLs), which are never matched by fingerprint. */
  fingerprint: string | null;
}

export type InsertOutcome =
  | { kind: "created"; jobId: string }
  /** Already in the list. `enriched` when the import filled in details the stored job was missing. */
  | { kind: "duplicate"; jobId: string; title: string; enriched: boolean; reason: "url" | "fingerprint" | "batch" }
  | { kind: "previously_removed"; jobId: string; title: string }
  | { kind: "already_processed"; jobId: string; title: string };

export async function ensureJobSource(userId: string, type: JobSourceType, name: string) {
  return prisma.jobSource.upsert({
    where: { userId_type_name: { userId, type, name } },
    update: {},
    create: { userId, type, name },
  });
}

export async function startJobImport(userId: string, input: { sourceType: JobSourceType; sourceName: string; fileName?: string | null }) {
  const source = await ensureJobSource(userId, input.sourceType, input.sourceName);
  const run = await prisma.jobImport.create({ data: { userId, sourceId: source.id, fileName: input.fileName ?? null } });
  return { importId: run.id, sourceId: source.id };
}

export interface ImportCounts {
  totalCount: number;
  createdCount: number;
  duplicateCount: number;
  skippedCount: number;
  failedCount: number;
}

export async function finishJobImport(userId: string, importId: string, counts: ImportCounts, issues: unknown[], error?: string) {
  await prisma.$transaction([
    prisma.jobImport.updateMany({
      where: { id: importId, userId },
      data: {
        ...counts,
        status: error ? "FAILED" : "COMPLETED",
        error: error ?? null,
        // Cap stored issues so a bad 1,000-row file doesn't bloat the row.
        issues: issues.slice(0, 200) as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    }),
    prisma.jobSource.updateMany({
      where: { userId, imports: { some: { id: importId } } },
      data: { lastSyncedAt: new Date(), lastError: error ?? null },
    }),
  ]);
}

export async function listJobImports(userId: string, limit = 10) {
  return prisma.jobImport.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { source: { select: { name: true, type: true } } },
  });
}
export type JobImportRow = Awaited<ReturnType<typeof listJobImports>>[number];

/** Fields an import may fill in on an existing job when the stored value is empty. */
const ENRICHABLE = ["description", "location", "applicationUrl", "postedAt", "salaryText"] as const;

/**
 * Store imported jobs, skipping duplicates. A job is a duplicate when its
 * canonical URL (which includes the LinkedIn job id) is already stored, or when
 * the same title at the same company and location is. Jobs the user deleted
 * or already applied to/skipped are reported separately and never re-added.
 */
export async function insertImportedJobs(
  userId: string,
  context: { importId: string; sourceId: string; sourceType: JobSourceType },
  jobs: PreparedJob[],
): Promise<InsertOutcome[]> {
  if (!jobs.length) return [];
  const fingerprints = [...new Set(jobs.map((j) => j.fingerprint).filter((f): f is string => !!f))];
  const existing = await prisma.job.findMany({
    where: {
      userId,
      OR: [{ canonicalUrl: { in: jobs.map((j) => j.canonicalUrl) } }, ...(fingerprints.length ? [{ fingerprint: { in: fingerprints } }] : [])],
    },
    select: {
      id: true,
      title: true,
      canonicalUrl: true,
      fingerprint: true,
      location: true,
      deletedAt: true,
      processedAt: true,
      status: true,
      description: true,
      applicationUrl: true,
      postedAt: true,
      salaryText: true,
      application: { select: { id: true } },
    },
  });
  const byUrl = new Map(existing.map((e) => [e.canonicalUrl, e]));
  const byFingerprint = new Map<string, typeof existing>();
  for (const e of existing) if (e.fingerprint) byFingerprint.set(e.fingerprint, [...(byFingerprint.get(e.fingerprint) ?? []), e]);
  const sameLocation = (a: string | null, b: string | null) => !a || !b || a.trim().toLowerCase() === b.trim().toLowerCase();

  const seenInBatch = new Map<string, string>();
  const outcomes: InsertOutcome[] = [];
  for (const job of jobs) {
    const batchHit = seenInBatch.get(job.canonicalUrl);
    if (batchHit) {
      outcomes.push({ kind: "duplicate", jobId: batchHit, title: job.title, enriched: false, reason: "batch" });
      continue;
    }
    const match =
      byUrl.get(job.canonicalUrl) ?? (job.fingerprint ? byFingerprint.get(job.fingerprint)?.find((e) => sameLocation(e.location, job.location)) : undefined);
    if (match) {
      const reason = byUrl.has(job.canonicalUrl) ? "url" : "fingerprint";
      if (match.deletedAt) outcomes.push({ kind: "previously_removed", jobId: match.id, title: match.title });
      else if (match.application || match.processedAt || match.status === "SKIPPED") outcomes.push({ kind: "already_processed", jobId: match.id, title: match.title });
      else {
        const fill: Prisma.JobUpdateInput = {};
        for (const key of ENRICHABLE) if (match[key] == null && job[key] != null) (fill as Record<string, unknown>)[key] = job[key];
        const enriched = Object.keys(fill).length > 0;
        if (enriched) {
          // New details mean the stored analysis is stale; the pipeline re-analyzes IMPORTED jobs.
          await prisma.job.update({ where: { id: match.id }, data: { ...fill, status: "IMPORTED" } });
        }
        outcomes.push({ kind: "duplicate", jobId: match.id, title: match.title, enriched, reason });
      }
      seenInBatch.set(job.canonicalUrl, match.id);
      continue;
    }
    try {
      const created = await prisma.job.create({
        data: {
          userId,
          sourceId: context.sourceId,
          importId: context.importId,
          sourceType: context.sourceType,
          externalId: job.externalId,
          url: job.url,
          canonicalUrl: job.canonicalUrl,
          applicationUrl: job.applicationUrl,
          title: job.title,
          company: job.company,
          location: job.location,
          description: job.description,
          postedAt: job.postedAt,
          savedAt: job.savedAt ?? undefined,
          easyApply: job.easyApply,
          platform: job.platform,
          workArrangement: job.workArrangement,
          salaryText: job.salaryText,
          fingerprint: job.fingerprint,
        },
        select: { id: true },
      });
      seenInBatch.set(job.canonicalUrl, created.id);
      if (job.fingerprint) {
        const row: (typeof existing)[number] = {
          id: created.id,
          title: job.title,
          canonicalUrl: job.canonicalUrl,
          fingerprint: job.fingerprint,
          location: job.location,
          deletedAt: null,
          processedAt: null,
          status: "IMPORTED",
          description: job.description,
          applicationUrl: job.applicationUrl,
          postedAt: job.postedAt,
          salaryText: job.salaryText,
          application: null,
        };
        byFingerprint.set(job.fingerprint, [...(byFingerprint.get(job.fingerprint) ?? []), row]);
      }
      outcomes.push({ kind: "created", jobId: created.id });
    } catch (error) {
      // A concurrent import stored the same job between our check and insert.
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
        const other = await prisma.job.findFirst({ where: { userId, canonicalUrl: job.canonicalUrl }, select: { id: true, title: true } });
        outcomes.push({ kind: "duplicate", jobId: other?.id ?? "", title: other?.title ?? job.title, enriched: false, reason: "url" });
      } else throw error;
    }
  }
  return outcomes;
}

// ── Analysis ────────────────────────────────────────────────────────────────

const analysisJobSelect = {
  id: true,
  title: true,
  company: true,
  location: true,
  description: true,
  salaryText: true,
  workArrangement: true,
  platform: true,
  status: true,
  analysis: true,
  application: { select: { id: true } },
} satisfies Prisma.JobSelect;
export type AnalysisJob = Prisma.JobGetPayload<{ select: typeof analysisJobSelect }>;

/** Jobs waiting for analysis (IMPORTED), or the given jobs. Deleted jobs are never analyzed. */
export async function getJobsForAnalysis(userId: string, jobIds?: string[], limit = 1000): Promise<AnalysisJob[]> {
  return prisma.job.findMany({
    where: { userId, deletedAt: null, ...(jobIds ? { id: { in: jobIds } } : { status: "IMPORTED" }) },
    select: analysisJobSelect,
    orderBy: { savedAt: "desc" },
    take: limit,
  });
}

/** Jobs whose score and qualification should follow the current profile and rules. */
export async function getJobsForRescore(userId: string): Promise<AnalysisJob[]> {
  return prisma.job.findMany({
    where: { userId, deletedAt: null, analyzedAt: { not: null }, application: null, status: { not: "SKIPPED" } },
    select: analysisJobSelect,
    take: 5000,
  });
}

export async function markJobsAnalyzing(userId: string, jobIds: string[]) {
  if (!jobIds.length) return;
  await prisma.job.updateMany({ where: { userId, id: { in: jobIds }, application: null, status: { notIn: ["SKIPPED"] } }, data: { status: "ANALYZING" } });
}

/** Put jobs stuck in ANALYZING (e.g. after a server restart) back in the queue. */
export async function resetStaleAnalyzing(userId: string, olderThan: Date) {
  await prisma.job.updateMany({ where: { userId, status: "ANALYZING", updatedAt: { lt: olderThan } }, data: { status: "IMPORTED" } });
}

export interface JobAnalysisUpdate {
  analysis: Prisma.InputJsonValue | null;
  department: string | null;
  seniority: string | null;
  workArrangement: WorkArrangement;
  employmentType: Prisma.JobUpdateInput["employmentType"];
  salaryText: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  salaryAnnualMax: number | null;
  requiredQualifications: string[];
  preferredQualifications: string[];
  experienceYearsMin: number | null;
  educationRequirement: string | null;
  skills: string[];
  industry: string | null;
  sponsorshipAvailable: boolean | null;
  travelRequirement: string | null;
  analyzedAt: Date;
}

export interface JobScoreUpdate {
  /** Null when the job can't be scored yet (no description). */
  matchScore: number | null;
  matchBreakdown: Prisma.InputJsonValue;
  qualification: Prisma.InputJsonValue;
  /** New pipeline status; ignored for jobs that already have an application or were skipped. */
  status: "QUALIFIED" | "NOT_QUALIFIED" | "NEEDS_DETAILS";
  scoredAt: Date;
}

/** Save analysis and/or score. Status only moves for jobs still in the qualification stage. */
export async function saveJobResults(userId: string, jobId: string, analysis: JobAnalysisUpdate | null, score: JobScoreUpdate) {
  const job = await prisma.job.findFirst({ where: { id: jobId, userId }, select: { status: true, application: { select: { id: true } } } });
  if (!job) throw new NotFoundError("Job");
  const { status, ...scoreData } = score;
  const statusChange = !job.application && job.status !== "SKIPPED" ? { status } : {};
  const analysisData = analysis ? { ...analysis, analysis: analysis.analysis ?? undefined } : {};
  await prisma.job.update({ where: { id: jobId }, data: { ...analysisData, ...scoreData, ...statusChange } });
}

/** Return a job to IMPORTED so the pipeline analyzes it again. */
export async function requeueJobAnalysis(userId: string, jobIds: string[]) {
  const { count } = await prisma.job.updateMany({
    where: { userId, id: { in: jobIds }, deletedAt: null, application: null, status: { not: "SKIPPED" } },
    data: { status: "IMPORTED" },
  });
  return count;
}

export interface JobDetailsInput {
  title: string;
  company: string;
  location: string | null;
  workArrangement: WorkArrangement;
  salaryText: string | null;
  applicationUrl: string | null;
  description: string | null;
}

/** Edit a job's details (e.g. paste the description of a LinkedIn import). The job is re-analyzed afterwards. */
export async function updateJobDetails(userId: string, jobId: string, input: JobDetailsInput & { platform: Platform; fingerprint: string | null }) {
  const { count } = await prisma.job.updateMany({
    where: { id: jobId, userId, deletedAt: null },
    data: { ...input },
  });
  if (count === 0) throw new NotFoundError("Job");
}

/** Everything matching needs about the user, in one round trip. */
export async function getMatchingContext(userId: string) {
  const [profile, rule, settings] = await Promise.all([
    prisma.masterProfile.upsert({
      where: { userId },
      update: {},
      create: { userId },
      include: {
        education: { select: { degree: true, major: true } },
        employment: { select: { title: true, startDate: true, endDate: true, isCurrent: true, skills: true } },
        skills: { select: { name: true } },
      },
    }),
    prisma.automationRule.findUnique({ where: { userId } }),
    prisma.userSetting.findUnique({ where: { userId }, select: { aiProvider: true, aiModel: true } }),
  ]);
  return { profile, rule, settings };
}

// ── Job board search ────────────────────────────────────────────────────────

export const JOB_BOARD_SOURCE_NAME = "Job board search";

/** The last board search, remembered so the form opens with it. */
export interface SavedBoardSearch {
  boards: string[];
  query: string;
  location: string | null;
  searchDescriptions: boolean;
}

export async function getSavedBoardSearch(userId: string): Promise<SavedBoardSearch | null> {
  const source = await prisma.jobSource.findUnique({
    where: { userId_type_name: { userId, type: "JOB_BOARD", name: JOB_BOARD_SOURCE_NAME } },
    select: { config: true },
  });
  const c = source?.config;
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const config = c as Record<string, unknown>;
  return {
    boards: Array.isArray(config.boards) ? config.boards.filter((b): b is string => typeof b === "string") : [],
    query: typeof config.query === "string" ? config.query : "",
    location: typeof config.location === "string" ? config.location : null,
    searchDescriptions: config.searchDescriptions === true,
  };
}

export async function saveBoardSearch(userId: string, search: SavedBoardSearch) {
  const config = search as unknown as Prisma.InputJsonValue;
  await prisma.jobSource.upsert({
    where: { userId_type_name: { userId, type: "JOB_BOARD", name: JOB_BOARD_SOURCE_NAME } },
    update: { config },
    create: { userId, type: "JOB_BOARD", name: JOB_BOARD_SOURCE_NAME, config },
  });
}

/** Which of these canonical URLs the user already has (including deleted jobs, which imports never re-add). */
export async function findKnownJobUrls(userId: string, canonicalUrls: string[]): Promise<Map<string, { jobId: string; removed: boolean }>> {
  if (!canonicalUrls.length) return new Map();
  const rows = await prisma.job.findMany({ where: { userId, canonicalUrl: { in: canonicalUrls } }, select: { id: true, canonicalUrl: true, deletedAt: true } });
  return new Map(rows.map((r) => [r.canonicalUrl, { jobId: r.id, removed: r.deletedAt !== null }]));
}
