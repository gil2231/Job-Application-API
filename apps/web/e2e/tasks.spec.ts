import { expect, test } from "@playwright/test";
import { prisma } from "@autoapply/database";
import { addJob, signUp } from "./helpers";

test.afterAll(() => prisma.$disconnect());

test("Tasks: Start, Pause and the live task list drive the existing queue", async ({ page }) => {
  const { email } = await signUp(page);

  // Preferences no stand-in job fits, so Start's search adds nothing here (the next test covers it).
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  await prisma.masterProfile.upsert({ where: { userId: user.id }, update: { searchPreferences: "Underwater Basket Weaving" }, create: { userId: user.id, searchPreferences: "Underwater Basket Weaving" } });

  await page.goto("/tasks");
  const deck = page.getByTestId("control-deck");
  await expect(deck).toHaveAttribute("data-state", "empty");
  await expect(page.getByTestId("start-button")).toBeEnabled();
  await expect(deck.getByText("Start finds new jobs that fit your preferences")).toBeVisible();
  await expect(page.getByText("No tasks yet")).toBeVisible();

  // A qualified job is waiting, so Start adds it (in Review mode) and runs.
  await addJob(page, { url: "https://example.com/jobs/tasks-1", title: "Solutions Engineer", company: "Bolt Labs" });
  await expect(page.getByText("Added Solutions Engineer")).toBeVisible();
  await prisma.job.updateMany({ where: { userId: user.id }, data: { status: "QUALIFIED" } });

  await page.goto("/tasks");
  await expect(deck).toHaveAttribute("data-state", "idle");
  await page.getByTestId("start-button").click();
  await expect(page.getByText("Started. 1 qualified job added in review mode. Looking for new jobs that fit your preferences too.")).toBeVisible();
  await expect(deck).toHaveAttribute("data-state", "running");
  const table = page.getByTestId("task-table");
  await expect(table.getByText("Solutions Engineer")).toBeVisible();
  await expect(table.getByText("#1 in line")).toBeVisible();
  await expect(page.getByTestId("job-hunt")).toContainText("No new openings fit your preferences right now");
  const app = await prisma.application.findFirstOrThrow({ where: { userId: user.id, job: { title: "Solutions Engineer" } } });
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

  // A task that stops on a CAPTCHA shows under Needs you with a Solve link to the CAPTCHA screen.
  await prisma.application.update({ where: { id: app.id }, data: { status: "WAITING_FOR_USER", attentionReason: "CAPTCHA" } });
  await page.reload();
  await page.getByRole("tab", { name: /Needs you/ }).click();
  await expect(table.getByText("CAPTCHA")).toBeVisible();
  const solve = table.getByRole("link", { name: /Open Solutions Engineer/ });
  await expect(solve).toHaveAttribute("href", "/captcha");
  await expect(solve).toHaveText(/Solve/);
  await expect(page.getByTestId("activity-log")).toContainText("Bolt Labs");
});

test("Tasks: Start on an empty queue finds new jobs that fit the saved preferences and lines up the ones that qualify", async ({ page }) => {
  const { email } = await signUp(page);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  // A new account has no profile to score against yet, so any job with a description qualifies here.
  await prisma.automationRule.updateMany({ where: { userId: user.id }, data: { minMatchScore: 0 } });

  await page.goto("/tasks");
  const deck = page.getByTestId("control-deck");
  await expect(deck).toHaveAttribute("data-state", "empty");
  await page.getByTestId("start-button").click();
  await expect(page.getByText("Looking for new jobs that fit your preferences. The ones that qualify will join the line.")).toBeVisible();

  // The stand-in boards have New York sales roles that fit the default preferences.
  const status = page.getByTestId("job-hunt");
  await expect(status).toContainText(/Found \d+ new jobs\. \d+ fits? and (was|were) added to the line\./, { timeout: 45_000 });
  const jobs = await prisma.job.findMany({ where: { userId: user.id }, select: { title: true, url: true, status: true, application: { select: { status: true, mode: true } } } });
  expect(jobs.map((j) => j.title)).toEqual(expect.arrayContaining(["Business Development Representative"]));
  // Only company application pages, never a LinkedIn or Indeed listing; only qualified jobs are put in line, in Review mode.
  expect(jobs.every((j) => !/linkedin|indeed/.test(j.url))).toBe(true);
  const lined = jobs.filter((j) => j.application);
  expect(lined.length).toBeGreaterThan(0);
  expect(lined.every((j) => j.status === "QUALIFIED" && j.application!.mode === "REVIEW")).toBe(true);
  await expect(deck).toHaveAttribute("data-state", "running");
  await expect(page.getByTestId("task-table").getByText("Business Development Representative")).toBeVisible();

  // Pausing and pressing Start again right away doesn't search again.
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(deck).toHaveAttribute("data-state", "paused");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText(`Started. Running ${lined.length} task`)).toBeVisible();
  expect(await prisma.job.count({ where: { userId: user.id } })).toBe(jobs.length);
});
