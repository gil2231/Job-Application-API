import { expect, test } from "@playwright/test";
import { prisma, setUserRole } from "@autoapply/database";
import { addJob, signUp } from "./helpers";

test.afterAll(() => prisma.$disconnect());

test.describe("legal pages and help center", () => {
  test("are readable without signing in and linked from sign-up", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.getByText("By creating an account, you agree to the")).toBeVisible();
    await page.goto("/terms");
    await expect(page.getByRole("heading", { name: "Terms of Service", level: 1 })).toBeVisible();
    await expect(page.getByText("Draft for legal review.")).toBeVisible();
    await page.getByRole("navigation", { name: "Contents" }).getByRole("link", { name: "Plans, billing and cancellation" }).click();
    await expect(page).toHaveURL(/#billing$/);

    await page.goto("/privacy");
    await expect(page.getByRole("heading", { name: "Privacy Policy", level: 1 })).toBeVisible();
    await expect(page.getByText("We do not sell your personal information")).toBeVisible();
  });

  test("help center search finds articles", async ({ page }) => {
    await page.goto("/help");
    await page.getByLabel("Search help articles").fill("captcha");
    await page.getByRole("link", { name: /When an application needs you/ }).click();
    await expect(page.getByRole("heading", { name: "When an application needs you", level: 1 })).toBeVisible();
    // App links are only shown to signed-in readers.
    await expect(page.getByRole("link", { name: "Open Needs Attention" })).toHaveCount(0);

    await page.goto("/help");
    await page.getByLabel("Search help articles").fill("zzzz nothing");
    await expect(page.getByText("No articles match.")).toBeVisible();
  });

  test("signed-out visitors can contact support", async ({ page }) => {
    await page.goto("/help");
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await page.getByLabel("Email to reply to").fill("locked-out@example.com");
    await page.getByLabel("Summary").fill("Locked out of my account");
    await page.getByLabel("What happened?").fill("I can't sign in after resetting my laptop.");
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByText("Message sent")).toBeVisible();
  });
});

test("report a problem from the app and from an application", async ({ page }) => {
  await signUp(page);
  await page.goto("/dashboard");
  const sidebar = page.locator("aside");
  await sidebar.getByRole("button", { name: "Report a problem" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Summary").fill("Dashboard chart is empty");
  await dialog.getByLabel("What happened?").fill("The weekly chart shows nothing even though I applied today.");
  await dialog.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Thanks. We got your message")).toBeVisible();
  await expect(dialog).toHaveCount(0);

  await addJob(page, { url: `https://example.com/jobs/report-${Date.now()}`, title: "Support Analyst", company: "Reportco" });
  await page.getByRole("button", { name: "Actions for Support Analyst" }).click();
  await page.getByRole("menuitem", { name: "Apply" }).click();
  await expect(page.getByText(/Queued 1 application/)).toBeVisible();
  await page.goto("/applications");
  await page.getByRole("link", { name: "Reportco" }).click();
  await expect(page.getByRole("heading", { name: "Support Analyst" })).toBeVisible();
  await page.getByRole("main").getByRole("button", { name: "Report a problem" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByText("and this application")).toBeVisible();
  await expect(dialog.getByRole("combobox")).toHaveText("A problem with an application");
});

test("admins read and resolve reports in the admin panel", async ({ browser, page }) => {
  const subject = `Upload stuck ${Date.now()}`;
  const customerPage = await browser.newPage();
  await signUp(customerPage, "Riley Reporter");
  await customerPage.goto("/dashboard");
  await customerPage.locator("aside").getByRole("button", { name: "Report a problem" }).click();
  const dialog = customerPage.getByRole("dialog");
  await dialog.getByLabel("Summary").fill(subject);
  await dialog.getByLabel("What happened?").fill("My resume upload has been spinning for ten minutes.");
  await dialog.getByRole("button", { name: "Send report" }).click();
  await expect(customerPage.getByText("Thanks. We got your message")).toBeVisible();
  await customerPage.close();

  const owner = await signUp(page, "Owner Person");
  await setUserRole(owner.email, "ADMIN");
  await page.goto("/admin");
  await page.getByTestId("admin-card-Open reports").click();
  await expect(page).toHaveURL(/\/admin\/reports$/);
  const report = page.getByTestId("admin-reports").getByRole("listitem").filter({ hasText: subject });
  await expect(report.getByText("My resume upload has been spinning")).toBeVisible();
  await expect(report.getByText(/Riley Reporter/)).toBeVisible();
  await expect(report.getByRole("link", { name: "Reply by email" })).toHaveAttribute("href", /^mailto:e2e-.*subject=Re%3A%20Upload%20stuck/);

  await report.getByRole("button", { name: "Mark resolved" }).click();
  await expect(page.getByText("Marked resolved")).toBeVisible();
  await expect(page.getByTestId("admin-reports").getByText(subject)).toHaveCount(0);
  await page.getByRole("tab", { name: "Resolved" }).click();
  await expect(page.getByTestId("admin-reports").getByText(subject)).toBeVisible();
});
