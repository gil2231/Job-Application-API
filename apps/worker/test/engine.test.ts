import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approveForSubmission, approveQuestionAnswer, claimApplication, markHumanStepComplete, prisma, setQueueState } from "@autoapply/database";
import { startMockSite, type MockSite } from "../mock-site/server";
import { loadApplication, makeApplicant, makeEngine, queueFor, resetDatabase, runOnce, VisibleBrowserPool } from "./helpers";

let site: MockSite;
const { engine, browsers, workerId } = makeEngine();

beforeAll(async () => {
  site = await startMockSite();
});
afterAll(async () => {
  await browsers.close();
  await site.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase();
  site.reset();
});

describe("simple form", () => {
  it("fills and submits in Auto mode when every check passes", async () => {
    const user = await makeApplicant();
    const app = await queueFor(user.id, `${site.url}/simple`, { mode: "AUTO" });
    const outcome = await runOnce(engine, workerId, app.id);
    expect(outcome).toMatchObject({ claimed: true, result: "finished" });
    const after = await loadApplication(app.id);
    expect(after.status, after.attentionDetail ?? after.lastError ?? "").toBe("SUBMITTED");
    expect(after.confirmationNumber).toMatch(/^MOCK-/);
    expect(site.submissions).toHaveLength(1);
    expect(site.submissions[0]!.fields).toMatchObject({ first_name: "Jordan", last_name: "Rivera", email: "jordan@example.com", mobile: "212-555-0100", linkedin: "https://www.linkedin.com/in/jordan-rivera" });
    expect(site.submissions[0]!.files.resume?.name).toBe("jordan-rivera-resume.pdf");
    const types = after.events.map((e) => e.type);
    for (const t of ["PROFILE_LOADED", "BROWSER_LAUNCHED", "PLATFORM_DETECTED", "FIELDS_MAPPED", "RESUME_UPLOADED", "VALIDATION_COMPLETED", "SUBMITTED"]) expect(types).toContain(t);
    expect(after.attempts[0]!.status).toBe("SUCCEEDED");
    expect((after.attempts[0]!.screenshots as unknown[]).length).toBeGreaterThan(1);
    expect(after.lockedBy).toBeNull();
  });
});

describe("automation modes", () => {
  it("Review mode fills everything, stops before submitting, and submits after approval", async () => {
    const user = await makeApplicant({ mode: "REVIEW" });
    const app = await queueFor(user.id, `${site.url}/simple`, { mode: "REVIEW" });
    await runOnce(engine, workerId, app.id);
    let after = await loadApplication(app.id);
    expect(after.status).toBe("REVIEW_REQUIRED");
    expect(after.attentionReason).toBe("FINAL_REVIEW");
    expect(site.submissions).toHaveLength(0);
    expect(after.questions.find((q) => q.normalizedKey === "first_name")?.answer?.value).toBe("Jordan");

    await approveForSubmission(user.id, app.id);
    await runOnce(engine, workerId, app.id);
    after = await loadApplication(app.id);
    expect(after.status).toBe("SUBMITTED");
    expect(site.submissions).toHaveLength(1);
    expect(after.events.find((e) => e.type === "SUBMITTED")?.message).toContain("after your approval");
  });

  it("Manual mode fills the form and hands the final click to the user", async () => {
    const user = await makeApplicant({ mode: "MANUAL" });
    const app = await queueFor(user.id, `${site.url}/simple`, { mode: "MANUAL" });
    await runOnce(engine, workerId, app.id);
    const after = await loadApplication(app.id);
    expect(after.status).toBe("READY");
    expect(after.attentionReason).toBe("FINAL_REVIEW");
    expect(site.submissions).toHaveLength(0);
  });

  it("Auto mode downgrades to review when auto-submit is turned off", async () => {
    const user = await makeApplicant({ autoSubmit: false });
    const app = await queueFor(user.id, `${site.url}/simple`);
    await prisma.application.update({ where: { id: app.id }, data: { mode: "AUTO" } });
    await runOnce(engine, workerId, app.id);
    const after = await loadApplication(app.id);
    expect(after.status).toBe("REVIEW_REQUIRED");
    expect(after.attentionDetail).toContain("auto-submit is turned off");
    expect(site.submissions).toHaveLength(0);
  });

  it("Auto mode stops on contradictory information", async () => {
    const user = await makeApplicant({
      library: [
        { key: "work_authorization", question: "Are you legally authorized to work in this country?", answer: "Yes", category: "WORK_AUTHORIZATION" },
        { key: "sponsorship", question: "Will you now or in the future require visa sponsorship?", answer: "Yes", category: "SPONSORSHIP" },
      ],
    });
    const app = await queueFor(user.id, `${site.url}/checkboxes`, { mode: "AUTO" });
    await prisma.applicationAnswer.updateMany({ where: { userId: user.id }, data: {} });
    await runOnce(engine, workerId, app.id);
    const after = await loadApplication(app.id);
    // The privacy checkbox is unknown, so it stops for that first; answer it, then the contradiction shows.
    expect(after.status).toBe("REVIEW_REQUIRED");
    const privacy = after.questions.find((q) => q.normalizedKey.startsWith("i_have_read"))!;
    await approveQuestionAnswer(user.id, privacy.id, "Yes");
    await runOnce(engine, workerId, app.id);
    const final = await loadApplication(app.id);
    expect(final.status).toBe("REVIEW_REQUIRED");
    expect(final.attentionReason).toBe("CONTRADICTION");
    expect(final.attentionDetail).toContain("sponsorship");
    expect(site.submissions).toHaveLength(0);
  });
});

