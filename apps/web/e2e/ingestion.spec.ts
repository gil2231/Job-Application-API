import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

const LINKEDIN_SAVED_JOBS = [
  "Saved Date,Job Url,Job Title,Company Name",
  '"10/3/24, 2:15 PM",https://www.linkedin.com/jobs/view/3901234567/,Business Development Representative,Acme',
  '"10/1/24, 9:00 AM",https://www.linkedin.com/jobs/view/3907654321/,Account Executive,Globex',
  '"10/1/24, 9:00 AM",https://www.linkedin.com/jobs/view/3901234567/,Business Development Representative,Acme',
].join("\n");

const DESCRIPTION = `About Acme
Acme is a B2B SaaS platform for finance teams.

Requirements:
• 1+ years of experience in sales or customer-facing roles
• Bachelor's degree or equivalent experience
• Experience with Salesforce and cold calling

Compensation
The base salary range for this role is $65,000 - $75,000 per year plus commission.

This is a full-time, hybrid position in New York, NY.`;

test("imports LinkedIn saved jobs, completes one and qualifies it", async ({ page }) => {
  await signUp(page);
  await page.goto("/jobs");
  await expect(page.getByText(/Import your LinkedIn saved jobs/)).toBeVisible();

  // LinkedIn data export upload
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Export file").setInputFiles({ name: "Saved Jobs.csv", mimeType: "text/csv", buffer: Buffer.from(LINKEDIN_SAVED_JOBS) });
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  const result = dialog.getByTestId("import-result");
  await expect(result).toContainText("Imported 2 new jobs, 1 already in your list.");
  await expect(result).toContainText("Listed more than once in this import.");
  await result.getByRole("button", { name: "Done" }).click();

  // Pasting the same LinkedIn link again is caught as a duplicate.
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await dialog.getByRole("tab", { name: "Paste URLs" }).click();
  await dialog.getByLabel("Job URLs").fill("https://www.linkedin.com/jobs/view/3907654321/?refId=abc");
  await dialog.getByRole("button", { name: "Import URLs" }).click();
  await expect(dialog.getByTestId("import-result")).toContainText("Imported 0 new jobs, 1 already in your list.");
  await dialog.getByRole("button", { name: "Done" }).click();

  // Without descriptions the jobs can't be qualified yet.
  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table.getByRole("row", { name: /Business Development Representative/ }).getByText("Needs Details")).toBeVisible({ timeout: 20_000 });

  // Add the description and the job is analyzed, scored and qualified.
  await table.getByRole("link", { name: "Business Development Representative" }).click();
  await expect(page.getByRole("status").filter({ hasText: "no description yet" })).toBeVisible();
  await page.getByRole("button", { name: "Add description" }).click();
  await page.getByRole("dialog").getByLabel("Location").fill("New York, NY");
  await page.getByRole("dialog").getByLabel("Job description").fill(DESCRIPTION);
  await page.getByRole("button", { name: "Save and re-analyze" }).click();
  await expect(page.getByText("Details saved and the job was re-analyzed")).toBeVisible();

  await expect(page.getByTestId("job-skills")).toContainText("Salesforce");
  await expect(page.getByTestId("match-breakdown")).toContainText("Skills");
  await expect(page.getByText("$65,000 - $75,000 per year").first()).toBeVisible();
  const checks = page.getByTestId("rule-checks");
  await expect(checks).toContainText("Match score of at least 70");
  await expect(page.getByText("Doesn't qualify under your rules")).toBeVisible();

  // Loosening the rules re-checks every waiting job.
  await page.goto("/rules");
  await expect(page.getByTestId("rules-summary")).toContainText("Of 2 jobs waiting to be applied to");
  await page.getByLabel("Minimum match score").fill("40");
  await page.getByRole("button", { name: "Save rules" }).click();
  await expect(page.getByText("Rules saved. 1 of 2 waiting jobs qualify.")).toBeVisible();
  await page.getByRole("button", { name: "Re-score jobs" }).click();
  await expect(page.getByText(/Re-scored 2 jobs\. 1 qualify/)).toBeVisible();

  await page.goto("/jobs?status=QUALIFIED");
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  await page.getByRole("table").getByRole("link", { name: "Business Development Representative" }).click();
  await expect(page.getByText("Qualifies under your rules")).toBeVisible();

  // Import history
  await page.goto("/integrations");
  const history = page.getByTestId("import-history");
  await expect(history).toContainText("LinkedIn saved jobs");
  await expect(history).toContainText("Pasted URLs");
});

test("rejects files that aren't job lists", async ({ page }) => {
  await signUp(page);
  await page.goto("/jobs");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Export file").setInputFiles({ name: "contacts.csv", mimeType: "text/csv", buffer: Buffer.from("Name,Email\nAda,ada@example.com") });
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog.getByText(/No URL column found/).first()).toBeVisible();
});
