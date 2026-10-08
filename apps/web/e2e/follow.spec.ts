import { expect, test } from "@playwright/test";
import { prisma } from "@autoapply/database";
import { signUp } from "./helpers";

test.afterAll(() => prisma.$disconnect());

const saveJob = async (email: string, url: string, title: string, company: string) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return prisma.job.create({ data: { userId: user.id, sourceType: "MANUAL", url, canonicalUrl: url, title, company, location: "New York, NY", platform: "LINKEDIN_EASY_APPLY" } });
};

// The company's job board is a stand-in (see src/lib/fake-job-sources.ts); LinkedIn and Handshake are never fetched.
test("follows a LinkedIn job to the company's own application", async ({ page }) => {
  const { email } = await signUp(page);
  const job = await saveJob(email, "https://www.linkedin.com/jobs/view/3987654321", "Account Executive, FinTech", "Acme");
  await page.goto(`/jobs/${job.id}`);
  const card = page.getByTestId("where-to-apply");
  await expect(card).toContainText("Saved from LinkedIn. Applyance applies on Acme's own site, never on LinkedIn.");
  await expect(card.getByRole("link", { name: "Apply on LinkedIn yourself" })).toHaveAttribute("href", "https://www.linkedin.com/jobs/view/3987654321");
  await card.getByRole("button", { name: "Find the company's application" }).click();
  await expect(page.getByText("Found Acme's own application on Greenhouse. Applyance will apply there.")).toBeVisible();
  await expect(card).toBeHidden();
  const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
  expect(after).toMatchObject({ applicationUrl: "https://boards.greenhouse.io/acme/jobs/11", platform: "GREENHOUSE" });
});

test("says to apply on Handshake yourself when the company's application can't be found", async ({ page }) => {
  const { email } = await signUp(page);
  const job = await saveJob(email, "https://app.joinhandshake.com/stu/jobs/9876543", "Campus Ambassador", "Tiny Startup");
  await page.goto(`/jobs/${job.id}`);
  const card = page.getByTestId("where-to-apply");
  await card.getByRole("button", { name: "Find the company's application" }).click();
  await expect(card.getByRole("alert")).toContainText("apply on Handshake yourself: https://app.joinhandshake.com/stu/jobs/9876543");
});
