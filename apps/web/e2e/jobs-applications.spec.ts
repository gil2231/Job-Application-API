import { expect, test } from "@playwright/test";
import { addJob, signUp } from "./helpers";

test("adds jobs, deduplicates, filters, applies and tracks the application", async ({ page }) => {
  await signUp(page);

  await addJob(page, { url: "https://boards.greenhouse.io/acme/jobs/4012345?utm_source=linkedin", title: "Account Executive", company: "Acme", salary: "$70,000 - $80,000" });
  await expect(page.getByText("Added Account Executive at Acme")).toBeVisible();
  await addJob(page, { url: "https://jobs.lever.co/globex/abc-123", title: "BDR", company: "Globex" });
  await expect(page.getByText("Added BDR at Globex")).toBeVisible();

  // Same posting with different tracking params is a duplicate.
  await addJob(page, { url: "https://boards.greenhouse.io/acme/jobs/4012345/", title: "Account Executive", company: "Acme" });
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("already in your list");
  await page.keyboard.press("Escape");

  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table.getByText("Greenhouse")).toBeVisible();
  await expect(table.getByText("$70K–$80K")).toBeVisible();

  // Search filter
  await page.getByLabel("Search jobs").fill("glob");
  await expect(table.getByRole("row")).toHaveCount(2);
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(table.getByRole("row")).toHaveCount(3);

  // Apply via the row menu
  await page.getByRole("button", { name: "Actions for Account Executive" }).click();
  await page.getByRole("menuitem", { name: "Apply" }).click();
  await expect(page.getByText(/Queued 1 application in review mode/)).toBeVisible();
  await expect(table.getByRole("row", { name: /Account Executive/ }).getByText("Queued")).toBeVisible();

  // Status filter now finds it
  await page.goto("/jobs?status=QUEUED");
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);

  // Application detail shows the timeline and activity
  await page.goto("/applications");
  await page.getByRole("link", { name: "Acme" }).click();
  await expect(page.getByRole("heading", { name: "Account Executive" })).toBeVisible();
  await expect(page.getByText("Queued in review mode")).toBeVisible();
  await expect(page.getByText("Job imported")).toBeVisible();
  await page.getByLabel("Note").fill("Referred by a friend");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Referred by a friend")).toBeVisible();

  // Dashboard reflects the pipeline
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: /Total jobs\s*2/i })).toBeVisible();
  await expect(page.getByText("Account Executive")).toBeVisible();
});

test("skips and deletes jobs in bulk", async ({ page }) => {
  await signUp(page);
  await addJob(page, { url: "https://example.com/careers/1", title: "Role One", company: "One Co" });
  await expect(page.getByText("Added Role One")).toBeVisible();
  await addJob(page, { url: "https://example.com/careers/2", title: "Role Two", company: "Two Co" });
  await expect(page.getByText("Added Role Two")).toBeVisible();

  await page.getByRole("checkbox", { name: "Select all" }).check();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByText("Skipped 2 jobs")).toBeVisible();

  await page.getByRole("checkbox", { name: "Select Role One" }).check();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Deleted 1 job")).toBeVisible();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
});

test("another user's application is not reachable", async ({ page, browser }) => {
  await signUp(page);
  await addJob(page, { url: "https://jobs.ashbyhq.com/acme/xyz", title: "Private Role", company: "Secret Inc" });
  await page.getByRole("button", { name: "Actions for Private Role" }).click();
  await page.getByRole("menuitem", { name: "Apply" }).click();
  await expect(page.getByText(/Queued 1 application/)).toBeVisible();
  await page.goto("/applications");
  await page.getByRole("link", { name: "Secret Inc" }).click();
  await expect(page).toHaveURL(/\/applications\/[a-z0-9]+$/);
  const url = page.url();

  const other = await browser.newPage();
  await signUp(other);
  await other.goto(url);
  await expect(other.getByText("We couldn't find that page")).toBeVisible();
  await other.close();
});
