import { expect, test } from "@playwright/test";
import { prisma } from "@autoapply/database";
import { createUnsubscribeToken } from "@autoapply/notifications";
import { signUp } from "./helpers";

test.afterAll(() => prisma.$disconnect());

const userId = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

test("notification settings save, send a test email and list it", async ({ page }) => {
  await signUp(page);
  await page.goto("/settings#notifications");
  const card = page.locator("#notifications");
  await expect(card.getByLabel("Needs Attention emails")).toBeChecked();
  await card.getByLabel("Daily job alerts").uncheck();
  await card.getByRole("combobox", { name: "Send job alerts at" }).click();
  await page.getByRole("option", { name: "7:00 AM" }).click();
  await card.getByRole("button", { name: "Save notifications" }).click();
  await expect(page.getByText("Notification settings saved")).toBeVisible();
  await page.reload();
  await expect(card.getByLabel("Daily job alerts")).not.toBeChecked();
  await expect(card.getByRole("combobox", { name: "Send job alerts at" })).toHaveText("7:00 AM");

  // Locally, emails are printed by the dev server instead of sent.
  await card.getByRole("button", { name: "Send me a test email" }).click();
  await expect(page.getByText(/Test email sent to/)).toBeVisible();
  await expect(card.getByText("Applyance test email")).toBeVisible();
});

test("saved searches list their new matches and can be paused and deleted", async ({ page }) => {
  const { email } = await signUp(page);
  await page.goto("/job-alerts");
  await expect(page.getByText("No saved searches yet")).toBeVisible();
  await page.getByRole("button", { name: "New saved search" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("AE roles");
  await dialog.getByLabel("Keywords").fill('"account executive"');
  await dialog.getByLabel("Job boards").fill("https://boards.greenhouse.io/acme\nhttps://www.linkedin.com/jobs");
  await dialog.getByRole("button", { name: "Save search" }).click();
  await expect(dialog.locator("#search-boards-error")).toHaveText("Not a Greenhouse, Lever or Ashby board: https://www.linkedin.com/jobs");
  await dialog.getByLabel("Job boards").fill("https://boards.greenhouse.io/acme");
  await dialog.getByRole("button", { name: "Save search" }).click();
  await expect(page.getByText(/Saved "AE roles"/)).toBeVisible();
  const row = page.getByTestId("saved-search");
  await expect(row).toContainText("AE roles");
  await expect(row).toContainText('"account executive" · 1 board');

  // What a morning run found (the boards themselves aren't reachable from tests).
  const search = await prisma.savedSearch.findFirstOrThrow({ where: { userId: await userId(email) } });
  await prisma.savedSearchMatch.create({
    data: { savedSearchId: search.id, userId: search.userId, canonicalUrl: "https://boards.greenhouse.io/acme/jobs/9", url: "https://boards.greenhouse.io/acme/jobs/9", title: "Enterprise Account Executive", company: "Acme", location: "Remote", wasNew: true },
  });
  await page.reload();
  await expect(page.getByTestId("alert-match")).toContainText("Enterprise Account Executive");
  await expect(page.getByTestId("alert-match")).toContainText("AE roles · found");

  await row.getByRole("switch", { name: "Daily emails for AE roles" }).click();
  await expect(page.getByText("Daily emails paused for this search")).toBeVisible();
  await expect(row.getByText("Paused")).toBeVisible();
  await row.getByRole("button", { name: "Delete AE roles" }).click();
  await expect(page.getByText("Saved search deleted")).toBeVisible();
  await expect(page.getByText("No saved searches yet")).toBeVisible();
});

test("an unsubscribe link turns off one kind of email after confirming", async ({ page }) => {
  const { email } = await signUp(page);
  const id = await userId(email);
  await page.context().clearCookies();
  await page.goto(`/unsubscribe?token=${encodeURIComponent(createUnsubscribeToken(id, "job_alerts"))}`);
  await expect(page.getByText("Unsubscribe?")).toBeVisible();
  // Opening the link alone changes nothing.
  expect((await prisma.userSetting.findUniqueOrThrow({ where: { userId: id } })).jobAlertEmails).toBe(true);
  await page.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(page.getByText("You're unsubscribed")).toBeVisible();
  const settings = await prisma.userSetting.findUniqueOrThrow({ where: { userId: id } });
  expect(settings).toMatchObject({ jobAlertEmails: false, emailNotifications: true });

  await page.goto("/unsubscribe?token=bogus.job_alerts.abc");
  await expect(page.getByText("This link doesn't work")).toBeVisible();
});
