"use server";

import { revalidatePath } from "next/cache";
import {
  audit,
  createManualJob,
  deleteJobs,
  DuplicateJobError,
  prisma,
  queueAllQualified,
  queueApplications,
  restoreJob,
  retryApplications,
  skipJobs,
} from "@autoapply/database";
import { detectPlatformFromUrl } from "@autoapply/ats-adapters";
import { jobFingerprint } from "@autoapply/ingestion";
import { AUTOMATION_MODES, manualJobSchema, type AutomationMode } from "@autoapply/shared";
import { authedAction, formToObject, parseIds, validationFailed, type ActionResult } from "@/lib/action";
import { analyzeInBackground } from "@/lib/pipeline";
import { notifyWorker } from "@/lib/worker-queue";

function refresh() {
  revalidatePath("/jobs");
  revalidatePath("/applications");
  revalidatePath("/dashboard");
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export async function addJobAction(_prev: ActionResult<{ jobId: string; deleted?: boolean }>, formData: FormData): Promise<ActionResult<{ jobId: string; deleted?: boolean }>> {
  return authedAction<{ jobId: string; deleted?: boolean }>(async (user) => {
    const parsed = manualJobSchema.safeParse(formToObject(formData));
    if (!parsed.success) return validationFailed(parsed.error);
    const detection = detectPlatformFromUrl(parsed.data.applicationUrl ?? parsed.data.url);
    try {
      const job = await createManualJob(user.id, parsed.data, detection.platform, { fingerprint: jobFingerprint(parsed.data.company, parsed.data.title) });
      await audit(user.id, "job.added", { entityType: "Job", entityId: job.id, metadata: { platform: job.platform } });
      analyzeInBackground(user.id);
      refresh();
      return { ok: true, message: `Added ${job.title} at ${job.company}`, data: { jobId: job.id } };
    } catch (error) {
      if (error instanceof DuplicateJobError) {
        return {
          ok: false,
          message: error.wasDeleted ? "You deleted this job earlier." : "This job is already in your list.",
          errors: { url: error.message },
          data: { jobId: error.existingJobId, deleted: error.wasDeleted },
        };
      }
      throw error;
    }
  });
}

export async function applyToJobsAction(jobIds: string[], mode?: AutomationMode): Promise<ActionResult> {
  return authedAction(async (user) => {
    const ids = parseIds(jobIds);
    if (!ids.length) return { ok: false, message: "Select at least one job" };
    if (mode != null && !AUTOMATION_MODES.includes(mode)) return { ok: false, message: "Unknown mode" };
    const result = await queueApplications(user.id, ids, { mode });
    await audit(user.id, "application.queued", { metadata: { jobIds: ids, ...result } });
    if (result.queued) await notifyWorker(user.id);
    refresh();
    if (result.queued === 0) return { ok: false, message: result.duplicates ? "Already applied or queued. Each job gets one application." : "No jobs were queued." };
    const extra = result.duplicates ? ` (${plural(result.duplicates, "job")} already had one)` : "";
    return { ok: true, message: `Queued ${plural(result.queued, "application")} in ${result.mode.toLowerCase()} mode${extra}` };
  });
}

export async function applyToAllQualifiedAction(): Promise<ActionResult> {
  return authedAction(async (user) => {
    const result = await queueAllQualified(user.id);
    await audit(user.id, "application.queued_all_qualified", { metadata: result });
    if (result.queued) await notifyWorker(user.id);
    refresh();
    return result.queued
      ? { ok: true, message: `Queued ${plural(result.queued, "application")} in ${result.mode.toLowerCase()} mode` }
      : { ok: false, message: "There are no qualified jobs waiting to be applied to." };
  });
}

export async function skipJobsAction(jobIds: string[]): Promise<ActionResult> {
  return authedAction(async (user) => {
    const ids = parseIds(jobIds);
    const result = await skipJobs(user.id, ids);
    await audit(user.id, "job.skipped", { metadata: { jobIds: ids, ...result } });
    refresh();
    if (!result.skipped) return { ok: false, message: "Nothing to skip. Submitted and in-progress applications can't be skipped." };
    return { ok: true, message: `Skipped ${plural(result.skipped, "job")}` };
  });
}

export async function deleteJobsAction(jobIds: string[]): Promise<ActionResult> {
  return authedAction(async (user) => {
    const ids = parseIds(jobIds);
    const result = await deleteJobs(user.id, ids);
    await audit(user.id, "job.deleted", { metadata: { jobIds: ids, ...result } });
    refresh();
    return { ok: true, message: `Deleted ${plural(result.deleted, "job")}` };
  });
}

export async function retryJobsAction(jobIds: string[]): Promise<ActionResult> {
  return authedAction(async (user) => {
    const ids = parseIds(jobIds);
    const apps = await prisma.application.findMany({ where: { userId: user.id, jobId: { in: ids } }, select: { id: true } });
    const result = await retryApplications(user.id, apps.map((a) => a.id));
    await audit(user.id, "application.retried", { metadata: { jobIds: ids, ...result } });
    if (result.retried) await notifyWorker(user.id);
    refresh();
    return result.retried
      ? { ok: true, message: `Requeued ${plural(result.retried, "failed application")}` }
      : { ok: false, message: "Only failed applications can be retried." };
  });
}

export async function restoreJobAction(jobId: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const [id] = parseIds([jobId]);
    if (!id) return { ok: false, message: "Invalid id" };
    await restoreJob(user.id, id);
    await audit(user.id, "job.restored", { entityType: "Job", entityId: id });
    refresh();
    return { ok: true, message: "Job restored" };
  });
}
