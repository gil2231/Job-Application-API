import { beforeEach, describe, expect, it } from "vitest";
import { jobFiltersSchema, applicationFiltersSchema, manualJobSchema } from "@autoapply/shared";
import { prisma } from "../src/client";
import { createManualJob, deleteJobs, DuplicateJobError, getJob, listJobs, skipJobs } from "../src/repositories/jobs";
import {
  approveQuestionAnswer, getApplicationDetail, listApplications, listAttentionItems, markHumanStepComplete, queueApplications,
  retryApplications, setApplicationOutcome, skipQuestion,
} from "../src/repositories/applications";
import { NotFoundError } from "../src/repositories/errors";
import { getDashboardStats } from "../src/repositories/dashboard";
import { makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

const job = (url: string, extra: Partial<Record<string, string>> = {}) =>
  manualJobSchema.parse({ url, title: "Business Development Rep", company: "Acme", location: "New York, NY", salaryText: "$70,000 - $80,000", ...extra });

describe("jobs", () => {
  it("creates a manual job with parsed salary and canonical URL", async () => {
    const user = await makeUser();
    const created = await createManualJob(user.id, job("https://boards.greenhouse.io/acme/jobs/1?utm_source=li"), "GREENHOUSE");
    expect(created).toMatchObject({ canonicalUrl: "https://boards.greenhouse.io/acme/jobs/1", salaryMin: 70000, salaryAnnualMax: 80000, platform: "GREENHOUSE" });
  });

  it("deduplicates equivalent URLs, including deleted jobs", async () => {
    const user = await makeUser();
    const first = await createManualJob(user.id, job("https://jobs.lever.co/acme/abc"), "LEVER");
    await expect(createManualJob(user.id, job("https://jobs.lever.co/acme/abc/?utm_campaign=x"), "LEVER")).rejects.toBeInstanceOf(DuplicateJobError);
    await deleteJobs(user.id, [first.id]);
    await expect(createManualJob(user.id, job("https://jobs.lever.co/acme/abc"), "LEVER")).rejects.toMatchObject({ wasDeleted: true });
  });

  it("enforces per-user URL uniqueness in the database", async () => {
    const user = await makeUser();
    const created = await createManualJob(user.id, job("https://example.com/careers/1"), "GENERIC");
    await expect(
      prisma.job.create({ data: { userId: user.id, sourceType: "MANUAL", url: created.url, canonicalUrl: created.canonicalUrl, title: "x", company: "y" } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("lets two users save the same job but isolates them", async () => {
    const a = await makeUser("A");
    const b = await makeUser("B");
    const aJob = await createManualJob(a.id, job("https://example.com/careers/1"), "GENERIC");
    await createManualJob(b.id, job("https://example.com/careers/1"), "GENERIC");
    expect((await listJobs(a.id, jobFiltersSchema.parse({}))).total).toBe(1);
    await expect(getJob(b.id, aJob.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await deleteJobs(b.id, [aJob.id])).deleted).toBe(0);
    expect((await skipJobs(b.id, [aJob.id])).skipped).toBe(0);
    expect(await getJob(a.id, aJob.id)).toMatchObject({ status: "IMPORTED" });
  });

  it("filters by pipeline status across jobs and applications", async () => {
    const user = await makeUser();
    const j1 = await createManualJob(user.id, job("https://example.com/1"), "GENERIC");
    await createManualJob(user.id, job("https://example.com/2", { company: "Globex" }), "GENERIC");
    await queueApplications(user.id, [j1.id]);
    const imported = await listJobs(user.id, jobFiltersSchema.parse({ status: "IMPORTED" }));
    const queued = await listJobs(user.id, jobFiltersSchema.parse({ status: "QUEUED" }));
    expect(imported.rows.map((r) => r.company)).toEqual(["Globex"]);
    expect(queued.rows.map((r) => r.id)).toEqual([j1.id]);
    expect(queued.rows[0]!.pipelineStatus).toBe("QUEUED");
    expect((await listJobs(user.id, jobFiltersSchema.parse({ company: "glob" }))).total).toBe(1);
    expect((await listJobs(user.id, jobFiltersSchema.parse({ minSalary: "90000" }))).total).toBe(0);
  });
});

describe("applications", () => {
  it("never creates two applications for one job", async () => {
    const user = await makeUser();
    const j = await createManualJob(user.id, job("https://example.com/1"), "GENERIC");
    expect(await queueApplications(user.id, [j.id])).toMatchObject({ queued: 1, duplicates: 0 });
    expect(await queueApplications(user.id, [j.id])).toMatchObject({ queued: 0, duplicates: 1 });
    await expect(prisma.application.create({ data: { userId: user.id, jobId: j.id } })).rejects.toMatchObject({ code: "P2002" });
    expect(await prisma.application.count()).toBe(1);
  });

  it("downgrades AUTO to REVIEW unless auto-submit is enabled", async () => {
    const user = await makeUser();
    const j1 = await createManualJob(user.id, job("https://example.com/1"), "GENERIC");
    expect((await queueApplications(user.id, [j1.id], { mode: "AUTO" })).mode).toBe("REVIEW");
    await prisma.automationRule.update({ where: { userId: user.id }, data: { autoSubmitEnabled: true } });
    const j2 = await createManualJob(user.id, job("https://example.com/2"), "GENERIC");
    expect((await queueApplications(user.id, [j2.id], { mode: "AUTO" })).mode).toBe("AUTO");
  });

  it("attaches the default resume, preferring a job-specific one", async () => {
    const user = await makeUser();
    const j = await createManualJob(user.id, job("https://example.com/1"), "GENERIC");
    const general = await prisma.resume.create({ data: { userId: user.id, name: "General", isDefault: true } });
    await queueApplications(user.id, [j.id]);
    expect((await prisma.application.findFirstOrThrow()).resumeId).toBe(general.id);
  });

  it("retries only failed applications", async () => {
    const user = await makeUser();
    const j = await createManualJob(user.id, job("https://example.com/1"), "GENERIC");
    await queueApplications(user.id, [j.id]);
    const app = await prisma.application.findFirstOrThrow();
    expect((await retryApplications(user.id, [app.id])).retried).toBe(0);
    await prisma.application.update({ where: { id: app.id }, data: { status: "FAILED", failureType: "TIMEOUT", lastError: "x" } });
    expect((await retryApplications(user.id, [app.id])).retried).toBe(1);
    expect(await prisma.application.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status: "QUEUED", failureType: null });
  });

  it("runs the question review flow and resumes when everything is reviewed", async () => {
    const user = await makeUser();
    const j = await createManualJob(user.id, job("https://example.com/1"), "GENERIC");
    await queueApplications(user.id, [j.id]);
    const app = await prisma.application.update({
      where: { jobId: j.id },
      data: { status: "REVIEW_REQUIRED", attentionReason: "QUESTION_REVIEW" },
    });
    const salary = await prisma.applicationQuestion.create({
      data: { applicationId: app.id, label: "What are your salary expectations?", normalizedKey: "salary", required: true, status: "NEEDS_REVIEW",
        answer: { create: { value: "$70,000–$80,000", source: "AI_GENERATED", confidence: 60 } } },
    });
    const optional = await prisma.applicationQuestion.create({
      data: { applicationId: app.id, label: "How did you hear about us?", normalizedKey: "referral", required: false, status: "NEEDS_REVIEW" },
    });

    const items = await listAttentionItems(user.id);
    expect(items).toHaveLength(1);
    expect(items[0]!.questions).toHaveLength(2);

    await expect(skipQuestion(user.id, salary.id)).rejects.toThrow(/required/);
    await expect(markHumanStepComplete(user.id, app.id)).rejects.toThrow(/questions/);

    await approveQuestionAnswer(user.id, salary.id, "$75,000");
    expect((await prisma.application.findUniqueOrThrow({ where: { id: app.id } })).status).toBe("REVIEW_REQUIRED");
    await skipQuestion(user.id, optional.id);

    const after = await getApplicationDetail(user.id, app.id);
    expect(after.status).toBe("QUEUED");
    expect(after.questions.find((q) => q.id === salary.id)?.answer).toMatchObject({ value: "$75,000", approvedByUser: true, source: "USER" });
    expect(after.events.map((e) => e.type)).toContain("HUMAN_INPUT_RECEIVED");
  });

  it("resumes after a CAPTCHA is completed and refuses other users", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const j = await createManualJob(user.id, job("https://example.com/1"), "GENERIC");
    await queueApplications(user.id, [j.id]);
    const app = await prisma.application.update({ where: { jobId: j.id }, data: { status: "WAITING_FOR_USER", attentionReason: "CAPTCHA" } });
    await expect(markHumanStepComplete(other.id, app.id)).rejects.toBeInstanceOf(NotFoundError);
    await markHumanStepComplete(user.id, app.id);
    expect(await prisma.application.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status: "QUEUED", attentionReason: null, priority: 10 });
  });

  it("records outcomes only for submitted applications and feeds the dashboard", async () => {
    const user = await makeUser();
    const j = await createManualJob(user.id, job("https://example.com/1"), "GENERIC");
    await queueApplications(user.id, [j.id]);
    const app = await prisma.application.findFirstOrThrow();
    await expect(setApplicationOutcome(user.id, app.id, "INTERVIEW")).rejects.toThrow(/submitted/);
    await prisma.application.update({ where: { id: app.id }, data: { status: "SUBMITTED", submittedAt: new Date() } });
    await setApplicationOutcome(user.id, app.id, "INTERVIEW");

    const stats = await getDashboardStats(user.id);
    expect(stats.cards).toMatchObject({ totalJobs: 1, applicationsSent: 1, needsReview: 0, failed: 0 });
    expect(stats.responses).toMatchObject({ interviews: 1, interviewRate: 100 });
    expect(stats.weekly.at(-1)?.count).toBe(1);

    const list = await listApplications(user.id, applicationFiltersSchema.parse({ status: "SUBMITTED" }));
    expect(list.total).toBe(1);
    expect(list.statusCounts.SUBMITTED).toBe(1);
  });

  it("withdraws pending applications when their job is deleted, and refuses while processing", async () => {
    const user = await makeUser();
    const j = await createManualJob(user.id, job("https://example.com/1"), "GENERIC");
    await queueApplications(user.id, [j.id]);
    await prisma.application.update({ where: { jobId: j.id }, data: { status: "PROCESSING" } });
    await expect(deleteJobs(user.id, [j.id])).rejects.toThrow(/processing/i);
    await prisma.application.update({ where: { jobId: j.id }, data: { status: "QUEUED" } });
    await deleteJobs(user.id, [j.id]);
    expect((await prisma.application.findFirstOrThrow()).status).toBe("SKIPPED");
  });
});
