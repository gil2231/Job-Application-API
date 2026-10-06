import { expect, type Page } from "@playwright/test";

export async function signUp(page: Page, name = "E2E Tester") {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/profile/);
  return { email, password: "e2e-password-123" };
}

export async function addJob(page: Page, job: { url: string; title: string; company: string; salary?: string }) {
  await page.goto("/jobs");
  await page.getByRole("button", { name: "Add job" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Job URL").fill(job.url);
  await dialog.getByLabel("Job title").fill(job.title);
  await dialog.getByLabel("Company").fill(job.company);
  if (job.salary) await dialog.getByLabel("Salary").fill(job.salary);
  await dialog.getByRole("button", { name: "Add job" }).click();
}
