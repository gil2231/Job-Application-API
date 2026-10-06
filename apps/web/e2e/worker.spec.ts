import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createAnswer, createDocument, getUserSettings, prisma, updatePersonal, updateProfessional } from "@autoapply/database";
import { buildStorageKey, getStorage, sha256Hex } from "@autoapply/documents";
import { signUp } from "./helpers";

/**
 * The full loop with the real worker: the worker runs against the local mock
 * application pages only (never a real employer), and the user drives it from
 * the web app. Runs after the other e2e projects (see playwright.config.ts).
 */
const MOCK_PORT = Number(process.env.E2E_MOCK_SITE_PORT ?? 4110);
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const workerDir = resolve(import.meta.dirname, "../../worker");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

const children: ChildProcess[] = [];

function start(args: string[], ready: RegExp, env: Record<string, string>): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn("pnpm", args, { cwd: workerDir, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    let output = "";
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (ready.test(output)) done();
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.on("exit", (code) => fail(new Error(`${args.join(" ")} exited with ${code}:\n${output}`)));
    setTimeout(() => fail(new Error(`${args.join(" ")} did not start:\n${output}`)), 60_000);
  });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await start(["run", "mock-site"], /Mock application pages/, { MOCK_SITE_PORT: String(MOCK_PORT) });
  await start(["run", "start"], /\[worker\] .* running/, { WORKER_HEADLESS: "true", WORKER_SCHEDULER_INTERVAL_MS: "1000", AUTOMATION_ALLOWED_HOSTS: "127.0.0.1", AUTOMATION_ALLOW_ALL_HOSTS: "false" });
});

