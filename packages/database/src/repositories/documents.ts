import type { DocumentType } from "@autoapply/shared";
import { prisma } from "../client";
import { NotFoundError } from "./errors";

export interface StoredFileMeta {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  sha256: string;
}

/**
 * Record an uploaded document. Resumes and cover letters also get a Resume /
 * CoverLetter row so applications can reference a specific variant; making one
 * the default clears the previous default in the same transaction.
 */
export async function createDocument(
  userId: string,
  input: { type: DocumentType; name: string; isDefault: boolean; jobId?: string | null },
  file: StoredFileMeta,
) {
  if (input.jobId) {
    const job = await prisma.job.findFirst({ where: { id: input.jobId, userId, deletedAt: null }, select: { id: true } });
    if (!job) throw new NotFoundError("Job");
  }
  const jobId = input.jobId ?? null;
  const isDefault = input.isDefault && !jobId;

  return prisma.$transaction(async (tx) => {
    const document = await tx.document.create({ data: { userId, type: input.type, name: input.name, ...file } });
    if (input.type === "RESUME") {
      const hasDefault = await tx.resume.count({ where: { userId, isDefault: true, jobId: null } });
      const makeDefault = !jobId && (isDefault || hasDefault === 0);
      if (makeDefault) await tx.resume.updateMany({ where: { userId, isDefault: true, jobId: null }, data: { isDefault: false } });
      await tx.resume.create({ data: { userId, name: input.name, documentId: document.id, jobId, isDefault: makeDefault } });
    } else if (input.type === "COVER_LETTER") {
      const hasDefault = await tx.coverLetter.count({ where: { userId, isDefault: true, jobId: null } });
      const makeDefault = !jobId && (isDefault || hasDefault === 0);
      if (makeDefault) await tx.coverLetter.updateMany({ where: { userId, isDefault: true, jobId: null }, data: { isDefault: false } });
      await tx.coverLetter.create({ data: { userId, name: input.name, documentId: document.id, jobId, isDefault: makeDefault } });
    }
    return document;
  });
}

export async function listDocuments(userId: string) {
  const docs = await prisma.document.findMany({
    where: { userId },
    orderBy: [{ type: "asc" }, { createdAt: "desc" }],
    include: {
      resume: { select: { id: true, isDefault: true, job: { select: { id: true, title: true, company: true } } } },
      coverLetter: { select: { id: true, isDefault: true, job: { select: { id: true, title: true, company: true } } } },
    },
  });
  return docs.map((d) => {
    const variant = d.resume ?? d.coverLetter;
    return {
      id: d.id,
      type: d.type,
      name: d.name,
      fileName: d.fileName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      createdAt: d.createdAt,
      isDefault: variant?.isDefault ?? false,
      job: variant?.job ?? null,
    };
  });
}
export type DocumentListItem = Awaited<ReturnType<typeof listDocuments>>[number];

export async function getDocument(userId: string, id: string) {
  const doc = await prisma.document.findFirst({ where: { id, userId } });
  if (!doc) throw new NotFoundError("Document");
  return doc;
}

/** Delete a document's row and return its storage key so the caller can delete the bytes. */
export async function deleteDocument(userId: string, id: string): Promise<string> {
  const doc = await getDocument(userId, id);
  await prisma.$transaction(async (tx) => {
    const resume = await tx.resume.findUnique({ where: { documentId: id } });
    const letter = await tx.coverLetter.findUnique({ where: { documentId: id } });
    if (resume) await tx.resume.delete({ where: { id: resume.id } });
    if (letter) await tx.coverLetter.delete({ where: { id: letter.id } });
    await tx.document.delete({ where: { id } });
    // Promote the newest remaining general resume / cover letter to default.
    if (resume?.isDefault) {
      const next = await tx.resume.findFirst({ where: { userId, jobId: null }, orderBy: { createdAt: "desc" } });
      if (next) await tx.resume.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    if (letter?.isDefault) {
      const next = await tx.coverLetter.findFirst({ where: { userId, jobId: null }, orderBy: { createdAt: "desc" } });
      if (next) await tx.coverLetter.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
  return doc.storageKey;
}

export async function setDefaultDocument(userId: string, documentId: string): Promise<void> {
  const doc = await prisma.document.findFirst({ where: { id: documentId, userId }, include: { resume: true, coverLetter: true } });
  if (!doc) throw new NotFoundError("Document");
  await prisma.$transaction(async (tx) => {
    if (doc.resume) {
      await tx.resume.updateMany({ where: { userId, isDefault: true, jobId: null }, data: { isDefault: false } });
      await tx.resume.update({ where: { id: doc.resume.id }, data: { isDefault: true, jobId: null } });
    } else if (doc.coverLetter) {
      await tx.coverLetter.updateMany({ where: { userId, isDefault: true, jobId: null }, data: { isDefault: false } });
      await tx.coverLetter.update({ where: { id: doc.coverLetter.id }, data: { isDefault: true, jobId: null } });
    } else {
      throw new NotFoundError("Resume or cover letter");
    }
  });
}

export async function countResumes(userId: string): Promise<number> {
  return prisma.resume.count({ where: { userId } });
}

/** The resume an application for this job should use: job-specific first, else the default. */
export async function resolveResumeForJob(userId: string, jobId: string) {
  return (
    (await prisma.resume.findFirst({ where: { userId, jobId }, orderBy: { createdAt: "desc" } })) ??
    (await prisma.resume.findFirst({ where: { userId, isDefault: true, jobId: null } }))
  );
}

export async function resolveCoverLetterForJob(userId: string, jobId: string) {
  return (
    (await prisma.coverLetter.findFirst({ where: { userId, jobId }, orderBy: { createdAt: "desc" } })) ??
    (await prisma.coverLetter.findFirst({ where: { userId, isDefault: true, jobId: null } }))
  );
}
