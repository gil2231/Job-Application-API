import { expect, test, type Locator, type Page } from "@playwright/test";
import { prisma } from "@autoapply/database";
import { addJob, signUp } from "./helpers";

test.afterAll(() => prisma.$disconnect());

/**
 * Flightpath, the application tracker. The worker isn't involved: applications
 * are put into the states the worker produces, then moved through the stages
 * after Submitted by hand, the way a person tracks their replies.
 */
async function seed(page: Page) {
  const { email } = await signUp(page);
  const jobs = [
    { url: "https://example.com/jobs/linear", title: "Account Executive", company: "Linear" },
    { url: "https://example.com/jobs/ramp", title: "Sales Development Rep", company: "Ramp" },
    { url: "https://example.com/jobs/stripe", title: "Partnerships Manager", company: "Stripe" },
  ];
  for (const job of jobs) {
    await addJob(page, job);
    await expect(page.getByText(`Added ${job.title}`)).toBeVisible();
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const byCompany = Object.fromEntries((await prisma.job.findMany({ where: { userId: user.id } })).map((j) => [j.company, j.id]));
  const linear = await prisma.application.create({ data: { userId: user.id, jobId: byCompany.Linear!, status: "SUBMITTED", submittedAt: new Date() } });
  const ramp = await prisma.application.create({ data: { userId: user.id, jobId: byCompany.Ramp!, status: "READY", attentionReason: "FINAL_REVIEW" } });
  const stripe = await prisma.application.create({ data: { userId: user.id, jobId: byCompany.Stripe!, status: "QUEUED" } });
  return { user, linear, ramp, stripe };
}

const column = (page: Page, label: string) => page.getByRole("listitem", { name: new RegExp(`^${label}, \\d+$`) });

/** Drag with real mouse movement; the board uses native HTML drag and drop. */
async function drag(page: Page, card: Locator, target: Locator) {
  await card.scrollIntoViewIfNeeded();
  const from = (await card.boundingBox())!;
  await page.mouse.move(from.x + 12, from.y + from.height - 8);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 30, { steps: 5 });
  await target.scrollIntoViewIfNeeded();
  const to = (await target.boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 10 });
  await page.mouse.up();
}

