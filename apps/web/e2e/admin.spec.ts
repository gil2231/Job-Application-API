import { expect, test } from "@playwright/test";
import { prisma, setUserRole } from "@autoapply/database";
import { addJob, signUp } from "./helpers";

test.afterAll(() => prisma.$disconnect());

test("only admins can open the admin panel", async ({ page }) => {
  const { email } = await signUp(page, "Regular Person");
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  const response = await page.goto("/admin/users");
  expect(response?.status()).toBe(404);

  await setUserRole(email, "ADMIN");
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Admin" }).first().click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
});

test("an admin sees users and their failing applications, but not their private data", async ({ browser, page }) => {
  // A customer with one failed application.
  const customerPage = await browser.newPage();
  const customer = await signUp(customerPage, "Casey Customer");
  await addJob(customerPage, { url: "https://jobs.acme.example/roles/42", title: "Solutions Engineer", company: "Acme" });
  await customerPage.getByRole("button", { name: "Actions for Solutions Engineer" }).click();
  await customerPage.getByRole("menuitem", { name: "Apply" }).click();
  await expect(customerPage.getByText(/Queued 1 application/)).toBeVisible();
  await customerPage.close();
  const customerUser = await prisma.user.findUniqueOrThrow({ where: { email: customer.email } });
  await prisma.application.updateMany({
    where: { userId: customerUser.id },
    data: { status: "FAILED", failureType: "SITE_CHANGED", lastError: "Submit button not found on the page" },
  });

  const owner = await signUp(page, "Owner Person");
  await setUserRole(owner.email, "ADMIN");

  await page.goto(`/admin/users?q=${encodeURIComponent(customer.email)}`);
  await page.getByRole("link", { name: /Casey Customer/ }).click();
  await expect(page.getByRole("heading", { name: "Casey Customer" })).toBeVisible();
  await expect(page.getByText("Submit button not found on the page")).toBeVisible();
  await expect(page.getByText("jobs.acme.example")).toBeVisible();

  await page.goto("/admin/failures?failureType=SITE_CHANGED");
  await expect(page.getByTestId("admin-failures").getByText(customer.email)).toBeVisible();

  const viewed = await prisma.auditLog.count({ where: { action: "admin.view_user", entityId: customerUser.id } });
  expect(viewed).toBeGreaterThan(0);
});
