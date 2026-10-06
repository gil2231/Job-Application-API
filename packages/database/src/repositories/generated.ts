import { coverLetterContentSchema, resumeContentSchema, type CoverLetterContent, type ResumeContent } from "@autoapply/shared";
import { prisma } from "../client";
import type { StoredFileMeta } from "./documents";
import { NotFoundError } from "./errors";

/**
 * Generated, job-specific resumes and cover letters. Each job has at most one
 * of each. A generated document starts as a draft (content only); it's used for
 * the job's application only after the person approves it, which stores the
 * rendered file as a Document. Editing or regenerating makes it a draft again.
 */

export type GeneratedKind = "resume" | "coverLetter";

/** Applications for the job that haven't started or finished can still switch documents. */
const SWITCHABLE = ["QUEUED", "WAITING_FOR_USER", "REVIEW_REQUIRED", "READY", "FAILED"] as const;

async function assertJob(userId: string, jobId: string) {
  const job = await prisma.job.findFirst({ where: { id: jobId, userId, deletedAt: null }, select: { id: true, title: true, company: true } });
  if (!job) throw new NotFoundError("Job");
  return job;
}

function parseResume(content: unknown): ResumeContent | null {
  const parsed = resumeContentSchema.safeParse(content);
  return parsed.success ? parsed.data : null;
}

function parseCoverLetter(content: unknown): CoverLetterContent | null {
  const parsed = coverLetterContentSchema.safeParse(content);
  return parsed.success ? parsed.data : null;
}

export async function getGeneratedForJob(userId: string, jobId: string) {
  const [resume, coverLetter] = await Promise.all([
    prisma.resume.findFirst({ where: { userId, jobId, generated: true }, orderBy: { updatedAt: "desc" }, include: { document: { select: { id: true, fileName: true, createdAt: true } } } }),
    prisma.coverLetter.findFirst({ where: { userId, jobId, generated: true }, orderBy: { updatedAt: "desc" }, include: { document: { select: { id: true, fileName: true, createdAt: true } } } }),
  ]);
  return {
    resume: resume ? { id: resume.id, content: parseResume(resume.content), document: resume.document, updatedAt: resume.updatedAt } : null,
    coverLetter: coverLetter ? { id: coverLetter.id, content: parseCoverLetter(coverLetter.content), document: coverLetter.document, updatedAt: coverLetter.updatedAt } : null,
  };
}
export type GeneratedForJob = Awaited<ReturnType<typeof getGeneratedForJob>>;

export async function getGenerated(userId: string, kind: GeneratedKind, id: string) {
  if (kind === "resume") {
    const row = await prisma.resume.findFirst({ where: { id, userId, generated: true } });
    const content = row ? parseResume(row.content) : null;
    if (!row || !content) throw new NotFoundError("Generated resume");
    return { kind, id: row.id, jobId: row.jobId, documentId: row.documentId, content } as const;
  }
  const row = await prisma.coverLetter.findFirst({ where: { id, userId, generated: true } });
  const content = row ? parseCoverLetter(row.content) : null;
  if (!row || !content) throw new NotFoundError("Generated cover letter");
  return { kind, id: row.id, jobId: row.jobId, documentId: row.documentId, content } as const;
}

/** Remove the approved file behind a generated document; returns its storage key so the caller can delete the bytes. */
async function detach(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], documentId: string | null): Promise<string | null> {
  if (!documentId) return null;
  const doc = await tx.document.findUnique({ where: { id: documentId }, select: { storageKey: true } });
  if (!doc) return null;
  await tx.document.delete({ where: { id: documentId } });
  return doc.storageKey;
}

/**
 * Store freshly generated content for a job, replacing the previous draft or
 * approved version. Returns the row id and the storage key of any file that
 * was replaced.
 */
export async function saveGeneratedResume(userId: string, jobId: string, content: ResumeContent): Promise<{ id: string; removedKey: string | null }> {
  const job = await assertJob(userId, jobId);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.resume.findFirst({ where: { userId, jobId, generated: true } });
    const name = `Resume for ${job.title} at ${job.company}`.slice(0, 200);
    if (!existing) {
      const row = await tx.resume.create({ data: { userId, jobId, name, generated: true, content } });
      return { id: row.id, removedKey: null };
    }
    const removedKey = await detach(tx, existing.documentId);
    await tx.resume.update({ where: { id: existing.id }, data: { content, name, documentId: null } });
    return { id: existing.id, removedKey };
  });
}

export async function saveGeneratedCoverLetter(userId: string, jobId: string, content: CoverLetterContent): Promise<{ id: string; removedKey: string | null }> {
  const job = await assertJob(userId, jobId);
  const body = content.paragraphs.join("\n\n");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.coverLetter.findFirst({ where: { userId, jobId, generated: true } });
    const name = `Cover letter for ${job.title} at ${job.company}`.slice(0, 200);
    if (!existing) {
      const row = await tx.coverLetter.create({ data: { userId, jobId, name, generated: true, content, body } });
      return { id: row.id, removedKey: null };
    }
    const removedKey = await detach(tx, existing.documentId);
    await tx.coverLetter.update({ where: { id: existing.id }, data: { content, body, name, documentId: null } });
    return { id: existing.id, removedKey };
  });
}

/** Save the person's edits. An approved document goes back to draft, since its file no longer matches. */
export async function updateGenerated(userId: string, kind: GeneratedKind, id: string, content: ResumeContent | CoverLetterContent): Promise<{ removedKey: string | null }> {
  const current = await getGenerated(userId, kind, id);
  return prisma.$transaction(async (tx) => {
    const removedKey = await detach(tx, current.documentId);
    if (kind === "resume") await tx.resume.update({ where: { id }, data: { content: content as ResumeContent, documentId: null } });
    else await tx.coverLetter.update({ where: { id }, data: { content: content as CoverLetterContent, body: (content as CoverLetterContent).paragraphs.join("\n\n"), documentId: null } });
    return { removedKey };
  });
}

/**
 * Approve a generated document: record its rendered file and use it for the
 * job's application, including one already queued that hasn't started.
 */
export async function approveGenerated(userId: string, kind: GeneratedKind, id: string, name: string, file: StoredFileMeta): Promise<{ removedKey: string | null; documentId: string }> {
  const current = await getGenerated(userId, kind, id);
  return prisma.$transaction(async (tx) => {
    const removedKey = await detach(tx, current.documentId);
    const document = await tx.document.create({ data: { userId, type: kind === "resume" ? "RESUME" : "COVER_LETTER", name, ...file } });
    if (kind === "resume") {
      await tx.resume.update({ where: { id }, data: { documentId: document.id } });
      if (current.jobId) await tx.application.updateMany({ where: { userId, jobId: current.jobId, status: { in: [...SWITCHABLE] } }, data: { resumeId: id } });
    } else {
      await tx.coverLetter.update({ where: { id }, data: { documentId: document.id } });
      if (current.jobId) await tx.application.updateMany({ where: { userId, jobId: current.jobId, status: { in: [...SWITCHABLE] } }, data: { coverLetterId: id } });
    }
    return { removedKey, documentId: document.id };
  });
}

/** Delete a generated document. Applications that used it fall back to the default on their next run. */
export async function deleteGenerated(userId: string, kind: GeneratedKind, id: string): Promise<{ removedKey: string | null }> {
  const current = await getGenerated(userId, kind, id);
  return prisma.$transaction(async (tx) => {
    if (kind === "resume") {
      await tx.resume.delete({ where: { id } });
    } else {
      await tx.coverLetter.delete({ where: { id } });
    }
    return { removedKey: await detach(tx, current.documentId) };
  });
}
