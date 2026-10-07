import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("Automation health starts empty and switches periods", async ({ page }) => {
  await signUp(page);
  await page.getByRole("link", { name: "Automation health" }).click();
  await expect(page).toHaveURL(/\/automation/);
  await expect(page.getByRole("heading", { name: "Automation health" })).toBeVisible();
  await expect(page.getByText("No runs in the last 30 days")).toBeVisible();
  await expect(page.getByText("Nothing is waiting to retry.")).toBeVisible();
  await page.getByRole("link", { name: "7 days" }).click();
  await expect(page).toHaveURL(/days=7/);
  await expect(page.getByText("No runs in the last 7 days")).toBeVisible();
  await expect(page.getByRole("link", { name: "7 days" })).toHaveAttribute("aria-current", "page");
});

test("Pages carry a nonce-based Content Security Policy and the health check reports dependencies", async ({ page, request }) => {
  const response = await page.goto("/sign-in");
  const csp = response!.headers()["content-security-policy"];
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  // The page still works under the policy.
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  const body = (await health.json()) as { status: string; checks: Record<string, string> };
  expect(body.checks.database).toBe("ok");
  expect(["ok", "degraded"]).toContain(body.status);
});