describe("form patterns", () => {
  it("multi-page: fills each step and submits at the end", async () => {
    const user = await makeApplicant({ coverLetter: true });
    const app = await queueFor(user.id, `${site.url}/multi-page`);
    await runOnce(engine, workerId, app.id);
    const after = await loadApplication(app.id);
    expect(after.status, after.attentionDetail ?? after.lastError ?? "").toBe("SUBMITTED");
    expect(site.submissions[0]!.fields).toMatchObject({ first_name: "Jordan", years: "4", authorized: "Yes", sponsorship: "No" });
    expect(site.submissions[0]!.files.resume?.name).toBe("jordan-rivera-resume.pdf");
    expect(site.submissions[0]!.files.cover_letter?.name).toBe("jordan-cover-letter.pdf");
    expect(new Set(after.questions.map((q) => q.pageIndex))).toEqual(new Set([0, 1, 2]));
    expect(after.events.filter((e) => e.type === "PAGE_COMPLETED")).toHaveLength(2);
  });

  it("dropdowns: matches profile values to the site's own options", async () => {
    const user = await makeApplicant();
    const app = await queueFor(user.id, `${site.url}/dropdowns`);
    await runOnce(engine, workerId, app.id);
    const after = await loadApplication(app.id);
    expect(after.status, after.attentionDetail ?? "").toBe("SUBMITTED");
    expect(site.submissions[0]!.fields).toMatchObject({ country: "United States of America", state: "New York", experience: "3-5 years" });
  });

  it("checkboxes and radios: answers from the library, asks about the consent box, then submits", async () => {
    const user = await makeApplicant();
    const app = await queueFor(user.id, `${site.url}/checkboxes`);
    await runOnce(engine, workerId, app.id);
    let after = await loadApplication(app.id);
    expect(after.status).toBe("REVIEW_REQUIRED");
    expect(after.attentionReason).toBe("QUESTION_REVIEW");
    const review = after.questions.filter((q) => q.status === "NEEDS_REVIEW");
    expect(review.map((q) => q.label)).toEqual([expect.stringContaining("privacy notice")]);
    expect(review[0]!.reviewReason).toContain("won't guess");
    expect(site.submissions).toHaveLength(0);

    await approveQuestionAnswer(user.id, review[0]!.id, "Yes");
    expect((await loadApplication(app.id)).status).toBe("QUEUED");
    await runOnce(engine, workerId, app.id);
    after = await loadApplication(app.id);
    expect(after.status, after.attentionDetail ?? "").toBe("SUBMITTED");
    expect(site.submissions[0]!.fields).toMatchObject({ authorized: "Yes", sponsorship: "No", privacy: "yes" });
  });

  it("uploads: attaches the resume and cover letter, leaves an unknown optional upload empty", async () => {
    const user = await makeApplicant({ coverLetter: true });
    const app = await queueFor(user.id, `${site.url}/uploads`);
    await runOnce(engine, workerId, app.id);
    const after = await loadApplication(app.id);
    expect(after.status, after.attentionDetail ?? "").toBe("SUBMITTED");
    expect(Object.keys(site.submissions[0]!.files).sort()).toEqual(["cover_letter", "resume"]);
    expect(after.questions.find((q) => q.normalizedKey === "writing_sample")?.status).toBe("SKIPPED");
  });

  it("uploads: a required resume with none on file goes to the user", async () => {
    const user = await makeApplicant({ resume: false });
    const app = await queueFor(user.id, `${site.url}/uploads`);
    await runOnce(engine, workerId, app.id);
    const after = await loadApplication(app.id);
    expect(after.status).toBe("REVIEW_REQUIRED");
    expect(after.questions.find((q) => q.normalizedKey === "resume")?.reviewReason).toContain("requires a resume");
  });

  it("conditional questions: answers the follow-up that appears, asks about the one it can't know", async () => {
    const user = await makeApplicant({
      library: [
        { key: "sponsorship", question: "Will you now or in the future require visa sponsorship?", answer: "No", category: "SPONSORSHIP" },
        { key: "relocation", question: "Are you willing to relocate?", answer: "Yes", category: "RELOCATION" },
      ],
    });
    const app = await queueFor(user.id, `${site.url}/conditional`);
    await runOnce(engine, workerId, app.id);
    let after = await loadApplication(app.id);
    expect(after.status).toBe("REVIEW_REQUIRED");
    const pending = after.questions.filter((q) => q.status === "NEEDS_REVIEW");
    expect(pending.map((q) => q.normalizedKey)).toEqual(["preferred_city_to_relocate_to"]);
    expect(after.questions.some((q) => q.normalizedKey.includes("visa_type"))).toBe(false);
    expect(after.events.some((e) => e.message.includes("appeared after earlier answers"))).toBe(true);

    await approveQuestionAnswer(user.id, pending[0]!.id, "Austin, TX");
    await runOnce(engine, workerId, app.id);
    after = await loadApplication(app.id);
    expect(after.status, after.attentionDetail ?? "").toBe("SUBMITTED");
    expect(site.submissions[0]!.fields).toMatchObject({ sponsorship: "No", relocate: "Yes", relocate_where: "Austin, TX" });
  });

  it("validation errors: flags the rejected answer, then retries with the user's correction", async () => {
    const user = await makeApplicant({ profile: { phone: "+1 (212) 555-0100" } });
    const app = await queueFor(user.id, `${site.url}/validation`);
    await runOnce(engine, workerId, app.id);
    let after = await loadApplication(app.id);
    expect(after.status).toBe("REVIEW_REQUIRED");
    expect(after.attentionReason).toBe("VALIDATION_ERROR");
    const phone = after.questions.find((q) => q.normalizedKey === "phone_number")!;
    expect(phone.status).toBe("NEEDS_REVIEW");
    expect(phone.reviewReason).toContain("555-555-5555");
    expect(site.submissions).toHaveLength(0);

    await approveQuestionAnswer(user.id, phone.id, "212-555-0100");
    await runOnce(engine, workerId, app.id);
    after = await loadApplication(app.id);
    expect(after.status, after.attentionDetail ?? "").toBe("SUBMITTED");
    expect(site.submissions[0]!.fields.phone).toBe("212-555-0100");
  });

  it("unknown fields: never guesses a required answer, skips optional unknowns", async () => {
    const user = await makeApplicant();
    const app = await queueFor(user.id, `${site.url}/unknown-fields`);
    await runOnce(engine, workerId, app.id);
    const after = await loadApplication(app.id);
    expect(after.status).toBe("REVIEW_REQUIRED");
    const tool = after.questions.find((q) => q.label.startsWith("What is the last tool"))!;
    expect(tool.status).toBe("NEEDS_REVIEW");
    expect(tool.answer).toBeNull();
    expect(after.questions.find((q) => q.label === "T-shirt size")?.status).toBe("SKIPPED");
  });

  it("follows an Apply button from a job description page to the form", async () => {
    const user = await makeApplicant();
    const app = await queueFor(user.id, `${site.url}/job/listing`);
    await runOnce(engine, workerId, app.id);
    expect((await loadApplication(app.id)).status).toBe("SUBMITTED");
  });
});

