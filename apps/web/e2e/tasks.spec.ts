import { expect, test } from "@playwright/test";
import { prisma } from "@autoapply/database";
import { addJob, signUp } from "./helpers";

test.afterAll(() => prisma.$disconnect());

test("Tasks: Start, Pause and the live task list drive the existing queue", async ({ page }) => {
  const { email } = await signUp(page);

  await page.goto("/tasks");
  const deck = page.getByTestId("control-deck");
  await expect(deck).toHaveAttribute("data-state", "empty");
  await expect(page.getByTestId("start-button")).toBeDisabled();
  await expect(page.getByText("No tasks yet")).toBeVisible();

  // A qualified job is waiting, so Start adds it (in Review mode) and runs.
  await addJob(page, { url: "https://example.com/jobs/tasks-1", title: "Solutions Engineer", company: "Bolt Labs" });
  await expect(page.getByText("Added Solutions Engineer")).toBeVisible();
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  await prisma.job.updateMany({ where: { userId: user.id }, data: { status: "QUALIFIED" } });

  await page.goto("/tasks");
  await expect(deck).toHaveAttribute("data-state", "idle");
  await page.getByTestId("start-button").click();
  await expect(page.getByText("Started. 1 qualified job added in review mode.")).toBeVisible();
  await expect(deck).toHaveAttribute("data-state", "running");
  const table = page.getByTestId("task-table");
  await expect(table.getByText("Solutions Engineer")).toBeVisible();
  await expect(table.getByText("#1 in line")).toBeVisible();
  const app = await prisma.application.findFirstOrThrow({ where: { userId: user.id } });
  expect(app).toMatchObject({ status: "QUEUED", mode: "REVIEW" });

  // The big button pauses a running queue, and Start resumes it.
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByText("Queue paused. No new applications will start.")).toBeVisible();
  await expect(deck).toHaveAttribute("data-state", "paused");
  expect(await prisma.userSetting.findUniqueOrThrow({ where: { userId: user.id } })).toMatchObject({ queuePaused: true });
  await expect(page.getByRole("navigation").getByText("Paused")).toBeVisible();

  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText("Started. Running 1 task.")).toBeVisible();
  await expect(deck).toHaveAttribute("data-state", "running");
  expect(await prisma.userSetting.findUniqueOrThrow({ where: { userId: user.id } })).toMatchObject({ queuePaused: false });

  // A task that stops for the person shows under Needs you with a Finish link.
  await prisma.application.update({ where: { id: app.id }, data: { status: "WAITING_FOR_USER", attentionReason: "CAPTCHA" } });
  await page.reload();
  await page.getByRole("tab", { name: /Needs you/ }).click();
  await expect(table.getByText("CAPTCHA")).toBeVisible();
  await expect(table.getByRole("link", { name: /Open Solutions Engineer/ })).toHaveAttribute("href", "/needs-attention");
  await expect(page.getByTestId("activity-log")).toContainText("Bolt Labs");
});
