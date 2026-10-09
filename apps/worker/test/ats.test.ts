import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approveForSubmission, markHumanStepComplete, prisma } from "@autoapply/database";
import { ATS_ENTRY_POINTS } from "../mock-site/ats";
import { startMockSite, type MockSite } from "../mock-site/server";
import { loadApplication, makeApplicant, makeEngine, queueFor, resetDatabase, runOnce, VisibleBrowserPool, type ApplicantOptions } from "./helpers";
import { decryptString, isEncrypted } from "@autoapply/database/crypto";

/**
 * Each ATS adapter against a local imitation of that ATS (never a real
 * employer site): platform detection, the platform's own widgets and page
 * flow, and the safety stops.
 */

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

const STANDARD_LIBRARY: NonNullable<ApplicantOptions["library"]> = [
  { key: "work_authorization", question: "Are you legally authorized to work in this country?", answer: "Yes", category: "WORK_AUTHORIZATION" },
  { key: "sponsorship", question: "Will you now or in the future require visa sponsorship?", answer: "No", category: "SPONSORSHIP" },
];

async function apply(entry: string, options: ApplicantOptions & { mode?: "AUTO" | "REVIEW" | "MANUAL" } = {}) {
  const user = await makeApplicant({ library: STANDARD_LIBRARY, ...options });
  const app = await queueFor(user.id, `${site.url}${entry}`, { mode: options.mode ?? "AUTO" });
  await runOnce(engine, workerId, app.id);
  return { user, app, after: await loadApplication(app.id) };
}

const why = (a: Awaited<ReturnType<typeof loadApplication>>) => `${a.status}: ${a.attentionDetail ?? a.lastError ?? ""} ${JSON.stringify(a.questions.filter((q) => q.status === "NEEDS_REVIEW").map((q) => [q.label, q.reviewReason]))}`;

describe("Greenhouse", () => {
  it("detects the board, fills typeahead dropdowns and the city search, attaches the resume and submits", async () => {
    const { after } = await apply(ATS_ENTRY_POINTS.greenhouse);
    expect(after.status, why(after)).toBe("SUBMITTED");
    expect(after.platform).toBe("GREENHOUSE");
    expect(after.events.find((e) => e.type === "PLATFORM_DETECTED")?.message).toContain("Greenhouse");
    expect(site.submissions).toHaveLength(1);
    const { fields, files, form } = site.submissions[0]!;
    expect(form).toBe("greenhouse");
    expect(fields).toMatchObject({
      "job_application[first_name]": "Jordan",
      "job_application[last_name]": "Rivera",
      "job_application[email]": "jordan@example.com",
      "job_application[phone]": "212-555-0100",
      "job_application[location]": "New York, New York, United States",
      "job_application[answers_attributes][0][text_value]": "https://www.linkedin.com/in/jordan-rivera",
      "job_application[answers_attributes][1][boolean_value]": "Yes",
      "job_application[answers_attributes][2][boolean_value]": "No",
      // Voluntary self-identification is left blank when the Answer Library has nothing for it.
      "job_application[gender]": "",
    });
    expect(files.resume?.name).toBe("jordan-rivera-resume.pdf");
    expect(files.cover_letter).toBeUndefined();
    expect(after.confirmationNumber).toMatch(/^MOCK-/);
  });
});

describe("Greenhouse with a saved answer that isn't one of the dropdown's choices", () => {
  it("leaves that question for the person and fills the rest, instead of failing the attempt", async () => {
    const library = [...STANDARD_LIBRARY, { key: "demographic_gender", question: "Gender (voluntary self-identification)", answer: "Non-binary", category: "DEMOGRAPHIC" as const }];
    const { after } = await apply(ATS_ENTRY_POINTS.greenhouse, { library });
    expect(after.status, why(after)).toBe("REVIEW_REQUIRED");
    expect(after.attentionDetail).toContain('"Gender"');
    expect(after.lastError ?? "").not.toContain("Couldn't choose");
    expect(site.submissions).toHaveLength(0);
    expect(after.questions.find((q) => q.label === "Gender")).toMatchObject({ status: "NEEDS_REVIEW", reviewReason: expect.stringContaining("doesn't match") });
    expect(after.questions.find((q) => q.label === "First Name")).toMatchObject({ status: "ANSWERED" });
  });
});