describe("human checkpoints", () => {
  it("CAPTCHA: pauses for the user and never touches the widget", async () => {
    const user = await makeApplicant();
    const app = await queueFor(user.id, `${site.url}/captcha`);
    await runOnce(engine, workerId, app.id);
    const after = await loadApplication(app.id);
    expect(after.status).toBe("WAITING_FOR_USER");
    expect(after.attentionReason).toBe("CAPTCHA");
    expect(after.attentionDetail).toContain("never solves CAPTCHAs");
    expect(site.submissions).toHaveLength(0);
    expect(after.lockedBy).toBeNull();
  });

  it("CAPTCHA with a visible browser: resumes once the person completes it", async () => {
    const visible = makeEngine({ browsers: new VisibleBrowserPool({ headless: true, navigationTimeoutMs: 15_000 }), workerId: "visible-worker" });
    try {
      const user = await makeApplicant();
      const app = await queueFor(user.id, `${site.url}/captcha`);
      const run = runOnce(visible.engine, visible.workerId, app.id);
      await waitFor(async () => (await loadApplication(app.id)).status === "WAITING_FOR_USER");
      expect((await loadApplication(app.id)).lockedBy).toBe("visible-worker");
      site.solveCaptchas();
      await run;
      const after = await loadApplication(app.id);
      expect(after.status, after.attentionDetail ?? "").toBe("SUBMITTED");
      expect(after.events.some((e) => e.type === "HUMAN_INPUT_RECEIVED")).toBe(true);
    } finally {
      await visible.browsers.close();
    }
  });

  it("sign-in wall: waits for the person, then reuses the saved session next time", async () => {
    const visible = makeEngine({ browsers: new VisibleBrowserPool({ headless: true, navigationTimeoutMs: 15_000 }), workerId: "visible-worker" });
    try {
      const user = await makeApplicant();
      const app = await queueFor(user.id, `${site.url}/login`);
      const run = runOnce(visible.engine, visible.workerId, app.id);
      await waitFor(async () => (await loadApplication(app.id)).attentionReason === "AUTH_REQUIRED");
      expect((await loadApplication(app.id)).attentionDetail).toContain("never enters passwords");
      site.grantSignIns();
      await run;
      expect((await loadApplication(app.id)).status).toBe("SUBMITTED");
      const session = await prisma.browserSession.findFirstOrThrow({ where: { userId: user.id } });
      expect(session.domain).toBe("127.0.0.1");
      expect(session.storageStateEncrypted).toMatch(/^enc:v1:/);
    } finally {
      await visible.browsers.close();
    }
  });

  it("the user pressing \"I've completed it\" while the page still shows the check keeps it waiting", async () => {
    const visible = makeEngine({ config: { ...makeEngine().config, interactiveWaitMs: 6000 }, browsers: new VisibleBrowserPool({ headless: true, navigationTimeoutMs: 15_000 }), workerId: "visible-worker" });
    try {
      const user = await makeApplicant();
      const app = await queueFor(user.id, `${site.url}/captcha`);
      const run = runOnce(visible.engine, visible.workerId, app.id);
      await waitFor(async () => (await loadApplication(app.id)).status === "WAITING_FOR_USER");
      await markHumanStepComplete(user.id, app.id);
      await waitFor(async () => (await loadApplication(app.id)).attentionDetail?.includes("still shows") ?? false);
      expect(await run).toMatchObject({ result: "released" });
      const after = await loadApplication(app.id);
      expect(after.status).toBe("WAITING_FOR_USER");
      expect(after.lockedBy).toBeNull();
    } finally {
      await visible.browsers.close();
    }
  });
});

