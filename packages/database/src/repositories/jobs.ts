import type { Prisma } from "@prisma/client";
import {
  APPLICATION_STATUSES,
  canonicalizeJobUrl,
  extractLinkedInJobId,
  JOB_STATUSES,
  parseSalary,
  type ApplicationStatus,
  type JobFilters,
  type JobStatus,
  type ManualJobInput,
  type Platform,
  type PipelineStatus,
} from "@autoapply/shared";
import { prisma } from "../client";
import { ConflictError, isUniqueViolation, NotFoundError } from "./errors";

const isJobStatus = (s: string): s is JobStatus => (JOB_STATUSES as readonly string[]).includes(s);
const isApplicationStatus = (s: string): s is ApplicationStatus => (APPLICATION_STATUSES as readonly string[]).includes(s);

function buildJobWhere(userId: string, f: JobFilters): Prisma.JobWhereInput {
  const and: Prisma.JobWhereInput[] = [{ userId, deletedAt: null }];
  if (f.q) {
    and.push({
      OR: [
        { title: { contains: f.q, mode: "insensitive" } },
        { company: { contains: f.q, mode: "insensitive" } },
        { location: { contains: f.q, mode: "insensitive" } },
      ],
    });
  }
  if (f.company) and.push({ company: { contains: f.company, mode: "insensitive" } });
  if (f.location) and.push({ location: { contains: f.location, mode: "insensitive" } });
  if (f.platform.length) and.push({ platform: { in: f.platform } });
  if (f.remote) and.push({ workArrangement: f.remote });
  if (f.minMatch != null) and.push({ matchScore: { gte: f.minMatch } });
  if (f.minSalary != null) and.push({ salaryAnnualMax: { gte: f.minSalary } });
  // savedTo is a calendar date: include the whole day.
  if (f.savedFrom || f.savedTo) {
    and.push({ savedAt: { gte: f.savedFrom, lt: f.savedTo ? new Date(f.savedTo.getTime() + 24 * 3600 * 1000) : undefined } });
  }
  if (f.status.length) {
    const jobStatuses = f.status.filter(isJobStatus);
    const appStatuses = f.status.filter(isApplicationStatus);
    const or: Prisma.JobWhereInput[] = [];
    if (jobStatuses.length) or.push({ application: null, status: { in: jobStatuses } });
    if (appStatuses.length) or.push({ application: { status: { in: appStatuses } } });
    and.push({ OR: or });
  }
  return { AND: and };
}

function buildJobOrder(f: JobFilters): Prisma.JobOrderByWithRelationInput[] {
  const dir = f.dir;
  const nullsLast = { sort: dir, nulls: "last" } as const;
  switch (f.sort) {
    case "matchScore":
      return [{ matchScore: nullsLast }, { savedAt: "desc" }];
    case "company":
      return [{ company: dir }, { savedAt: "desc" }];
    case "salary":
      return [{ salaryAnnualMax: nullsLast }, { savedAt: "desc" }];
    case "appliedAt":
      return [{ application: { submittedAt: nullsLast } }, { savedAt: "desc" }];
    default:
      return [{ savedAt: dir }, { id: dir }];
  }
}

const jobListSelect = {
  id: true,
  title: true,
  company: true,
  location: true,
  url: true,
  applicationUrl: true,
  matchScore: true,
  salaryMin: true,
  salaryMax: true,
  salaryCurrency: true,
  salaryPeriod: true,
  platform: true,
  status: true,
  workArrangement: true,
  savedAt: true,
  easyApply: true,
  application: { select: { id: true, status: true, submittedAt: true, attentionReason: true } },
} satisfies Prisma.JobSelect;

export type JobListRow = Prisma.JobGetPayload<{ select: typeof jobListSelect }> & { pipelineStatus: PipelineStatus };

export async function listJobs(userId: string, filters: JobFilters) {
  const where = buildJobWhere(userId, filters);
  const [total, rows] = await prisma.$transaction([
    prisma.job.count({ where }),
    prisma.job.findMany({
      where,
      orderBy: buildJobOrder(filters),
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      select: jobListSelect,
    }),
  ]);
  return {
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    pageCount: Math.max(1, Math.ceil(total / filters.pageSize)),
    rows: rows.map((r): JobListRow => ({ ...r, pipelineStatus: r.application?.status ?? r.status })),
  };
}

/** Distinct values for filter dropdowns. */
export async function getJobFilterOptions(userId: string) {
  const [companies, platforms] = await Promise.all([
    prisma.job.findMany({ where: { userId, deletedAt: null }, distinct: ["company"], select: { company: true }, orderBy: { company: "asc" }, take: 500 }),
    prisma.job.findMany({ where: { userId, deletedAt: null }, distinct: ["platform"], select: { platform: true } }),
  ]);
  return { companies: companies.map((c) => c.company), platforms: platforms.map((p) => p.platform) };
}

export async function getJob(userId: string, id: string) {
  const job = await prisma.job.findFirst({
    where: { id, userId, deletedAt: null },
    include: { application: { select: { id: true, status: true } }, source: { select: { type: true, name: true } } },
  });
  if (!job) throw new NotFoundError("Job");
  return job;
}