describe("Greenhouse inside an employer's careers page", () => {
  it("opens the form from the iframe, remembers its link on the job, and submits", async () => {
    const { app, after } = await apply(ATS_ENTRY_POINTS.greenhouseCareersPage);
    expect(after.status, why(after)).toBe("SUBMITTED");
    expect(after.platform).toBe("GREENHOUSE");
    expect(after.events.find((e) => e.type === "NOTE" && e.message.includes("embedded in"))?.message).toContain(`${ATS_ENTRY_POINTS.greenhouse}?embed=true`);
    expect(site.submissions).toHaveLength(1);
    expect(site.submissions[0]!.fields["job_application[email]"]).toBe("jordan@example.com");
    const job = await prisma.job.findUniqueOrThrow({ where: { id: app.jobId } });
    expect(job.applicationUrl).toBe(`${site.url}${ATS_ENTRY_POINTS.greenhouse}?embed=true`);
  });
});

describe("Greenhouse with Google's invisible reCAPTCHA badge", () => {
  it("fills the form and attaches files labelled only \"Attach\", but leaves the final Submit to the person even in Auto mode", async () => {
    const { user, app, after } = await apply(ATS_ENTRY_POINTS.greenhouseBadge, { coverLetter: true });
    expect(after.status, why(after)).toBe("READY");
    expect(after.attentionReason).toBe("FINAL_REVIEW");
    expect(after.attentionDetail).toContain("click Submit yourself");
    expect(after.platform).toBe("GREENHOUSE");
    expect(after.events.some((e) => e.type === "RESUME_UPLOADED")).toBe(true);
    expect(after.events.some((e) => e.type === "COVER_LETTER_UPLOADED")).toBe(true);
    expect(after.events.some((e) => e.type === "NOTE" && e.message.includes("final Submit is left to you"))).toBe(true);
    expect(site.submissions).toHaveLength(0);

    // Approving it doesn't change that: it is filled again and handed back.
    await approveForSubmission(user.id, app.id);
    await runOnce(engine, workerId, app.id);
    const again = await loadApplication(app.id);
    expect(again.status, why(again)).toBe("READY");
    expect(again.attentionReason).toBe("FINAL_REVIEW");
    expect(site.submissions).toHaveLength(0);
  });

  it("Review mode still stops for review first", async () => {
    const { after } = await apply(ATS_ENTRY_POINTS.greenhouseBadge, { mode: "REVIEW" });
    expect(after.status, why(after)).toBe("REVIEW_REQUIRED");
    expect(after.attentionReason).toBe("FINAL_REVIEW");
    expect(site.submissions).toHaveLength(0);
  });
});

describe("Lever", () => {
  it("opens the form from the posting, restores fields the resume parser overwrote, and submits", async () => {
    const { after } = await apply(ATS_ENTRY_POINTS.lever);
    expect(after.status, why(after)).toBe("SUBMITTED");
    expect(after.platform).toBe("LEVER");
    const { fields, files } = site.submissions[0]!;
    expect(fields).toMatchObject({ name: "Jordan Rivera", email: "jordan@example.com", phone: "212-555-0100", "urls[LinkedIn]": "https://www.linkedin.com/in/jordan-rivera" });
    // The parser's guess for a field the profile doesn't cover is not sent.
    expect(fields.org).toBe("");
    expect(Object.entries(fields).filter(([k]) => k.endsWith("[field0]") || k.endsWith("[field1]")).map(([, v]) => v)).toEqual(["Yes", "No"]);
    expect(files.resume?.name).toBe("jordan-rivera-resume.pdf");
    const notes = after.events.filter((e) => e.type === "NOTE").map((e) => e.message);
    expect(notes.some((n) => n.includes("restored them from your Master Profile"))).toBe(true);
    expect(notes.some((n) => n.includes("cleared"))).toBe(true);
    expect(site.forbidden).toEqual([]);
  });

  it("stops for the person when an hCaptcha appears on submit", async () => {
    const { after } = await apply(ATS_ENTRY_POINTS.leverGuarded);
    expect(after.status, why(after)).toBe("WAITING_FOR_USER");
    expect(after.attentionReason).toBe("CAPTCHA");
    expect(after.attentionDetail).toContain("hCaptcha");
    expect(site.submissions).toHaveLength(0);
  });
});

