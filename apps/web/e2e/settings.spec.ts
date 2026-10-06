import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("answer library suggests only profile facts and saves answers", async ({ page }) => {
  await signUp(page);
  await page.goto("/profile");
  await page.getByLabel("LinkedIn").fill("https://www.linkedin.com/in/tester");
  await page.getByRole("button", { name: "Save personal details" }).click();
  await expect(page.getByText("Personal details saved")).toBeVisible();

  await page.goto("/answers");
  const linkedin = page.getByRole("listitem").filter({ hasText: "LinkedIn profile URL" });
  await expect(linkedin.getByText("From your profile: https://www.linkedin.com/in/tester")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "What are your salary expectations?" }).getByText("Needs your answer")).toBeVisible();

  await linkedin.getByRole("button", { name: "Review & save" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save answer" }).click();
  await expect(page.getByText("Answer saved")).toBeVisible();
  await expect(page.getByRole("table").getByText("Profile", { exact: true })).toBeVisible();
});

test("rules require weights that total 100%", async ({ page }) => {
  await signUp(page);
  await page.goto("/rules");
  await expect(page.getByText(/^Total 100%/)).toBeVisible();
  await page.getByRole("spinbutton", { name: "Skills" }).fill("30");
  await expect(page.getByText(/Total 105%/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save rules" })).toBeDisabled();
  await page.getByRole("spinbutton", { name: "Skills" }).fill("25");
  await page.getByLabel("Minimum match score").fill("75");
  await page.getByRole("button", { name: "Save rules" }).click();
  await expect(page.getByText("Rules saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Minimum match score")).toHaveValue("75");
});

test("settings show sessions and the security log", async ({ page }) => {
  await signUp(page);
  await page.goto("/settings");
  await expect(page.getByText("This device")).toBeVisible();
  await expect(page.getByText("auth.sign_up")).toBeVisible();
  await page.getByLabel("Current password").fill("wrong-password-9");
  await page.getByLabel("New password", { exact: true }).fill("new-password-123");
  await page.getByLabel("Confirm new password").fill("new-password-123");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Current password is incorrect").first()).toBeVisible();
});
