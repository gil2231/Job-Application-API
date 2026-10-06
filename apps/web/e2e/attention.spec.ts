import { expect, test } from "@playwright/test";
import { prisma } from "@autoapply/database";
import { addJob, signUp } from "./helpers";

test.afterAll(() => prisma.$disconnect());

/**
 * The worker isn't part of Phase 1, so these tests put applications into the
 * states the worker produces, then drive the human-in-the-loop UI.
 */
test("approves, edits and skips flagged answers, then resumes the application", async ({ page }) => {
  const { email } = await signUp(page);
  await addJob(page, { url: "https://example.com/jobs/bdr", title: "BDR", company: "Example Corp" });
  await page.getByRole("button", { name: "Actions for BDR" }).click();
  await page.getByRole("menuitem", { name: "Apply" }).click();
  await expect(page.getByText(/Queued 1 application/)).toBeVisible();

  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const app = await prisma.application.findFirstOrThrow({ where: { userId: user.id } });
  await prisma.application.update({ where: { id: app.id }, data: { status: "REVIEW_REQUIRED", attentionReason: "QUESTION_REVIEW" } });
  await prisma.applicationQuestion.create({
    data: { applicationId: app.id, label: "What are your salary expectations?", normalizedKey: "salary", required: true, status: "NEEDS_REVIEW", answer: { create: { value: "$70,000–$80,000", source: "AI_GENERATED", confidence: 60 } } },
  });
  await prisma.applicationQuestion.create({
    data: { applicationId: app.id, label: "Why do you want to work here?", normalizedKey: "why", required: true, status: "NEEDS_REVIEW", answer: { create: { value: "Draft answer", source: "AI_GENERATED", confidence: 40 } } },
  });
  await prisma.applicationQuestion.create({
    data: { applicationId: app.id, label: "How did you hear about us?", normalizedKey: "referral", required: false, status: "NEEDS_REVIEW" },
  });

  await page.goto("/needs-attention");
  await expect(page.getByText("Review required")).toBeVisible();
  await expect(page.getByText("Example Corp")).toBeVisible();
  await expect(page.getByRole("link", { name: "Needs Attention" })).toContainText("1");

  const salary = page.locator("div.rounded-lg", { hasText: "What are your salary expectations?" });
  await salary.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Answer approved")).toBeVisible();

  const why = page.locator("div.rounded-lg", { hasText: "Why do you want to work here?" });
  await why.getByRole("button", { name: "Edit" }).click();
  await why.getByRole("textbox").fill("I've followed Example Corp's growth in fintech for years.");
  await why.getByRole("button", { name: "Save & approve" }).click();
  await expect(page.getByText("Answer approved").first()).toBeVisible();

  const referral = page.locator("div.rounded-lg", { hasText: "How did you hear about us?" });
  await referral.getByRole("button", { name: "Skip" }).click();

  await expect(page.getByText("Nothing needs you right now")).toBeVisible();
  const after = await prisma.application.findUniqueOrThrow({ where: { id: app.id }, include: { questions: { include: { answer: true } } } });
  expect(after.status).toBe("QUEUED");
  expect(after.questions.find((q) => q.normalizedKey === "why")?.answer?.value).toContain("Example Corp's growth");
});

test("CAPTCHA and sign-in checkpoints resume after the user completes them", async ({ page }) => {
  const { email } = await signUp(page);
  await addJob(page, { url: "https://example.com/jobs/a", title: "Role A", company: "Captcha Co" });
  await expect(page.getByText("Added Role A")).toBeVisible();
  await addJob(page, { url: "https://example.com/jobs/b", title: "Role B", company: "MFA Co" });
  await expect(page.getByText("Added Role B")).toBeVisible();
  await page.getByRole("checkbox", { name: "Select all" }).check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByText(/Queued 2 applications/)).toBeVisible();

  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const apps = await prisma.application.findMany({ where: { userId: user.id }, include: { job: true } });
  for (const a of apps) {
    await prisma.application.update({
      where: { id: a.id },
      data: a.job.company === "Captcha Co" ? { status: "WAITING_FOR_USER", attentionReason: "CAPTCHA" } : { status: "WAITING_FOR_USER", attentionReason: "MFA" },
    });
  }

  await page.goto("/needs-attention");
  const captcha = page.locator('[data-slot="card"]', { hasText: "CAPTCHA detected" });
  await expect(captcha.getByRole("link", { name: "Open application" })).toHaveAttribute("href", "https://example.com/jobs/a");
  await captcha.getByRole("button", { name: "I've completed it" }).click();
  await expect(page.getByText(/back in the queue/)).toBeVisible();

  const mfa = page.locator('[data-slot="card"]', { hasText: "Authentication required" });
  await expect(mfa.getByRole("link", { name: "Open browser" })).toBeVisible();
  await mfa.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Nothing needs you right now")).toBeVisible();

  const statuses = await prisma.application.findMany({ where: { userId: user.id }, select: { status: true } });
  expect(statuses.every((s) => s.status === "QUEUED")).toBe(true);
});
