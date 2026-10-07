import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

const RESUME_PDF = resolve(import.meta.dirname, "fixtures/resume.pdf");

test("imports a resume into the Master Profile after review", async ({ page }) => {
  await signUp(page, "Jane Doe");
  await page.getByRole("link", { name: "Import from resume" }).click();
  await expect(page).toHaveURL(/\/profile\/import$/);

  await page.getByLabel("Upload a file").setInputFiles(RESUME_PDF);
  await page.getByRole("button", { name: "Read resume" }).click();
  await expect(page.getByText("Read resume.pdf with the built-in reader")).toBeVisible();

  // Contact details come straight from the resume.
  await expect(page.getByLabel("First name", { exact: true })).toHaveValue("Jane");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("jane.doe@example.com");
  await expect(page.getByLabel("LinkedIn", { exact: true })).toHaveValue("https://linkedin.com/in/janedoe");
  // The country isn't on the resume, so it isn't offered.
  await expect(page.getByLabel("Country", { exact: true })).toHaveCount(0);

  const current = page.getByTestId("employment-0");
  await expect(current.getByLabel("Title")).toHaveValue("Senior Account Executive");
  await expect(current.getByLabel("Company")).toHaveValue("Northwind Software Inc.");
  await expect(current.getByLabel("Start")).toHaveValue("2022-01");
  await expect(current.getByLabel("I currently work here")).toBeChecked();
  await expect(current.getByLabel("Achievements")).toHaveValue("Closed $1.2M in new ARR in 2023, 128% of quota");

  // Leave out the older job and fix a typo before saving.
  await page.getByTestId("employment-1").getByRole("checkbox").first().uncheck();
  await current.getByLabel("Title").fill("Senior Account Executive II");
  await expect(page.getByTestId("education-0").getByLabel("School")).toHaveValue("University of Texas at Austin");
  await expect(page.getByTestId("education-0").getByLabel("GPA")).toHaveValue("3.6");
  await expect(page.getByText("Spanish (professional)")).toBeVisible();

  await page.getByRole("button", { name: "Add to profile" }).click();
  await expect(page.getByText(/Added to your profile: .*1 job, 1 school, 5 skills/)).toBeVisible();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByLabel("First name")).toHaveValue("Jane");
  await expect(page.getByLabel("City")).toHaveValue("Austin");

  await page.getByRole("tab", { name: "Employment" }).click();
  await expect(page.getByText("Senior Account Executive II")).toBeVisible();
  await expect(page.getByText("Sales Development Representative")).toHaveCount(0);
  await page.getByRole("tab", { name: /Documents/ }).click();
  await expect(page.getByText("resume.pdf")).toBeVisible();

  // Importing again offers nothing twice.
  await page.goto("/profile/import");
  await page.getByLabel("Upload a file").setInputFiles(RESUME_PDF);
  await page.getByRole("button", { name: "Read resume" }).click();
  await expect(page.getByTestId("education-0").getByText("Already in your profile")).toBeVisible();
  await expect(page.getByLabel("Also save resume.pdf to Documents as a resume")).not.toBeChecked();
  await expect(page.getByText("5 already in your profile are left out.")).toBeVisible();
});

test("explains a file it can't read", async ({ page }) => {
  await signUp(page);
  await page.goto("/profile/import");
  await page.getByLabel("Upload a file").setInputFiles({ name: "resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("not really a pdf") });
  await page.getByRole("button", { name: "Read resume" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "This file is not a valid .pdf file" })).toBeVisible();
});
