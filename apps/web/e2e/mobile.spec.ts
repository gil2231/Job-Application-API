import { expect, test } from "@playwright/test";
import { prisma, setUserRole } from "@autoapply/database";
import { addJob, signUp } from "./helpers";

test.afterAll(() => prisma.$disconnect());

test("anyone can fetch what installing the app needs", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  const body = await manifest.json();
  expect(body).toMatchObject({ name: "Applyance", display: "standalone" });
  for (const icon of body.icons as Array<{ src: string }>) expect((await request.get(icon.src)).ok()).toBe(true);
  for (const path of ["/sw.js", "/offline.html", "/apple-icon.png"]) expect((await request.get(path, { maxRedirects: 0 })).status()).toBe(200);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the tab bar reaches Needs Attention, and pages fit the screen", async ({ page }) => {
    const { email } = await signUp(page);
    await addJob(page, { url: "https://example.com/jobs/phone", title: "Account Executive", company: "Pocket Co" });
    await expect(page.getByText("Added Account Executive")).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all" }).check();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByText(/Queued 1 application/)).toBeVisible();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.application.updateMany({ where: { userId: user.id }, data: { status: "WAITING_FOR_USER", attentionReason: "CAPTCHA" } });

    await page.goto("/dashboard");
    const tabs = page.getByRole("navigation", { name: "Main" });
    await expect(tabs.getByRole("link", { name: /Needs you/ })).toContainText("1");
    await tabs.getByRole("link", { name: /Needs you/ }).click();
    await expect(page).toHaveURL(/\/needs-attention/);
    await expect(page.getByRole("button", { name: "I've completed it" })).toBeVisible();

    const app = await prisma.application.findFirstOrThrow({ where: { userId: user.id } });
    const pages = ["/dashboard", "/tasks", "/needs-attention", "/flightpath", "/flightpath?view=table", "/recommended", "/jobs", `/jobs/${app.jobId}`, "/applications", `/applications/${app.id}`];
    pages.push("/profile", "/documents", "/answers", "/rules", "/integrations", "/settings");
    await setUserRole(email, "ADMIN");
    pages.push("/admin", "/admin/users", `/admin/users/${user.id}`, "/admin/failures");
    for (const path of pages) {
      await page.goto(path);
      const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - 390;
      expect(overflow, `${path} is wider than the screen`).toBeLessThanOrEqual(0);
    }

    await tabs.getByRole("button", { name: "More" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Answer Library" }).click();
    await expect(page).toHaveURL(/\/answers/);
  });
});