export class DuplicateJobError extends ConflictError {
  constructor(
    public readonly existingJobId: string,
    public readonly wasDeleted: boolean,
  ) {
    super(wasDeleted ? "You removed this job earlier" : "This job is already in your list");
    this.name = "DuplicateJobError";
  }
}

/**
 * Add a job from a pasted URL. Rejects duplicates by canonical URL (and by
 * LinkedIn job id), including jobs the user deleted, so a removed posting is not
 * silently re-added.
 */
export async function createManualJob(userId: string, input: ManualJobInput, platform: Platform) {
  const canonicalUrl = canonicalizeJobUrl(input.url);
  const linkedInId = extractLinkedInJobId(input.url);
  const existing = await prisma.job.findFirst({
    where: {
      userId,
      OR: [{ canonicalUrl }, ...(linkedInId ? [{ sourceType: "LINKEDIN_SAVED" as const, externalId: linkedInId }] : [])],
    },
    select: { id: true, deletedAt: true },
  });
  if (existing) throw new DuplicateJobError(existing.id, existing.deletedAt !== null);

  const salary = parseSalary(input.salaryText);
  const source = await prisma.jobSource.upsert({
    where: { userId_type_name: { userId, type: "MANUAL", name: "Manual entry" } },
    update: {},
    create: { userId, type: "MANUAL", name: "Manual entry" },
  });
  try {
    return await prisma.job.create({
      data: {
        userId,
        sourceId: source.id,
        sourceType: "MANUAL",
        externalId: linkedInId,
        url: input.url,
        canonicalUrl,
        applicationUrl: input.applicationUrl ?? null,
        title: input.title,
        company: input.company,
        location: input.location ?? null,
        description: input.description ?? null,
        workArrangement: input.workArrangement,
        platform,
        salaryText: input.salaryText ?? null,
        salaryMin: salary?.min != null ? Math.round(salary.min) : null,
        salaryMax: salary?.max != null ? Math.round(salary.max) : null,
        salaryCurrency: salary?.currency ?? null,
        salaryPeriod: salary?.period ?? null,
        salaryAnnualMax: salary?.annualMax ?? null,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("This job is already in your list");
    throw error;
  }
}

/** Restore a job the user deleted earlier. */
export async function restoreJob(userId: string, id: string) {
  const { count } = await prisma.job.updateMany({ where: { id, userId, deletedAt: { not: null } }, data: { deletedAt: null } });
  if (count === 0) throw new NotFoundError("Deleted job");
}

/**
 * Skip jobs: jobs with no application are marked SKIPPED; queued, failed or
 * waiting applications are marked SKIPPED. Submitted or in-flight ones are left alone.
 */
export async function skipJobs(userId: string, jobIds: string[]) {
  const jobs = await prisma.job.findMany({
    where: { id: { in: jobIds }, userId, deletedAt: null },
    select: { id: true, application: { select: { id: true, status: true } } },
  });
  const skippableApp: ApplicationStatus[] = ["QUEUED", "FAILED", "WAITING_FOR_USER", "REVIEW_REQUIRED", "READY"];
  const jobOnly = jobs.filter((j) => !j.application).map((j) => j.id);
  const apps = jobs.filter((j) => j.application && skippableApp.includes(j.application.status)).map((j) => j.application!.id);

  await prisma.$transaction(async (tx) => {
    if (jobOnly.length) await tx.job.updateMany({ where: { id: { in: jobOnly }, userId }, data: { status: "SKIPPED", processedAt: new Date() } });
    if (apps.length) {
      await tx.application.updateMany({ where: { id: { in: apps }, userId }, data: { status: "SKIPPED", completedAt: new Date(), attentionReason: null, attentionDetail: null } });
      await tx.applicationEvent.createMany({
        data: apps.map((applicationId) => ({ applicationId, userId, type: "STATUS_CHANGED" as const, message: "Skipped by user" })),
      });
    }
  });
  return { skipped: jobOnly.length + apps.length, unchanged: jobs.length - jobOnly.length - apps.length };
}

/** Soft-delete jobs. Jobs whose application is being processed right now cannot be deleted. */
export async function deleteJobs(userId: string, jobIds: string[]) {
  const blocked = await prisma.job.count({
    where: { id: { in: jobIds }, userId, application: { status: "PROCESSING" } },
  });
  if (blocked > 0) throw new ConflictError("Stop processing before deleting a job whose application is running");
  return prisma.$transaction(async (tx) => {
    // Pending applications for removed jobs are withdrawn; history (submitted, failed) is kept.
    await tx.application.updateMany({
      where: { userId, jobId: { in: jobIds }, status: { in: ["QUEUED", "WAITING_FOR_USER", "REVIEW_REQUIRED", "READY"] } },
      data: { status: "SKIPPED", completedAt: new Date(), attentionReason: null, attentionDetail: null },
    });
    const { count } = await tx.job.updateMany({
      where: { id: { in: jobIds }, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { deleted: count };
  });
}
