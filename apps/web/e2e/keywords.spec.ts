import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

const csv = (rows: string[][]) =>
  ["url,title,company,location,description", ...rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(","))].join("\n");

const JOBS = csv([
  ["https://boards.greenhouse.io/acme/jobs/1", "Account Executive", "Acme", "New York, NY", "Sell our SaaS platform to finance teams. Base salary $80,000 - $90,000 plus commission. Full-time."],
  ["https://boards.greenhouse.io/globex/jobs/2", "Account Executive", "Globex", "New York, NY", "Sell medical devices to hospitals across the Northeast. Base salary $80,000 - $90,000. Full-time role in our New York office."],
  ["https://boards.greenhouse.io/initech/jobs/3", "Customer Success Manager", "Initech", "Austin, TX", "Keep SaaS customers happy and renewing. Run onboarding and quarterly business reviews. Full-time."],
]);

test("searches jobs by keyword and qualifies them with include and exclude keywords", async ({ page }) => {
  await signUp(page);
  await page.goto("/jobs");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Export file").setInputFiles({ name: "jobs.csv", mimeType: "text/csv", buffer: Buffer.from(JOBS) });
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog.getByTestId("import-result")).toContainText("Imported 3 new jobs");
  await dialog.getByRole("button", { name: "Done" }).click();

  // Keyword search reaches into descriptions, supports phrases and -exclusions.
  const table = page.getByRole("table");
  const search = page.getByLabel("Search jobs by keyword");
  await search.fill('"medical devices"');
  await expect(page).toHaveURL(/q=%22medical/);
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).toContainText("Globex");
  await search.fill("saas -commission");
  await expect(page).toHaveURL(/q=saas/);
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).toContainText("Initech");
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(table.getByRole("row")).toHaveCount(4);

  // Include keywords: a job must mention one of them to qualify.
  await page.goto("/rules");
  await page.getByLabel("Minimum match score").fill("0");
  await page.getByLabel("Include keywords").fill("SaaS");
  await page.getByLabel("Include keywords").press("Enter");
  await page.getByLabel("Exclude keywords").fill("commission");
  await page.getByLabel("Exclude keywords").press("Enter");
  await page.getByRole("button", { name: "Save rules" }).click();
  await expect(page.getByText(/Rules saved\./)).toBeVisible();

  await page.goto("/jobs?q=globex");
  await expect(table.getByRole("row")).toHaveCount(2, { timeout: 20_000 });
  await table.getByRole("link", { name: "Account Executive" }).click();
  const checks = page.getByTestId("rule-checks");
  await expect(checks).toContainText('Mentions "SaaS"');
  await expect(checks).toContainText('Doesn\'t mention "SaaS".');
  await expect(page.getByText("Doesn't qualify under your rules")).toBeVisible();

  await page.goto("/jobs?q=acme");
  await table.getByRole("link", { name: "Account Executive" }).click();
  await expect(page.getByTestId("rule-checks")).toContainText('Mentions "commission".');
});

test("specific board search only accepts public company job boards", async ({ page }) => {
  await signUp(page);
  await page.goto("/jobs");
  await page.getByRole("button", { name: "Search specific boards" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Keywords").fill("account executive");
  await dialog.getByLabel("Job boards to search").fill("https://www.linkedin.com/jobs/search?keywords=sales\nboards.greenhouse.io/acme");
  await dialog.getByRole("button", { name: "Search" }).click();
  await expect(dialog.getByText("Not a Greenhouse, Lever, Ashby, Workday, Workable, SmartRecruiters or Recruitee board: https://www.linkedin.com/jobs/search?keywords=sales").first()).toBeVisible();

  await dialog.getByLabel("Job boards to search").fill("boards.greenhouse.io/acme");
  await dialog.getByLabel("Keywords").fill("");
  await dialog.getByRole("button", { name: "Search" }).click();
  await expect(dialog.getByText("Enter keywords to search for").first()).toBeVisible();
});

// The job boards and JSearch are stood in for by fake-job-sources.ts (E2E_FAKE_JOB_SOURCES=1).
test("searches every job site at once and adds the picked jobs", async ({ page }) => {
  await signUp(page);
  await page.goto("/jobs");
  await page.getByLabel("Search all job sites").fill("account executive");
  await page.getByLabel("Location").fill("New York");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByTestId("search-summary")).toContainText("Found 3 jobs across 6 job boards, LinkedIn, Indeed and more.");
  const results = page.getByTestId("found-job");
  await expect(results).toHaveCount(3);
  // Found on Acme's Greenhouse board and on LinkedIn: listed once, with the company's own link.
  const acme = results.filter({ hasText: "Account Executive, FinTech" });
  await expect(acme).toContainText("Greenhouse");
  await expect(acme).toContainText("LinkedIn");
  await expect(acme.getByRole("link", { name: "Account Executive, FinTech", exact: true })).toHaveAttribute("href", "https://boards.greenhouse.io/acme/jobs/11");
  await expect(results.filter({ hasText: "Vandelay Industries" })).toContainText("Indeed");
  await expect(results.filter({ hasText: "Hooli" })).toContainText("SmartRecruiters");

  await page.getByLabel("Select Account Executive at Vandelay Industries").uncheck().catch(() => undefined);
  await page.getByLabel("Select Account Executive at Hooli").check();
  await page.getByLabel("Select Account Executive, FinTech at Acme").check();
  await page.getByRole("button", { name: "Add 2 jobs" }).click();
  await expect(page.getByText("Added 2 new jobs.")).toBeVisible();
  await expect(acme).toContainText("In your list");
  await expect(page.getByRole("table")).toContainText("Hooli");
});

test("recommends jobs from one box of preferences", async ({ page }) => {
  await signUp(page);
  await page.goto("/jobs");
  // New users start from the default list.
  await expect(page.getByTestId("search-preferences")).toContainText("Sales Development Representative, Account Executive");

  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Export file").setInputFiles({ name: "jobs.csv", mimeType: "text/csv", buffer: Buffer.from(JOBS) });
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog.getByTestId("import-result")).toContainText("Imported 3 new jobs");
  await dialog.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Edit preferences" }).click();
  await page.getByLabel("Your job preferences").fill("medical devices, Customer Success, NYC");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Preferences saved (3 terms). Recommendations updated.")).toBeVisible();
  await expect(page.getByTestId("search-preferences")).toContainText("medical devices, Customer Success, NYC");

  const saved = page.getByTestId("recommendation");
  await expect(saved).toHaveCount(2);
  await expect(saved.filter({ hasText: "Customer Success Manager" })).toContainText("Customer Success");
  await expect(saved.filter({ hasText: "Globex" })).toContainText("medical devices");
  await expect(page.getByTestId("recommendations")).not.toContainText("Acme");

  // New openings on the job boards that fit, without searching.
  const openings = page.getByTestId("openings-results");
  await expect(openings).toContainText("Customer Success Manager");
  await expect(openings).not.toContainText("Software Engineer");

  // The old Recommended page now leads here.
  await page.goto("/recommended");
  await expect(page).toHaveURL(/\/jobs$/);
});
