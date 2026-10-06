"use server";

import { revalidatePath } from "next/cache";
import { audit, getJob, prisma, requeueJobAnalysis, saveAiSettings, updateJobDetails } from "@autoapply/database";
import { detectPlatformFromUrl } from "@autoapply/ats-adapters";
import { htmlToText } from "@autoapply/ai";
import {
  analyzeJobs,
  fetchPosting,
  fileImportSource,
  ImportFileError,
  jobFingerprint,
  rescoreJobs,
  runImport,
  UnsafeUrlError,
  urlListSource,
  type ImportIssue,
  type ImportSummary,
} from "@autoapply/ingestion";
import { aiSettingsSchema, importUrlsSchema, jobDetailsSchema, parseHttpUrl, extractLinkedInJobId } from "@autoapply/shared";
import { authedAction, formToObject, parseIds, validationFailed, type ActionResult } from "@/lib/action";
import { analyzeInBackground } from "@/lib/pipeline";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

function refresh() {
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  revalidatePath("/integrations");
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export interface ImportResultData {
  created: number;
  duplicates: number;
  skipped: number;
  failed: number;
  needsDetails: number;
  issues: ImportIssue[];
}

function summarize(summary: ImportSummary): ActionResult<ImportResultData> {
  const parts = [`Imported ${plural(summary.created, "new job")}`];
  if (summary.duplicates) parts.push(`${summary.duplicates} already in your list`);
  if (summary.skipped) parts.push(`${summary.skipped} previously removed or processed`);
  if (summary.failed) parts.push(`${summary.failed} couldn't be read`);
  return {
    ok: summary.created > 0 || summary.enrichedJobIds.length > 0 || summary.duplicates > 0,
    message: `${parts.join(", ")}.`,
    data: {
      created: summary.created,
      duplicates: summary.duplicates,
      skipped: summary.skipped,
      failed: summary.failed,
      needsDetails: summary.needsDetails,
      issues: summary.issues.slice(0, 100),
    },
  };
}

export async function importFileAction(_prev: ActionResult<ImportResultData>, formData: FormData): Promise<ActionResult<ImportResultData>> {
  return authedAction<ImportResultData>(async (user) => {
    const limit = rateLimit(`import:${user.id}`, LIMITS.jobImport.limit, LIMITS.jobImport.windowMs);
    if (!limit.allowed) return { ok: false, message: `Import limit reached. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.` };
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a file to import", errors: { file: "Choose a file to import" } };
    if (file.size > MAX_IMPORT_FILE_BYTES) return { ok: false, message: "Files up to 10 MB can be imported", errors: { file: "Files up to 10 MB can be imported" } };
    if (!/\.(csv|zip)$/i.test(file.name)) return { ok: false, message: "Upload a .csv or .zip file", errors: { file: "Upload a .csv or .zip file" } };
    try {
      const summary = await runImport(user.id, fileImportSource, { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, { fileName: file.name.slice(0, 200) });
      await audit(user.id, "jobs.imported", { entityType: "JobImport", entityId: summary.importId, metadata: { source: "file", created: summary.created, duplicates: summary.duplicates } });
      if (summary.created || summary.enrichedJobIds.length) analyzeInBackground(user.id);
      refresh();
      return summarize(summary);
    } catch (error) {
      if (error instanceof ImportFileError) return { ok: false, message: error.message, errors: { file: error.message } };
      throw error;
    }
  });
}

export async function importUrlsAction(_prev: ActionResult<ImportResultData>, formData: FormData): Promise<ActionResult<ImportResultData>> {
  return authedAction<ImportResultData>(async (user) => {
    const limit = rateLimit(`import:${user.id}`, LIMITS.jobImport.limit, LIMITS.jobImport.windowMs);
    if (!limit.allowed) return { ok: false, message: `Import limit reached. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.` };
    const parsed = importUrlsSchema.safeParse(formToObject(formData));
    if (!parsed.success) return validationFailed(parsed.error);
    const summary = await runImport(user.id, urlListSource, parsed.data);
    if (summary.total === 0) return { ok: false, message: "No job URLs found. Paste full links starting with https://", errors: { text: "No job URLs found" } };
    await audit(user.id, "jobs.imported", { entityType: "JobImport", entityId: summary.importId, metadata: { source: "urls", created: summary.created, duplicates: summary.duplicates } });
    if (summary.created || summary.enrichedJobIds.length) analyzeInBackground(user.id);
    refresh();
    return summarize(summary);
  });
}

export interface PostingDetails {
  title: string | null;
  company: string | null;
  location: string | null;
  workArrangement: string | null;
  salaryText: string | null;
  applicationUrl: string | null;
  description: string | null;
}

/** Look up a public posting so the Add job form can be filled in. LinkedIn is never fetched. */
export async function lookupPostingAction(url: string): Promise<ActionResult<PostingDetails>> {
  return authedAction<PostingDetails>(async (user) => {
    if (typeof url !== "string" || !parseHttpUrl(url) || url.length > 2048) return { ok: false, message: "Enter a full URL starting with https://" };
    if (extractLinkedInJobId(url) || /linkedin\.com/i.test(new URL(url).hostname)) {
      return { ok: false, message: "AutoApply doesn't read LinkedIn pages. Copy the title, company and description from the posting instead." };
    }
    const limit = rateLimit(`lookup:${user.id}`, LIMITS.postingLookup.limit, LIMITS.postingLookup.windowMs);
    if (!limit.allowed) return { ok: false, message: "Too many lookups. Fill in the details by hand or try again later." };
    try {
      const posting = await fetchPosting(url);
      if (!posting?.title) return { ok: false, message: "This page doesn't publish its posting details. Fill them in from the posting." };
      return {
        ok: true,
        message: `Found ${posting.title}${posting.company ? ` at ${posting.company}` : ""}`,
        data: {
          title: posting.title ?? null,
          company: posting.company ?? null,
          location: posting.location ?? null,
          workArrangement: posting.workArrangement ?? null,
          salaryText: posting.salaryText ?? null,
          applicationUrl: posting.applicationUrl && posting.applicationUrl !== url ? posting.applicationUrl : null,
          description: posting.description ? htmlToText(posting.description).slice(0, 50_000) : null,
        },
      };
    } catch (error) {
      const reason = error instanceof UnsafeUrlError ? "That address can't be fetched." : error instanceof Error ? error.message : "The site didn't respond.";
      return { ok: false, message: `Couldn't read the posting. ${reason}` };
    }
  });
}

export async function updateJobDetailsAction(jobId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return authedAction(async (user) => {
    const [id] = parseIds([jobId]);
    if (!id) return { ok: false, message: "Invalid id" };
    const parsed = jobDetailsSchema.safeParse(formToObject(formData));
    if (!parsed.success) return validationFailed(parsed.error);
    const job = await getJob(user.id, id);
    const d = parsed.data;
    await updateJobDetails(user.id, id, {
      title: d.title,
      company: d.company,
      location: d.location ?? null,
      workArrangement: d.workArrangement,
      salaryText: d.salaryText ?? null,
      applicationUrl: d.applicationUrl ?? null,
      description: d.description ?? null,
      platform: detectPlatformFromUrl(d.applicationUrl ?? job.url).platform,
      fingerprint: jobFingerprint(d.company, d.title),
    });
    await requeueJobAnalysis(user.id, [id]);
    const result = await analyzeJobs(user.id, { jobIds: [id] });
    await audit(user.id, "job.updated", { entityType: "Job", entityId: id });
    refresh();
    revalidatePath(`/jobs/${id}`);
    return { ok: true, message: result.failed ? "Details saved, but analysis failed. Try Re-analyze." : "Details saved and the job was re-analyzed" };
  });
}

export async function reanalyzeJobsAction(jobIds: string[]): Promise<ActionResult> {
  return authedAction(async (user) => {
    const ids = parseIds(jobIds, 25);
    if (!ids.length) return { ok: false, message: "Select at least one job" };
    const result = await analyzeJobs(user.id, { jobIds: ids });
    await audit(user.id, "job.reanalyzed", { metadata: { jobIds: ids, method: result.method } });
    refresh();
    for (const id of ids) revalidatePath(`/jobs/${id}`);
    if (!result.analyzed) return { ok: false, message: "Analysis failed. Try again in a moment." };
    return { ok: true, message: result.analyzed === 1 ? "Job re-analyzed" : `Re-analyzed ${plural(result.analyzed, "job")}` };
  });
}

/** Analyze everything still waiting (e.g. after a restart interrupted a background run). */
export async function analyzePendingAction(): Promise<ActionResult> {
  return authedAction(async (user) => {
    const waiting = await prisma.job.count({ where: { userId: user.id, deletedAt: null, status: { in: ["IMPORTED", "ANALYZING"] } } });
    if (!waiting) return { ok: false, message: "No jobs are waiting for analysis." };
    await requeueStuck(user.id);
    analyzeInBackground(user.id);
    refresh();
    return { ok: true, message: `Analyzing ${plural(waiting, "job")}. Results appear as they finish.` };
  });
}

async function requeueStuck(userId: string) {
  // Jobs left in ANALYZING by an interrupted run go back to the queue.
  await prisma.job.updateMany({ where: { userId, deletedAt: null, status: "ANALYZING", updatedAt: { lt: new Date(Date.now() - 2 * 60_000) } }, data: { status: "IMPORTED" } });
}

export async function rescoreJobsAction(): Promise<ActionResult> {
  return authedAction(async (user) => {
    const result = await rescoreJobs(user.id);
    await audit(user.id, "jobs.rescored", { metadata: result });
    refresh();
    revalidatePath("/rules");
    return { ok: true, message: `Re-scored ${plural(result.rescored, "job")}. ${result.qualified} qualify under your rules.` };
  });
}

export async function saveAiSettingsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return authedAction(async (user) => {
    const parsed = aiSettingsSchema.safeParse(formToObject(formData));
    if (!parsed.success) return validationFailed(parsed.error);
    await saveAiSettings(user.id, parsed.data);
    await audit(user.id, "settings.ai_updated", { entityType: "UserSetting", metadata: { aiProvider: parsed.data.aiProvider } });
    revalidatePath("/settings");
    revalidatePath("/integrations");
    return { ok: true, message: "Analysis settings saved. New and re-analyzed jobs will use them." };
  });
}