describe("safety and failures", () => {
  it("won't open sites outside the allowed hosts", async () => {
    const user = await makeApplicant();
    const app = await queueFor(user.id, "https://careers.example.com/apply/123");
    await runOnce(engine, workerId, app.id);
    const after = await loadApplication(app.id);
    expect(after.status).toBe("WAITING_FOR_USER");
    expect(after.attentionReason).toBe("UNSUPPORTED_SITE");
    expect(after.attentionDetail).toContain("turned off");
  });

  it("never automates LinkedIn Easy Apply", async () => {
    const user = await makeApplicant();
    const app = await queueFor(user.id, "https://www.linkedin.com/jobs/view/3987654321");
    await runOnce(engine, workerId, app.id);
    const after = await loadApplication(app.id);
    expect(after.attentionReason).toBe("UNSUPPORTED_SITE");
    expect(after.attentionDetail).toContain("apply on LinkedIn yourself: https://www.linkedin.com/jobs/view/3987654321");
  });

  it("follows a LinkedIn job to the company's own application and fills it there", async () => {
    const asked: string[] = [];
    const following = makeEngine({
      browsers,
      workerId: "follow-worker",
      follow: async (job) => {
        asked.push(`${job.company}|${job.title}|${job.url}`);
        return { url: `${site.url}/simple`, via: "company_board", foundOn: "Greenhouse" };
      },
    });
    const user = await makeApplicant();
    const app = await queueFor(user.id, "https://www.linkedin.com/jobs/view/3987654321", { mode: "AUTO" });
    await runOnce(following.engine, "follow-worker", app.id);
    const after = await loadApplication(app.id);
    expect(after.status, after.attentionDetail ?? after.lastError ?? "").toBe("SUBMITTED");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("https://www.linkedin.com/jobs/view/3987654321");
    const job = await prisma.job.findUniqueOrThrow({ where: { id: after.jobId } });
    expect(job.applicationUrl).toBe(`${site.url}/simple`);
    const events = await prisma.applicationEvent.findMany({ where: { applicationId: app.id, type: "NOTE" } });
    expect(events.map((e) => e.message).join(" ")).toContain("Followed the LinkedIn job to");
  });

  it("leaves Handshake-only jobs for the user to apply to on Handshake", async () => {
    const user = await makeApplicant();
    const app = await queueFor(user.id, "https://app.joinhandshake.com/stu/jobs/9876543");
    await runOnce(engine, workerId, app.id);
    const after = await loadApplication(app.id);
    expect(after.status).toBe("WAITING_FOR_USER");
    expect(after.attentionDetail).toContain("apply on Handshake yourself: https://app.joinhandshake.com/stu/jobs/9876543");
  });

  it("retries network failures with backoff, then hands repeated failures to the user", async () => {
    const user = await makeApplicant();
    const app = await queueFor(user.id, "http://127.0.0.1:9/apply");
    for (let attempt = 1; attempt <= 3; attempt++) {
      const outcome = await runOnce(engine, workerId, app.id);
      expect(outcome.retryInMs).toBeGreaterThan(0);
      const after = await loadApplication(app.id);
      expect(after.status).toBe("QUEUED");
      expect(after.failureType).toBe("NETWORK_ERROR");
      expect(after.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
      // Not due yet: a claim is refused until the backoff passes.
      expect(await claimApplication(app.id, workerId, 30_000)).toEqual({ claimed: false, reason: "not_due" });
      await prisma.application.update({ where: { id: app.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    }
    await runOnce(engine, workerId, app.id);
    const after = await loadApplication(app.id);
    expect(after.status).toBe("REVIEW_REQUIRED");
    expect(after.attentionReason).toBe("REPEATED_FAILURE");
    expect(after.attempts).toHaveLength(4);
  });

  it("stops immediately when the user presses Stop", async () => {
    const user = await makeApplicant();
    const app = await queueFor(user.id, `${site.url}/multi-page`);
    const controller = new AbortController();
    const run = runOnce(engine, workerId, app.id, controller.signal);
    await waitFor(async () => (await prisma.applicationEvent.count({ where: { applicationId: app.id, type: "BROWSER_LAUNCHED" } })) > 0);
    await setQueueState(user.id, "stop");
    controller.abort("stop");
    expect(await run).toMatchObject({ result: "cancelled" });
    const after = await loadApplication(app.id);
    expect(after.status).toBe("QUEUED");
    expect(after.lockedBy).toBeNull();
    expect(after.attempts[0]!.status).toBe("CANCELLED");
    expect(site.submissions).toHaveLength(0);
  });
});

async function waitFor(check: () => Promise<boolean>, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Timed out waiting for condition");
}
