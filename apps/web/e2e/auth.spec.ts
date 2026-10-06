import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("redirects anonymous visitors to sign-in and back after signing in", async ({ page }) => {
  await page.goto("/jobs");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fjobs/);

  const { email, password } = await signUp(page);
  await page.getByRole("button", { name: /E2E Tester/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  await page.goto("/applications");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  // The typed email survives a failed attempt.
  await expect(page.getByLabel("Email")).toHaveValue(email);

  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/applications/);
});

test("validates sign-up input", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill("X");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Enter a valid email address")).toBeVisible();
  await expect(page.getByText("Use at least 10 characters")).toBeVisible();
});

test("rejects a forged session cookie", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "autoapply_session", value: "forged-token-value-that-is-long-enough", url: baseURL! }]);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
});
