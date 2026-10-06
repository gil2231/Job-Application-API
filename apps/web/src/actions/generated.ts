"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeCoverLetterForJob, writeResumeForJob } from "@autoapply/ai";
import {
  approveGenerated,
  audit,
  consumeUsage,
  getEffectivePlan,
  refundUsage,
  deleteGenerated,
  getFullProfile,
  getGenerated,
  getJob,
  getUserSettings,
  saveGeneratedCoverLetter,
  saveGeneratedResume,
  updateGenerated,
  type GeneratedKind,
} from "@autoapply/database";
import { buildStorageKey, EXPORT_MIME, generatedFileName, getStorage, renderCoverLetter, renderResume, sha256Hex } from "@autoapply/documents";
import { MAX_COVER_LETTER_CHARS, MAX_SUMMARY_CHARS, toParagraphs, type CoverLetterContent, type ResumeContent } from "@autoapply/shared";
import { authedAction, type ActionResult } from "@/lib/action";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

const ID = /^[a-z0-9]{20,40}$/i;
const KINDS: readonly GeneratedKind[] = ["resume", "coverLetter"];
const NOUN: Record<GeneratedKind, string> = { resume: "Resume", coverLetter: "Cover letter" };

function refresh(jobId: string | null) {
  if (jobId) revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/documents");
}

async function removeStored(key: string | null) {
  if (key) await getStorage().delete(key).catch((error) => console.error("[generated] failed to delete stored file", error));
}

/** Write (or rewrite) the tailored resume or cover letter for a job from the Master Profile. */
export async function generateDocumentAction(jobId: string, kind: GeneratedKind): Promise<ActionResult> {
  return authedAction(async (user) => {
    if (!ID.test(jobId) || !KINDS.includes(kind)) return { ok: false, message: "Invalid request" };
    const limit = rateLimit(`generate:${user.id}`, LIMITS.generate.limit, LIMITS.generate.windowMs);
    if (!limit.allowed) return { ok: false, message: `Generation limit reached. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} min.` };

    const [job, profile, settings] = await Promise.all([getJob(user.id, jobId), getFullProfile(user.id), getUserSettings(user.id)]);
    if (!profile.firstName && !profile.employment.length) return { ok: false, message: "Add your name and work history to your Master Profile first." };
    const skills = (job.analysis as { skills?: unknown } | null)?.skills;
    const writingJob = { id: job.id, title: job.title, company: job.company, description: job.description, skills: Array.isArray(skills) ? skills.filter((s): s is string => typeof s === "string") : undefined };
    const ai = { provider: settings.aiProvider, model: settings.aiModel };

    if ((await consumeUsage(user.id, "tailoredDocuments")) === 0) {
      const plan = await getEffectivePlan(user.id);
      return { ok: false, message: `You've used all ${plan.limits.tailoredDocuments} tailored resumes and cover letters on your plan this month. Upgrade on the Billing page, or more open up next month.` };
    }
    let saved: Awaited<ReturnType<typeof saveGeneratedResume>>;
    let content: ResumeContent | CoverLetterContent;
    try {
      content = (kind === "resume" ? await writeResumeForJob(profile, writingJob, ai) : await writeCoverLetterForJob(profile, writingJob, ai)).content;
      saved = kind === "resume" ? await saveGeneratedResume(user.id, job.id, content as ResumeContent) : await saveGeneratedCoverLetter(user.id, job.id, content as CoverLetterContent);
    } catch (error) {
      await refundUsage(user.id, "tailoredDocuments", 1);
      throw error;
    }
    await removeStored(saved.removedKey);
    await audit(user.id, `generated.${kind}_created`, { entityType: kind === "resume" ? "Resume" : "CoverLetter", entityId: saved.id, metadata: { jobId: job.id, method: content.generation.method, model: content.generation.model } });
    refresh(job.id);
    const how = content.generation.method === "ai" ? "with AI" : "from your profile";
    return { ok: true, message: `${NOUN[kind]} written ${how}. Review it, then approve it for this job.` };
  });
}

