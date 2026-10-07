import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { prisma, totpCode, totpStep } from "@autoapply/database";
import { localStorageRoot } from "@autoapply/documents";
import { signUp } from "./helpers";

const outbox = () => join(localStorageRoot(process.env.STORAGE_LOCAL_DIR ?? ".storage"), "outbox");

/** The newest link in an email the dev mailer saved for this address. */
async function lastEmailLink(to: string, path: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const files = (await readdir(outbox()).catch(() => [] as string[])).filter((f) => f.endsWith(`${to}.json`)).sort();
    for (const file of files.reverse()) {
      const { text } = JSON.parse(await readFile(join(outbox(), file), "utf8")) as { text: string };
      const match = text.match(new RegExp(`https?://[^\\s]+${path}\\?token=[^\\s]+`));
      if (match) return new URL(match[0]).pathname + new URL(match[0]).search;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No ${path} email for ${to}`);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: /E2E Tester/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("landing and pricing pages are public", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Apply to more of the right jobs");
  await expect(page.getByText("Never bypasses CAPTCHAs")).toBeVisible();
  await page.getByRole("link", { name: "Pricing" }).first().click();
  await expect(page).toHaveURL(/\/pricing/);
  await expect(page.getByRole("heading", { name: "Pro" })).toBeVisible();
  await page.getByRole("radio", { name: /Yearly/ }).click();
  await expect(page.getByText("$290")).toBeVisible();
  await page.getByRole("link", { name: "Start free" }).first().click();
  await expect(page).toHaveURL(/\/sign-up/);
});

test("new accounts land on getting started and confirm their email", async ({ page }) => {
  const { email } = await signUp(page);
  await expect(page.getByRole("heading", { name: /Welcome to Applyance/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Import resume" }).first()).toHaveAttribute("href", "/profile/import");
  await expect(page.getByText(/0 of \d done/)).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByText(/Getting started \(0 of/)).toBeVisible();
  await expect(page.getByText(`Confirm your email with the link we sent to ${email}`)).toBeVisible();

  await page.goto(await lastEmailLink(email, "/verify-email"));
  await expect(page.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByText("Confirm your email with the link")).toHaveCount(0);
  // The dashboard keeps a live connection open, so retry the click in case it lands before hydration.
  await expect(async () => {
    await page.getByRole("button", { name: "Hide getting started" }).click({ timeout: 2000 });
    await expect(page.getByText(/Getting started \(/)).toHaveCount(0, { timeout: 3000 });
  }).toPass({ timeout: 20_000 });
});

test("two-factor sign-in: set up, sign in with a code and a recovery code, turn off", async ({ page }) => {
  const { email, password } = await signUp(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Set up two-factor sign-in" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  const secret = (await page.getByTestId("totp-secret").innerText()).replace(/\s+/g, "");
  await page.getByLabel("Code from the app").fill("000000");
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText("That code didn't work. Make sure")).toBeVisible();
  await page.getByLabel("Code from the app").fill(totpCode(secret, totpStep() - 1));
  await page.getByRole("button", { name: "Turn on" }).click();
  const codeItems = page.getByRole("list", { name: "Recovery codes" }).getByRole("listitem");
  await expect(codeItems).toHaveCount(10);
  const codes = await codeItems.allInnerTexts();
  expect(codes).toHaveLength(10);
  await page.getByRole("button", { name: "I've saved them" }).click();
  await expect(page.getByText("10 of 10 recovery codes left")).toBeVisible();

  // Password alone isn't enough any more.
  await signOut(page);
  await signIn(page, email, password);
  await expect(page).toHaveURL(/\/sign-in\/two-factor/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
  await signIn(page, email, password);
  await page.getByLabel("Authentication code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("That code didn't work. Check your")).toBeVisible();
  await page.getByLabel("Authentication code").fill(totpCode(secret, totpStep()));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // A recovery code works once.
  await signOut(page);
  await signIn(page, email, password);
  await page.getByLabel("Authentication code").fill(codes[0]!);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/settings");
  await expect(page.getByText("9 of 10 recovery codes left")).toBeVisible();

  await page.getByRole("button", { name: "Turn off" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Password").fill(password);
  await dialog.getByLabel(/Code from your app/).fill(codes[1]!);
  await dialog.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByRole("button", { name: "Set up two-factor sign-in" })).toBeVisible();
});

test("forgot password sends a single-use reset link", async ({ page }) => {
  const { email } = await signUp(page);
  await signOut(page);
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("If an account uses that email")).toBeVisible();

  const link = await lastEmailLink(email, "/reset-password");
  await page.goto(link);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("New password", { exact: true }).fill("a-brand-new-pass-9");
  await page.getByLabel("Confirm new password").fill("a-brand-new-pass-9");
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByText("Your password was changed")).toBeVisible();
  await signIn(page, email, "a-brand-new-pass-9");
  await expect(page).toHaveURL(/\/dashboard/);

  await signOut(page);
  await page.goto(link);
  await page.getByLabel("New password", { exact: true }).fill("another-pass-10");
  await page.getByLabel("Confirm new password").fill("another-pass-10");
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByText("This reset link has expired or was already used")).toBeVisible();
});

test("billing page without Stripe shows the plan and usage", async ({ page }) => {
  test.skip(!!process.env.STRIPE_SECRET_KEY, "runs against a server without Stripe keys");
  await signUp(page);
  await page.getByRole("link", { name: "Plan & billing" }).first().click();
  await expect(page.getByText("Billing isn't set up on this server")).toBeVisible();
  await expect(page.getByText("0 of 500 this month").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Upgrade to Pro" })).toBeDisabled();
});

test("download all data, then delete the account", async ({ page }) => {
  const { email, password } = await signUp(page);
  await page.goto("/settings");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download my data" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^applyance-export-\d{4}-\d{2}-\d{2}\.zip$/);
  const files = unzipSync(new Uint8Array(await readFile((await download.path())!)));
  const data = JSON.parse(strFromU8(files["data.json"]!)) as { user: { email: string } };
  expect(data.user.email).toBe(email);
  expect(strFromU8(files["data.json"]!)).not.toContain("passwordHash");

  await page.getByRole("button", { name: "Delete account" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Password").fill(password);
  await dialog.getByLabel(/Type "DELETE"/).fill("delete");
  await dialog.getByRole("button", { name: "Delete everything" }).click();
  await expect(dialog.getByText("Type DELETE to confirm")).toBeVisible();
  await dialog.getByLabel(/Type "DELETE"/).fill("DELETE");
  await dialog.getByRole("button", { name: "Delete everything" }).click();
  await expect(page.getByText("Your account and all of its data have been deleted.")).toBeVisible();
  expect(await prisma.user.findUnique({ where: { email } })).toBeNull();

  await signIn(page, email, password);
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
});
