import { expect, test } from "@playwright/test";
import { addJob, signUp } from "./helpers";

test("tailors, edits, exports and approves a resume and cover letter for a job", async ({ page }) => {
  await signUp(page, "Jordan Rivera");
  await page.goto("/profile");
  await page.getByLabel("First name").fill("Jordan");
  await page.getByLabel("Last name").fill("Rivera");
  await page.getByRole("button", { name: "Save personal details" }).click();
  await expect(page.getByText("Personal details saved")).toBeVisible();
  await page.getByRole("tab", { name: "Professional" }).click();
  await page.getByLabel("Current title").fill("Account Executive");
  await page.getByLabel("Skills", { exact: true }).fill("Negotiation, Prospecting,");
  await page.getByRole("button", { name: "Save professional details" }).click();
  await expect(page.getByText("Professional details saved")).toBeVisible();
  await page.getByRole("tab", { name: "Employment" }).click();
  await page.getByRole("button", { name: "Add position" }).click();
  const role = page.getByRole("dialog");
  await role.getByLabel("Company").fill("Brightwave");
  await role.getByLabel("Title").fill("Account Executive");
  await role.getByLabel("Start date").fill("2022-03-01");
  await role.getByLabel("I currently work here").check();
  await role.getByLabel("Achievements").fill("Closed 130% of quota in 2024\nBooked 40 meetings per quarter");
  await role.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Employment saved")).toBeVisible();

  await addJob(page, { url: "https://example.com/careers/ae-42", title: "Senior Account Executive", company: "Acme Payments" });
  await expect(page.getByText("Added Senior Account Executive")).toBeVisible();
  await page.goto("/jobs");
  await page.getByRole("link", { name: "Senior Account Executive" }).click();

  // Tailor the resume: built only from the profile, and a draft until approved.
  const resume = page.getByTestId("generated-resume");
  await resume.getByRole("button", { name: "Tailor resume" }).click();
  await expect(page.getByText("Resume written from your profile.")).toBeVisible();
  await expect(resume).toHaveAttribute("data-state", "draft");
  await expect(resume.getByText("Draft: not used until you approve it")).toBeVisible();
  await expect(resume.getByTestId("resume-preview")).toContainText("Closed 130% of quota in 2024");
  await expect(resume.getByTestId("resume-preview")).toContainText("Account Executive, Brightwave");

  // Edit the summary.
  await resume.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog");
  await edit.getByLabel("Summary").fill("Account Executive who closes with finance teams.");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(resume.getByTestId("resume-preview")).toContainText("Account Executive who closes with finance teams.");
  await expect(resume).toContainText("then edited by you");

  // Both exports download real files.
  const pdfHref = await resume.getByRole("link", { name: "PDF" }).getAttribute("href");
  const pdf = await page.request.get(pdfHref!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect(pdf.headers()["content-disposition"]).toContain("jordan-rivera-resume-acme-payments.pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const docx = await page.request.get((await resume.getByRole("link", { name: "Word" }).getAttribute("href"))!);
  expect(docx.headers()["content-type"]).toContain("wordprocessingml");
  expect((await docx.body()).subarray(0, 2).toString()).toBe("PK");

  await resume.getByRole("button", { name: "Approve for this job" }).click();
  await expect(page.getByText("Resume approved. The application for this job will use it.")).toBeVisible();
  await expect(resume).toHaveAttribute("data-state", "approved");
  await expect(resume.getByText("Saved as jordan-rivera-resume-acme-payments.pdf in Documents.")).toBeVisible();

  // The cover letter.
  const letter = page.getByTestId("generated-cover-letter");
  await letter.getByRole("button", { name: "Write cover letter" }).click();
  await expect(letter.getByTestId("cover-letter-preview")).toContainText("Dear Acme Payments hiring team,");
  await expect(letter.getByTestId("cover-letter-preview")).toContainText("I'm currently an Account Executive at Brightwave");
  await letter.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expect(letter.getByRole("button", { name: "Write cover letter" })).toBeVisible();

  // The approved resume is in Documents, tied to the job.
  await page.goto("/documents");
  await expect(page.getByText("Resume for Senior Account Executive at Acme Payments")).toBeVisible();
});
