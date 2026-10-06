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

test("job board search only accepts public Greenhouse, Lever and Ashby boards", async ({ page }) => {
  await signUp(page);
  await page.goto("/jobs");
  await page.getByRole("button", { name: "Search job boards" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Keywords").fill("account executive");
  await dialog.getByLabel("Job boards to search").fill("https://www.linkedin.com/jobs/search?keywords=sales\nboards.greenhouse.io/acme");
  await dialog.getByRole("button", { name: "Search" }).click();
  await expect(dialog.getByText("Not a Greenhouse, Lever or Ashby board: https://www.linkedin.com/jobs/search?keywords=sales").first()).toBeVisible();

  await dialog.getByLabel("Job boards to search").fill("boards.greenhouse.io/acme");
  await dialog.getByLabel("Keywords").fill("");
  await dialog.getByRole("button", { name: "Search" }).click();
  await expect(dialog.getByText("Enter keywords to search for").first()).toBeVisible();
});

test("recommends saved jobs that mention your keywords", async ({ page }) => {
  await signUp(page);
  await page.goto("/recommended");
  await expect(page.getByText("No recommendations yet")).toBeVisible();

  await page.goto("/jobs");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Export file").setInputFiles({ name: "jobs.csv", mimeType: "text/csv", buffer: Buffer.from(JOBS) });
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog.getByTestId("import-result")).toContainText("Imported 3 new jobs");
  await dialog.getByRole("button", { name: "Done" }).click();

  await page.getByRole("link", { name: "Recommended" }).click();
  const keywords = page.getByLabel("Your keywords");
  await keywords.fill("medical devices");
  await keywords.press("Enter");
  await keywords.fill("customer success");
  await keywords.press("Enter");
  await page.getByRole("button", { name: "Save keywords" }).click();
  await expect(page.getByText("Keywords saved. Recommendations updated.")).toBeVisible();

  const list = page.getByTestId("recommendation");
  await expect(list).toHaveCount(2);
  await expect(list.filter({ hasText: "Customer Success Manager" })).toContainText("customer success");
  await expect(list.filter({ hasText: "Globex" })).toContainText("medical devices");
  await expect(page.getByTestId("recommendations")).not.toContainText("Acme");

  // Board search opens with the keywords, matching any of them.
  await page.getByRole("button", { name: "Find more on job boards" }).click();
  await expect(page.getByRole("dialog").getByLabel("Keywords")).toHaveValue('"medical devices" "customer success"');
  await expect(page.getByRole("dialog").getByLabel("Match any keyword, not all of them")).toBeChecked();
});
