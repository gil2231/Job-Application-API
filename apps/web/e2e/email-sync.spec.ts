import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@autoapply/database";
import { addJob, signUp } from "./helpers";

test.afterAll(() => prisma.$disconnect());

const MOCK = `http://127.0.0.1:${process.env.MOCK_PROVIDER_PORT ?? "4120"}`;

async function sendMail(provider: "google" | "microsoft", mail: { from: string; subject: string; body: string; receivedAt?: string }) {
  const res = await fetch(`${MOCK}/__mock/mail`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, ...mail }) });
  expect(res.ok).toBe(true);
}

/** Two sent applications at companies unique to this run, so parallel tests can share the mock mailbox. */
async function seed(page: Page) {
  const { email } = await signUp(page);
  const tag = Math.random().toString(36).slice(2, 7);
  const companies = { acme: `Zephyrine ${tag}`, globex: `Quillmont ${tag}` };
  await addJob(page, { url: `https://example.com/jobs/${tag}-1`, title: "Account Executive", company: companies.acme });
  await expect(page.getByText("Added Account Executive")).toBeVisible();
  await addJob(page, { url: `https://example.com/jobs/${tag}-2`, title: "Sales Manager", company: companies.globex });
  await expect(page.getByText("Added Sales Manager")).toBeVisible();
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const jobs = await prisma.job.findMany({ where: { userId: user.id } });
  const apps: Record<string, string> = {};
  for (const job of jobs) {
    const app = await prisma.application.create({ data: { userId: user.id, jobId: job.id, status: "SUBMITTED", submittedAt: new Date(Date.now() - 3 * 86400_000) } });
    apps[job.company] = app.id;
  }
  return { user, companies, apps, tag };
}

test("connects Gmail, moves Flightpath cards from replies, puts the interview on the calendar, and matches an unplaced email", async ({ page }) => {
  const { companies, apps, tag } = await seed(page);
  const interviewAt = new Date(Date.now() + 4 * 86400_000);
  interviewAt.setUTCHours(17, 0, 0, 0);
  const when = interviewAt.toLocaleString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  await sendMail("google", {
    from: `Dana Lee <dana@${companies.acme.split(" ")[0]!.toLowerCase()}.com>`,
    subject: `Interview confirmation: ${companies.acme} Account Executive`,
    body: `Hi! Your phone screen with ${companies.acme} is confirmed for ${when} at 5:00 PM UTC. It's a 30-minute call. Join: https://zoom.us/j/98765`,
  });
  await sendMail("google", { from: `${companies.globex} Hiring <no-reply@greenhouse.io>`, subject: "Your application", body: "Unfortunately, we have decided to move forward with other candidates." });
  await sendMail("google", { from: `Recruiting <no-reply@lever.co>`, subject: `Next steps ${tag}`, body: "We'd like to invite you to an interview for the role you applied to." });

  await page.goto("/integrations");
  const gmail = page.getByTestId("mail-google");
  await expect(gmail.getByText("Not connected.")).toBeVisible();
  await gmail.getByRole("link", { name: "Connect" }).click();
  // The provider's consent screen (mock).
  await expect(page.getByText("Applyance wants to read your email")).toBeVisible();
  await page.locator("#allow").click();
  await expect(page).toHaveURL(/\/integrations$/);
  await expect(page.getByText("Google account connected")).toBeVisible();
  await expect(gmail.getByText("candidate@gmail.example")).toBeVisible();
  await expect(gmail.getByRole("switch", { name: /Add interviews to Google Calendar/ })).toBeChecked();

  // The first sync starts on its own after connecting; Sync now waits for it or runs again.
  await expect(async () => {
    await page.reload();
    const app = await prisma.application.findUniqueOrThrow({ where: { id: apps[companies.acme]! } });
    expect(app.outcome).toBe("INTERVIEW");
  }).toPass({ timeout: 20_000 });
  await gmail.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText(/^Synced/)).toBeVisible();
  expect((await prisma.application.findUniqueOrThrow({ where: { id: apps[companies.globex]! } })).outcome).toBe("DECLINED");

  // Flightpath shows both moves.
  await page.goto("/flightpath");
  await expect(page.getByRole("listitem", { name: /^Interviewing, \d+$/ }).getByText(companies.acme)).toBeVisible();
  await expect(page.getByRole("listitem", { name: /^Rejected, \d+$/ }).getByText(companies.globex)).toBeVisible();
  // The unplaced email (the mock mailbox is shared, so others' may be listed too).
  await expect(page.getByTestId("email-activity-link")).toHaveText(/\d+ emails? to match/);

  // The application has the round, its timeline says where the move came from, and the round is on the calendar.
  await page.goto(`/applications/${apps[companies.acme]}`);
  const round = page.getByTestId("interview-round");
  await expect(round.getByText("Phone screen")).toBeVisible();
  await expect(round.getByText("30 min")).toBeVisible();
  await expect(round.getByTestId("calendar-note")).toHaveText("On your calendar");
  await expect(page.getByText(/Moved from Submitted to Interviewing \(from Gmail\)/)).toBeVisible();
  const events = (await (await fetch(`${MOCK}/__mock/events`)).json()) as Array<{ title: string; start: string; status: string }>;
  expect(events.find((e) => e.title === `Interview: ${companies.acme} (Phone screen)`)).toMatchObject({ start: interviewAt.toISOString(), status: "confirmed" });

  // Match the email Applyance couldn't place.
  await page.goto("/integrations/email?filter=review");
  const row = page.getByTestId("email-row").filter({ hasText: `Next steps ${tag}` });
  await expect(row.getByTestId("email-outcome")).toHaveText("Couldn't tell which application this is about");
  await row.getByRole("combobox", { name: "Application this email is about" }).click();
  await page.getByRole("option", { name: `${companies.globex} · Sales Manager` }).click();
  await row.getByRole("button", { name: "Match" }).click();
  await expect(page.getByText("Linked. It's on the application's timeline to check.")).toBeVisible();
});

test("asks to connect again when access is revoked", async ({ page }) => {
  const { user: me } = await seed(page);
  await page.goto("/integrations");
  const outlook = page.getByTestId("mail-microsoft");
  await outlook.getByRole("link", { name: "Connect" }).click();
  await page.locator("#allow").click();
  await expect(outlook.getByText("candidate@outlook.example")).toBeVisible();
  const connection = await prisma.mailConnection.findFirstOrThrow({ where: { userId: me.id, provider: "MICROSOFT" } });
  // Expire the saved token and make the refresh token invalid, as when the user removes access in their Microsoft account.
  await prisma.mailConnection.update({ where: { id: connection.id }, data: { tokenExpiresAt: new Date(0), refreshToken: null } });
  await outlook.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText("The sign-in for this account has expired. Connect it again.").first()).toBeVisible();
  await page.reload();
  await expect(outlook.getByText("Reconnect needed")).toBeVisible();
  await expect(outlook.getByRole("link", { name: "Connect again" })).toBeVisible();
});
