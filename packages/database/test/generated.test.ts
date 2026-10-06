import { beforeEach, describe, expect, it } from "vitest";
import { manualJobSchema, type CoverLetterContent, type ResumeContent } from "@autoapply/shared";
import { prisma } from "../src/client";
import { queueApplications } from "../src/repositories/applications";
import { createDocument, resolveResumeForJob } from "../src/repositories/documents";
import { NotFoundError } from "../src/repositories/errors";
import { approveGenerated, deleteGenerated, getGeneratedForJob, saveGeneratedCoverLetter, saveGeneratedResume, updateGenerated } from "../src/repositories/generated";
import { createManualJob } from "../src/repositories/jobs";
import { loadProcessingContext } from "../src/repositories/worker";
import { makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

const file = (key: string) => ({ fileName: `${key}.pdf`, mimeType: "application/pdf", sizeBytes: 1000, storageKey: key, sha256: "x" });
const generation = { method: "template" as const, model: null, fallbackReason: null, generatedAt: new Date().toISOString(), matchedSkills: [], edited: false };
const header = { name: "Jordan Rivera", headline: null, contact: [] };
const resume = (jobId: string, summary = "Seller."): ResumeContent => ({ version: 1, header, summary, skills: ["Salesforce"], experience: [], education: [], job: { id: jobId, title: "AE", company: "Acme" }, generation });
const letter = (jobId: string): CoverLetterContent => ({ version: 1, header, paragraphs: ["Dear Acme hiring team,", "Hello."], job: { id: jobId, title: "AE", company: "Acme" }, generation });

async function setup() {
  const user = await makeUser();
  const job = await createManualJob(user.id, manualJobSchema.parse({ url: "https://jobs.lever.co/acme/1", title: "AE", company: "Acme" }), "LEVER");
  const general = await createDocument(user.id, { type: "RESUME", name: "General", isDefault: true }, file("general"));
  return { user, job, general };
}

describe("generated documents", () => {
  it("keeps a draft out of applications until it's approved", async () => {
    const { user, job } = await setup();
    const { id } = await saveGeneratedResume(user.id, job.id, resume(job.id));
    expect((await resolveResumeForJob(user.id, job.id))?.name).toBe("General");

    await queueApplications(user.id, [job.id], { mode: "REVIEW" });
    const app = await prisma.application.findFirstOrThrow({ where: { jobId: job.id } });
    expect((await loadProcessingContext(app.id))?.resume?.name).toBe("General");

    const { removedKey } = await approveGenerated(user.id, "resume", id, "Resume for AE at Acme", file("tailored"));
    expect(removedKey).toBeNull();
    // The queued application switches to the approved, job-specific resume.
    expect((await prisma.application.findUniqueOrThrow({ where: { id: app.id } })).resumeId).toBe(id);
    expect((await loadProcessingContext(app.id))?.resume).toMatchObject({ id, storageKey: "tailored" });

    const view = await getGeneratedForJob(user.id, job.id);
    expect(view.resume).toMatchObject({ id, content: { summary: "Seller." }, document: { fileName: "tailored.pdf" } });
  });

  it("returns to draft on edit or regenerate, handing back the old file's key", async () => {
    const { user, job } = await setup();
    const { id } = await saveGeneratedResume(user.id, job.id, resume(job.id));
    await approveGenerated(user.id, "resume", id, "Resume", file("v1"));
    expect(await updateGenerated(user.id, "resume", id, resume(job.id, "Edited."))).toEqual({ removedKey: "v1" });
    expect((await getGeneratedForJob(user.id, job.id)).resume).toMatchObject({ document: null, content: { summary: "Edited." } });
    // While it's a draft, an application falls back to the default resume.
    await queueApplications(user.id, [job.id], { mode: "REVIEW" });
    const app = await prisma.application.findFirstOrThrow({ where: { jobId: job.id } });
    expect((await loadProcessingContext(app.id))?.resume?.name).toBe("General");

    await approveGenerated(user.id, "resume", id, "Resume", file("v2"));
    const again = await saveGeneratedResume(user.id, job.id, resume(job.id, "Fresh."));
    expect(again).toEqual({ id, removedKey: "v2" });
  });

  it("stores cover letters with their text, and deletes them", async () => {
    const { user, job } = await setup();
    const { id } = await saveGeneratedCoverLetter(user.id, job.id, letter(job.id));
    expect((await prisma.coverLetter.findUniqueOrThrow({ where: { id } })).body).toBe("Dear Acme hiring team,\n\nHello.");
    await approveGenerated(user.id, "coverLetter", id, "Cover letter", file("cl"));
    expect(await deleteGenerated(user.id, "coverLetter", id)).toEqual({ removedKey: "cl" });
    expect((await getGeneratedForJob(user.id, job.id)).coverLetter).toBeNull();
    expect(await prisma.document.count({ where: { userId: user.id, type: "COVER_LETTER" } })).toBe(0);
  });

  it("is scoped to the owner", async () => {
    const { user, job } = await setup();
    const other = await makeUser();
    const { id } = await saveGeneratedResume(user.id, job.id, resume(job.id));
    await expect(saveGeneratedResume(other.id, job.id, resume(job.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(approveGenerated(other.id, "resume", id, "x", file("x"))).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteGenerated(other.id, "resume", id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