const resumeEdits = z.object({
  summary: z.string().max(MAX_SUMMARY_CHARS, `Keep the summary under ${MAX_SUMMARY_CHARS} characters`),
  skills: z.string().max(2000),
});
const letterEdits = z.object({ text: z.string().min(1, "The letter can't be empty").max(MAX_COVER_LETTER_CHARS, `Keep the letter under ${MAX_COVER_LETTER_CHARS} characters`) });

/** Save the person's own edits. An approved document needs approving again afterwards. */
export async function saveGeneratedEditsAction(kind: GeneratedKind, id: string, edits: unknown): Promise<ActionResult> {
  return authedAction(async (user) => {
    if (!ID.test(id) || !KINDS.includes(kind)) return { ok: false, message: "Invalid request" };
    const current = await getGenerated(user.id, kind, id);
    let content: ResumeContent | CoverLetterContent;
    if (current.kind === "resume") {
      const parsed = resumeEdits.safeParse(edits);
      if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid edits" };
      const skills = [...new Set(parsed.data.skills.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))].slice(0, 40);
      content = { ...current.content, summary: parsed.data.summary.trim() || null, skills, generation: { ...current.content.generation, edited: true } };
    } else {
      const parsed = letterEdits.safeParse(edits);
      if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid edits" };
      content = { ...current.content, paragraphs: toParagraphs(parsed.data.text), generation: { ...current.content.generation, edited: true } };
    }
    const { removedKey } = await updateGenerated(user.id, kind, id, content);
    await removeStored(removedKey);
    await audit(user.id, `generated.${kind}_edited`, { entityType: kind === "resume" ? "Resume" : "CoverLetter", entityId: id });
    refresh(current.jobId);
    return { ok: true, message: removedKey ? "Saved. Approve it again to use the edited version." : "Saved" };
  });
}

/** Render the PDF and use it for this job's application. */
export async function approveGeneratedAction(kind: GeneratedKind, id: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    if (!ID.test(id) || !KINDS.includes(kind)) return { ok: false, message: "Invalid request" };
    const current = await getGenerated(user.id, kind, id);
    const body = Buffer.from(current.kind === "resume" ? await renderResume(current.content, "pdf") : await renderCoverLetter(current.content, "pdf"));
    const fileName = generatedFileName(kind === "resume" ? "resume" : "cover-letter", current.content, "pdf");
    const storageKey = buildStorageKey(user.id, kind === "resume" ? "RESUME" : "COVER_LETTER", "pdf");
    await getStorage().put(storageKey, body, EXPORT_MIME.pdf);
    try {
      const name = `${NOUN[kind]} for ${current.content.job.title} at ${current.content.job.company}`.slice(0, 200);
      const { removedKey, documentId } = await approveGenerated(user.id, kind, id, name, { fileName, mimeType: EXPORT_MIME.pdf, sizeBytes: body.length, storageKey, sha256: sha256Hex(body) });
      await removeStored(removedKey);
      await audit(user.id, `generated.${kind}_approved`, { entityType: "Document", entityId: documentId, metadata: { jobId: current.jobId } });
    } catch (error) {
      await getStorage().delete(storageKey).catch(() => undefined);
      throw error;
    }
    refresh(current.jobId);
    return { ok: true, message: `${NOUN[kind]} approved. The application for this job will use it.` };
  });
}

export async function deleteGeneratedAction(kind: GeneratedKind, id: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    if (!ID.test(id) || !KINDS.includes(kind)) return { ok: false, message: "Invalid request" };
    const current = await getGenerated(user.id, kind, id);
    const { removedKey } = await deleteGenerated(user.id, kind, id);
    await removeStored(removedKey);
    await audit(user.id, `generated.${kind}_deleted`, { entityType: kind === "resume" ? "Resume" : "CoverLetter", entityId: id });
    refresh(current.jobId);
    return { ok: true, message: `${NOUN[kind]} removed` };
  });
}