test("drags cards between stages, confirms an outside application, and keeps the timeline", async ({ page }) => {
  const { linear, ramp } = await seed(page);
  await page.goto("/flightpath");
  await expect(page.getByRole("heading", { name: "Flightpath" })).toBeVisible();
  await expect(column(page, "Submitted").getByText("Linear")).toBeVisible();
  await expect(column(page, "Needs you").getByText("Ramp")).toBeVisible();
  await expect(column(page, "Queued").getByText("Stripe")).toBeVisible();

  // Drag Linear from Submitted to Interviewing.
  await drag(page, column(page, "Submitted").getByTestId("flightpath-card").filter({ hasText: "Linear" }), column(page, "Interviewing"));
  await expect(page.getByText("Moved to Interviewing", { exact: true })).toBeVisible();
  await expect(column(page, "Interviewing").getByText("Linear")).toBeVisible();
  expect(await prisma.application.findUniqueOrThrow({ where: { id: linear.id } })).toMatchObject({ status: "SUBMITTED", outcome: "INTERVIEW" });

  // Ramp was filled but not sent; moving it to Offer means the person applied themselves, so it asks first.
  await column(page, "Needs you").getByTestId("flightpath-card").filter({ hasText: "Ramp" }).getByRole("button", { name: "Move to stage" }).click();
  await page.getByRole("menuitem", { name: "Offer" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("marks the application as submitted by you");
  await page.getByRole("button", { name: "Yes, mark submitted" }).click();
  await expect(page.getByText("Marked submitted and moved to Offer", { exact: true })).toBeVisible();
  await expect(column(page, "Offer").getByText("Ramp")).toBeVisible();
  expect(await prisma.application.findUniqueOrThrow({ where: { id: ramp.id } })).toMatchObject({ status: "SUBMITTED", outcome: "OFFER", attentionReason: null });

  // The automation's own columns can't be dropped on.
  await drag(page, column(page, "Interviewing").getByTestId("flightpath-card").filter({ hasText: "Linear" }), column(page, "Processing"));
  await expect(column(page, "Interviewing").getByText("Linear")).toBeVisible();
  expect((await prisma.application.findUniqueOrThrow({ where: { id: linear.id } })).outcome).toBe("INTERVIEW");

  // Every move is on the application's timeline.
  await column(page, "Interviewing").getByRole("link", { name: "Account Executive" }).click();
  await expect(page).toHaveURL(new RegExp(`/applications/${linear.id}$`));
  await expect(page.getByTestId("timeline-stage")).toContainText("Interviewing");
  await expect(page.getByText("Moved from Submitted to Interviewing")).toBeVisible();
});

test("records interview rounds and shows them on the board and dashboard", async ({ page }) => {
  const { linear } = await seed(page);
  await page.goto(`/applications/${linear.id}`);
  await page.getByRole("button", { name: "Add interview" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name (optional)").fill("Intro with the VP of Sales");
  const when = new Date(Date.now() + 3 * 86400_000);
  const local = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}T14:30`;
  await dialog.getByLabel("Date and time").fill(local);
  await dialog.getByLabel("Length (minutes)").fill("45");
  await dialog.getByLabel("Notes").fill("Ask about territory and quota.");
  await dialog.getByRole("button", { name: "Add interview" }).click();
  await expect(page.getByText("Interview added").first()).toBeVisible();

  const round = page.getByTestId("interview-round");
  await expect(round).toContainText("Intro with the VP of Sales");
  await expect(round).toContainText("2:30 PM · 45 min");
  await expect(round).toContainText("Ask about territory and quota.");
  // The first round moves the application to Interviewing.
  await expect(page.getByRole("button", { name: "Move to" })).toBeVisible();
  await expect(page.getByTestId("timeline-stage")).toContainText("Interviewing");
  expect((await prisma.application.findUniqueOrThrow({ where: { id: linear.id } })).outcome).toBe("INTERVIEW");

  await page.goto("/flightpath");
  await expect(column(page, "Interviewing").getByTestId("flightpath-card")).toContainText("Intro with the VP of Sales");

  await page.goto("/dashboard");
  await expect(page.getByTestId("stage-count-INTERVIEWING")).toContainText("1");
  await expect(page.getByText("Linear · Intro with the VP of Sales")).toBeVisible();

  // Mark the round completed from its menu.
  await page.goto(`/applications/${linear.id}`);
  await page.getByRole("button", { name: "Actions for Intro with the VP of Sales" }).click();
  await page.getByRole("menuitem", { name: "Mark completed" }).click();
  await expect(page.getByText("Marked completed", { exact: true })).toBeVisible();
  await expect(round).toContainText("Completed");
});

test("table view filters by stage and changes stages inline", async ({ page }) => {
  const { linear } = await seed(page);
  await page.goto("/flightpath");
  await page.getByRole("tab", { name: /Table/ }).click();
  await expect(page).toHaveURL(/view=table/);
  await expect(page.getByTestId("flightpath-row")).toHaveCount(3);

  await page.getByRole("tab", { name: /^Applied/ }).click();
  await expect(page.getByTestId("flightpath-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Stage: Submitted. Change stage" }).click();
  await page.getByRole("menuitem", { name: "Rejected" }).click();
  await expect(page.getByText("Moved to Rejected", { exact: true })).toBeVisible();
  expect(await prisma.application.findUniqueOrThrow({ where: { id: linear.id } })).toMatchObject({ status: "REJECTED", outcome: "DECLINED" });

  await page.getByRole("tab", { name: /^Closed/ }).click();
  await expect(page.getByTestId("flightpath-row")).toContainText("Linear");
});