test.afterAll(async () => {
  for (const child of children) {
    if (child.pid && child.exitCode == null) {
      child.removeAllListeners("exit");
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
  await prisma.$disconnect();
});

/** A profile with the facts the mock forms ask for, a resume, and the answers the user saved. */
async function seedApplicant(email: string, mode: "REVIEW" | "AUTO") {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  await updatePersonal(user.id, { firstName: "Jordan", lastName: "Rivera", email: "jordan@example.com", phone: "212-555-0100", city: "New York", state: "NY", country: "United States", linkedinUrl: "https://www.linkedin.com/in/jordan-rivera" } as Parameters<typeof updatePersonal>[1]);
  await updateProfessional(user.id, { currentTitle: "Sales Development Representative", targetTitles: ["BDR"], summary: "SDR with 4 years in SaaS.", industries: ["Software"], yearsExperience: 4, skills: ["Salesforce"], software: [], technicalSkills: [], languages: [] } as unknown as Parameters<typeof updateProfessional>[1]);
  await getUserSettings(user.id);
  await prisma.automationRule.upsert({
    where: { userId: user.id },
    update: { autoSubmitEnabled: true, defaultMode: mode, maxApplicationsPerDay: 100 },
    create: { userId: user.id, autoSubmitEnabled: true, defaultMode: mode, maxApplicationsPerDay: 100, matchWeights: {} },
  });
  await createAnswer(user.id, { questionKey: "work_authorization", question: "Are you legally authorized to work in this country?", answer: "Yes", category: "WORK_AUTHORIZATION", confidence: 100, autoSubmitAllowed: true, requiresHumanReview: false });
  await createAnswer(user.id, { questionKey: "sponsorship", question: "Will you now or in the future require visa sponsorship?", answer: "No", category: "SPONSORSHIP", confidence: 100, autoSubmitAllowed: true, requiresHumanReview: false });
  const key = buildStorageKey(user.id, "RESUME", "pdf");
  await getStorage().put(key, PDF, "application/pdf");
  await createDocument(user.id, { type: "RESUME", name: "Main resume", isDefault: true }, { fileName: "jordan-rivera-resume.pdf", mimeType: "application/pdf", sizeBytes: PDF.length, storageKey: key, sha256: sha256Hex(PDF) });
  return user;
}

async function addMockJob(page: Page, path: string, title: string) {
  await page.goto("/jobs");
  await page.getByRole("button", { name: "Add job" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Job URL").fill(`${MOCK}${path}${path.includes("?") ? "&" : "?"}e2e=${Date.now()}`);
  await dialog.getByLabel("Job title").fill(title);
  await dialog.getByLabel("Company").fill("Example Corp");
  await dialog.getByRole("button", { name: "Add job" }).click();
  await expect(page.getByText(`Added ${title}`)).toBeVisible();
}

async function submissions(): Promise<Array<Record<string, unknown>>> {
  return (await (await fetch(`${MOCK}/__submissions`)).json()) as Array<Record<string, unknown>>;
}

test("Review mode: the worker fills the form, the user approves, and it is submitted", async ({ page }) => {
  test.setTimeout(120_000);
  const { email } = await signUp(page);
  const user = await seedApplicant(email, "REVIEW");
  await addMockJob(page, "/simple", "Mock BDR");
  await page.getByRole("checkbox", { name: "Select all" }).check();
  await page.getByRole("button", { name: "Choose how to apply" }).click();
  await page.getByRole("menuitem", { name: /Review mode/ }).click();
  await expect(page.getByText(/Queued 1 application in review mode/)).toBeVisible();

  await page.goto("/needs-attention");
  const card = page.locator('[data-slot="card"]', { hasText: "Ready for your review" });
  await expect(async () => {
    await page.reload();
    await expect(card).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await expect(card.getByText("Jordan").first()).toBeVisible();
  await expect(card.getByRole("img", { name: "Ready for review" })).toBeVisible();
  expect(await submissions()).toHaveLength(0);

  await card.getByRole("button", { name: "Approve & submit" }).click();
  await expect(page.getByText("Approved. AutoApply will submit it next.")).toBeVisible();

  const app = await prisma.application.findFirstOrThrow({ where: { userId: user.id } });
  await expect.poll(async () => (await prisma.application.findUniqueOrThrow({ where: { id: app.id } })).status, { timeout: 60_000 }).toBe("SUBMITTED");
  const sent = (await submissions()).filter((s) => JSON.stringify(s).includes("jordan@example.com"));
  expect(sent.length).toBeGreaterThan(0);

  await page.goto(`/applications/${app.id}`);
  await expect(page.getByText("Submitted").first()).toBeVisible();
  await expect(page.getByRole("img", { name: "Confirmation" })).toBeVisible();
});

test("Auto mode: an unknown required question goes to the user, and the saved answer is remembered", async ({ page }) => {
  test.setTimeout(120_000);
  const { email } = await signUp(page);
  const user = await seedApplicant(email, "AUTO");
  await addMockJob(page, "/unknown-fields", "Mock Analyst");
  await page.getByRole("checkbox", { name: "Select all" }).check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByText(/Queued 1 application in auto mode/)).toBeVisible();

  await page.goto("/needs-attention");
  const card = page.locator('[data-slot="card"]', { hasText: "Review required" });
  await expect(async () => {
    await page.reload();
    await expect(card).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await expect(card.getByText(/Nothing has been sent yet/)).toBeVisible();

  const question = card.locator("div.rounded-lg", { hasText: "What is the last tool you built" });
  await question.getByRole("button", { name: "Answer" }).click();
  await question.getByRole("textbox").fill("A spreadsheet that tracks my outreach follow-ups.");
  await question.getByRole("checkbox", { name: /Remember this answer/ }).check();
  await question.getByRole("button", { name: "Save & approve" }).click();
  await expect(page.getByText("Answer approved and saved to your Answer Library")).toBeVisible();

  const app = await prisma.application.findFirstOrThrow({ where: { userId: user.id } });
  await expect.poll(async () => (await prisma.application.findUniqueOrThrow({ where: { id: app.id } })).status, { timeout: 60_000 }).toBe("SUBMITTED");
  const sent = (await submissions()).filter((s) => JSON.stringify(s).includes("tracks my outreach"));
  expect(sent.length).toBeGreaterThan(0);

  await page.goto("/answers");
  await expect(page.getByText("A spreadsheet that tracks my outreach follow-ups.")).toBeVisible();
});

test("Workday: the platform is detected, the sign-in goes to the user, and the application finishes after they sign in", async ({ page }) => {
  test.setTimeout(150_000);
  const { email } = await signUp(page);
  const user = await seedApplicant(email, "AUTO");
  for (const [questionKey, question, answer] of [
    ["how_did_you_hear_about_us", "How did you hear about us?", "LinkedIn"],
    ["have_you_previously_worked_for_example_corp", "Have you previously worked for Example Corp?", "No"],
    ["phone_device_type", "Phone device type", "Mobile"],
    ["i_have_read_and_consent_to_the_terms_and_conditions", "I have read and consent to the terms and conditions", "Yes"],
  ] as const) {
    await createAnswer(user.id, { questionKey, question, answer, category: "OTHER", confidence: 100, autoSubmitAllowed: true, requiresHumanReview: false });
  }

  await page.goto("/integrations");
  await expect(page.getByTestId("platforms").locator("li", { hasText: "Workday" }).getByText("Automated")).toBeVisible();
  await expect(page.getByTestId("platforms").locator("li", { hasText: "LinkedIn Easy Apply" }).getByText("Not automated")).toBeVisible();

  await addMockJob(page, "/workday/examplecorp/job/New-York-NY/Business-Development-Representative_R12345", "Mock Workday BDR");
  await page.getByRole("checkbox", { name: "Select all" }).check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByText(/Queued 1 application in auto mode/)).toBeVisible();

  await page.goto("/needs-attention");
  const card = page.locator('[data-slot="card"]', { hasText: "Authentication required" });
  await expect(async () => {
    await page.reload();
    await expect(card).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await expect(card.getByText(/candidate account/)).toBeVisible();

  // The person signs in to Workday themselves, then tells Applyance to carry on.
  await fetch(`${MOCK}/__login/grant`);
  await card.getByRole("button", { name: "Continue" }).click();

  const app = await prisma.application.findFirstOrThrow({ where: { userId: user.id } });
  await expect.poll(async () => (await prisma.application.findUniqueOrThrow({ where: { id: app.id } })).status, { timeout: 90_000 }).toBe("SUBMITTED");
  expect((await prisma.application.findUniqueOrThrow({ where: { id: app.id } })).platform).toBe("WORKDAY");
  const sent = (await submissions()).filter((s) => s.form === "workday" && JSON.stringify(s).includes("jordan@example.com"));
  expect(sent).toHaveLength(1);

  await page.goto(`/applications/${app.id}`);
  await expect(page.getByText(/Workday detected/).first()).toBeVisible();
});
