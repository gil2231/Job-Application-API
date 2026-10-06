import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("fills every Master Profile section and persists it", async ({ page }) => {
  await signUp(page, "Ada Lovelace");
  await page.goto("/profile");

  // Personal
  await page.getByLabel("First name").fill("Ada");
  await page.getByLabel("Last name").fill("Lovelace");
  await page.getByLabel("Phone").fill("+1 555 010 0199");
  await page.getByLabel("City").fill("New York");
  await page.getByLabel("LinkedIn").fill("linkedin.com/in/ada");
  await page.getByRole("button", { name: "Save personal details" }).click();
  await expect(page.getByText("Enter a full URL starting with https://")).toBeVisible();
  await page.getByLabel("LinkedIn").fill("https://www.linkedin.com/in/ada");
  await page.getByRole("button", { name: "Save personal details" }).click();
  await expect(page.getByText("Personal details saved")).toBeVisible();

  // Professional
  await page.getByRole("tab", { name: "Professional" }).click();
  await page.getByLabel("Current title").fill("Business Development Representative");
  await page.getByLabel("Skills", { exact: true }).fill("Prospecting, Cold calling,");
  await page.getByLabel("Software").fill("Salesforce");
  await page.getByLabel("Software").press("Enter");
  await page.getByRole("button", { name: "Save professional details" }).click();
  await expect(page.getByText("Professional details saved")).toBeVisible();

  // Employment
  await page.getByRole("tab", { name: "Employment" }).click();
  await page.getByRole("button", { name: "Add position" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Company").fill("Acme Corp");
  await dialog.getByLabel("Title").fill("Sales Development Rep");
  await dialog.getByLabel("Start date").fill("2022-03-01");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText("Add an end date or mark this as your current role")).toBeVisible();
  await dialog.getByLabel("I currently work here").check();
  await dialog.getByLabel("Achievements").fill("Booked 40 meetings per quarter\nPromoted after 9 months");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Employment saved")).toBeVisible();
  await expect(page.getByText("Sales Development Rep")).toBeVisible();

  // Education
  await page.getByRole("tab", { name: "Education" }).click();
  await page.getByRole("button", { name: "Add education" }).click();
  const edu = page.getByRole("dialog");
  await edu.getByLabel("School").fill("State University");
  await edu.getByLabel("Degree").fill("BA");
  await edu.getByLabel("Major").fill("Economics");
  await edu.getByLabel("GPA", { exact: true }).fill("3.6");
  await edu.getByLabel("GPA scale").fill("4");
  await edu.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Education saved")).toBeVisible();

  // Documents
  await page.getByRole("tab", { name: "Documents" }).click();
  await page.getByRole("button", { name: "Upload document" }).click();
  const upload = page.getByRole("dialog");
  await upload.getByLabel("File").setInputFiles({ name: "resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% test resume\n") });
  await upload.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Document uploaded")).toBeVisible();
  await expect(page.getByText("Default").first()).toBeVisible();

  // A renamed non-PDF is rejected by its content, not its extension.
  await page.getByRole("button", { name: "Upload document" }).click();
  await page.getByRole("dialog").getByLabel("File").setInputFiles({ name: "evil.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ not a pdf") });
  await page.getByRole("dialog").getByRole("button", { name: "Upload" }).click();
  await expect(page.getByRole("dialog").getByText("This file is not a valid .pdf file").first()).toBeVisible();
  await page.keyboard.press("Escape");

  // Everything persists across a reload.
  await page.goto("/profile?tab=personal");
  await expect(page.getByLabel("First name")).toHaveValue("Ada");
  await page.getByRole("tab", { name: "Professional" }).click();
  await expect(page.getByText("Prospecting")).toBeVisible();
  await expect(page.getByText("Salesforce")).toBeVisible();
  await expect(page.getByText(/Profile \d+% complete/)).toBeVisible();
});