describe("Ashby", () => {
  it("switches to the Application tab, presses Yes/No answer buttons, skips the resume autofill, and submits in place", async () => {
    const { after } = await apply(ATS_ENTRY_POINTS.ashby);
    expect(after.status, why(after)).toBe("SUBMITTED");
    expect(after.platform).toBe("ASHBY");
    const { fields, files } = site.submissions[0]!;
    expect(fields).toMatchObject({ _systemfield_name: "Jordan Rivera", _systemfield_email: "jordan@example.com", _systemfield_location_value: "New York, New York, US" });
    expect(Object.values(fields)).toEqual(expect.arrayContaining(["212-555-0100", "https://www.linkedin.com/in/jordan-rivera"]));
    // Authorization and sponsorship answers are encrypted at rest.
    const answers = after.questions.filter((q) => q.fieldType === "RADIO").map((q) => [q.label, q.answer && isEncrypted(q.answer.value) ? decryptString(q.answer.value) : q.answer?.value]);
    expect(answers).toEqual([
      [expect.stringContaining("legally authorized"), "Yes"],
      [expect.stringContaining("sponsorship"), "No"],
    ]);
    expect(files._systemfield_resume?.name).toBe("jordan-rivera-resume.pdf");
    expect(after.questions.some((q) => /autofill/i.test(q.label))).toBe(false);
  });
});

describe("Workday", () => {
  const library: NonNullable<ApplicantOptions["library"]> = [
    ...STANDARD_LIBRARY,
    { key: "how_did_you_hear_about_us", question: "How did you hear about us?", answer: "LinkedIn", category: "OTHER" },
    { key: "have_you_previously_worked_for_example_corp", question: "Have you previously worked for Example Corp?", answer: "No", category: "EXPERIENCE" },
    { key: "phone_device_type", question: "Phone device type", answer: "Mobile", category: "OTHER" },
    { key: "i_have_read_and_consent_to_the_terms_and_conditions", question: "I have read and consent to the terms and conditions", answer: "Yes", category: "OTHER" },
  ];

  it("waits for the person to sign in, then fills every step and submits from the Review page", async () => {
    const { user, app, after } = await apply(ATS_ENTRY_POINTS.workday, { library });
    expect(after.status, why(after)).toBe("WAITING_FOR_USER");
    expect(after.attentionReason).toBe("AUTH_REQUIRED");
    expect(after.attentionDetail).toContain("candidate account");
    expect(after.platform).toBe("WORKDAY");
    expect(site.forbidden).toEqual([]);

    // The person signs in (or creates the account) themselves.
    site.grantSignIns();
    await markHumanStepComplete(user.id, app.id);
    await runOnce(engine, workerId, app.id);
    const done = await loadApplication(app.id);
    expect(done.status, why(done)).toBe("SUBMITTED");
    expect(site.submissions).toHaveLength(1);
    expect(site.submissions[0]!.fields).toMatchObject({
      source: "LinkedIn",
      previousWorker: "No",
      country: "United States of America",
      firstName: "Jordan",
      lastName: "Rivera",
      city: "New York",
      state: "New York",
      email: "jordan@example.com",
      phoneType: "Mobile",
      phone: "212-555-0100",
      linkedin: "https://www.linkedin.com/in/jordan-rivera",
      authorized: "Yes",
      sponsorship: "No",
      gender: "",
      terms: "yes",
    });
    expect(site.submissions[0]!.files.resume?.name).toBe("jordan-rivera-resume.pdf");
    expect(new Set(done.questions.map((q) => q.pageIndex))).toEqual(new Set([0, 1, 2, 3]));
    expect(done.events.filter((e) => e.type === "PAGE_COMPLETED")).toHaveLength(4);
    expect(site.forbidden).toEqual([]);
  });

  it("Review mode stops on Workday's Review page without submitting", async () => {
    site.grantSignIns();
    const { after } = await apply(ATS_ENTRY_POINTS.workday, { library, mode: "REVIEW" });
    expect(after.status, why(after)).toBe("REVIEW_REQUIRED");
    expect(after.attentionReason).toBe("FINAL_REVIEW");
    expect(site.submissions).toHaveLength(0);
  });

  it("waits for a job page that renders its Apply button late", async () => {
    site.grantSignIns();
    const { after } = await apply(ATS_ENTRY_POINTS.workdaySlow, { library, mode: "REVIEW" });
    expect(after.status, why(after)).toBe("REVIEW_REQUIRED");
    expect(after.attentionReason).toBe("FINAL_REVIEW");
    expect(after.platform).toBe("WORKDAY");
    expect(site.submissions).toHaveLength(0);
  });

  it("after the person signs in, waits through the blank page before the form instead of giving up", async () => {
    const visible = makeEngine({ browsers: new VisibleBrowserPool({ headless: true, navigationTimeoutMs: 15_000 }), workerId: "visible-worker" });
    try {
      const user = await makeApplicant({ library });
      const app = await queueFor(user.id, `${site.url}${ATS_ENTRY_POINTS.workday}`, { mode: "REVIEW" });
      const run = runOnce(visible.engine, visible.workerId, app.id);
      await waitFor(async () => (await loadApplication(app.id)).attentionReason === "AUTH_REQUIRED");
      site.grantSignIns();
      await run;
      const after = await loadApplication(app.id);
      expect(after.status, why(after)).toBe("REVIEW_REQUIRED");
      expect(after.attentionReason).toBe("FINAL_REVIEW");
      expect(after.events.some((e) => e.message.includes("Sign-in completed"))).toBe(true);
      expect(site.submissions).toHaveLength(0);
    } finally {
      await visible.browsers.close();
    }
  });

  it("asks the person about Workday questions it has no answer for", async () => {
    site.grantSignIns();
    const { after } = await apply(ATS_ENTRY_POINTS.workday);
    expect(after.status).toBe("REVIEW_REQUIRED");
    expect(after.attentionReason).toBe("QUESTION_REVIEW");
    expect(after.questions.filter((q) => q.status === "NEEDS_REVIEW").map((q) => q.label)).toEqual(
      expect.arrayContaining([expect.stringContaining("How Did You Hear"), expect.stringContaining("previously worked"), expect.stringContaining("Phone Device Type")]),
    );
    const source = after.questions.find((q) => q.label.startsWith("How Did You Hear"))!;
    expect(source.options).toEqual(["Job Board", "LinkedIn", "Company Website", "Referral"]);
    expect(site.submissions).toHaveLength(0);
  });
});

describe("SmartRecruiters", () => {
  it("fills web-component fields inside shadow DOM, confirms the email, never uses Apply with LinkedIn, and submits", async () => {
    const { after } = await apply(ATS_ENTRY_POINTS.smartrecruiters);
    expect(after.status, why(after)).toBe("SUBMITTED");
    expect(after.platform).toBe("SMARTRECRUITERS");
    expect(site.forbidden).toEqual([]);
    const { fields, files } = site.submissions[0]!;
    expect(fields).toMatchObject({ firstName: "Jordan", lastName: "Rivera", email: "jordan@example.com", confirmEmail: "jordan@example.com", phoneNumber: "212-555-0100", q_authorized: "Yes", q_sponsorship: "No", message: "" });
    expect(files.resume?.name).toBe("jordan-rivera-resume.pdf");
    expect(after.confirmationNumber).toMatch(/^MOCK-/);
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
