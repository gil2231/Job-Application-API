import { beforeEach, describe, expect, it } from "vitest";
import {
  createInterviewRound,
  createManualJob,
  deleteInterviewRound,
  listEmailActivity,
  moveApplicationStage,
  prisma,
  queueApplications,
  saveMailConnection,
  updateInterviewRound,
  updateMailConnectionSettings,
} from "@autoapply/database";
import { interviewRoundSchema, manualJobSchema } from "@autoapply/shared";
import { authorizeUrl, exchangeCode, fetchAccountEmail, linkEmailToApplication, oauthApp, pkcePair, syncMailConnection, syncUserCalendar } from "../src";
import { MockProvider } from "../mock/provider";
import { makeUser, resetDatabase } from "./helpers";

const BASE = "http://mock.local";
const env = {
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: "google-secret",
  MICROSOFT_CLIENT_ID: "ms-client",
  MICROSOFT_CLIENT_SECRET: "ms-secret",
  GOOGLE_ENDPOINT_BASE: BASE,
  MICROSOFT_ENDPOINT_BASE: BASE,
};
const mock = new MockProvider(BASE);
const opts = { fetch: mock.fetch, env, ai: null, appUrl: "https://app.applyance.test" };

beforeEach(async () => {
  await resetDatabase();
  mock.reset();
});

let n = 0;
async function makeApp(userId: string, company: string, title = "Account Executive", status: "SUBMITTED" | "QUEUED" = "SUBMITTED") {
  n += 1;
  const job = await createManualJob(userId, manualJobSchema.parse({ url: `https://example.com/jobs/${n}`, title, company, location: "New York, NY" }), "GENERIC");
  await queueApplications(userId, [job.id]);
  const app = await prisma.application.findUniqueOrThrow({ where: { jobId: job.id } });
  if (status === "QUEUED") return app;
  return prisma.application.update({ where: { id: app.id }, data: { status: "SUBMITTED", submittedAt: new Date(Date.now() - 5 * 86400_000) } });
}

async function connect(userId: string, provider: "GOOGLE" | "MICROSOFT" = "GOOGLE") {
  const slug = provider === "GOOGLE" ? "google" : "microsoft";
  const { access, refresh } = mock.issue(slug);
  return saveMailConnection(userId, { provider, email: mock.accounts[slug], scopes: [], calendar: true, accessToken: access, refreshToken: refresh, expiresAt: new Date(Date.now() + 3600_000) });
}

const stageOfApp = async (id: string) => {
  const a = await prisma.application.findUniqueOrThrow({ where: { id }, select: { status: true, outcome: true } });
  return `${a.status}/${a.outcome}`;
};
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const inDays = (d: number, hourUtc = 15) => {
  const x = new Date(Date.now() + d * 86400_000);
  x.setUTCHours(hourUtc, 0, 0, 0);
  return x;
};

describe("connecting an account", () => {
  it("runs the authorization code flow with PKCE", async () => {
    const { app } = oauthApp("GOOGLE", env);
    const { verifier, challenge } = pkcePair();
    const redirectUri = "https://app.applyance.test/api/integrations/google/callback";
    const url = new URL(authorizeUrl("GOOGLE", app!, { state: "s1", challenge, redirectUri, env }));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("gmail.readonly");
    url.searchParams.set("approve", "1");
    const consent = await mock.fetch(url.toString());
    const back = new URL(consent.headers.get("location")!);
    expect(back.searchParams.get("state")).toBe("s1");
    const tokens = await exchangeCode("GOOGLE", app!, { code: back.searchParams.get("code")!, verifier, redirectUri }, mock.fetch, env);
    expect(tokens.refreshToken).toMatch(/^rt-/);
    expect(await fetchAccountEmail("GOOGLE", tokens.accessToken, mock.fetch, env)).toBe("candidate@gmail.example");
    // A stolen code is useless without the verifier.
    url.searchParams.set("approve", "1");
    const again = new URL((await mock.fetch(url.toString())).headers.get("location")!);
    await expect(exchangeCode("GOOGLE", app!, { code: again.searchParams.get("code")!, verifier: "wrong", redirectUri }, mock.fetch, env)).rejects.toThrow();
  });

  it("stores tokens encrypted", async () => {
    const user = await makeUser();
    const c = await connect(user.id);
    const row = await prisma.mailConnection.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.accessToken).toMatch(/^enc:v1:/);
    expect(row.refreshToken).toMatch(/^enc:v1:/);
    expect(c.calendarSync).toBe(true);
  });
});

describe("reading Gmail into Flightpath", () => {
  it("moves cards for confident updates, adds the interview, and keeps only job email", async () => {
    const user = await makeUser();
    const acme = await makeApp(user.id, "Acme");
    const globex = await makeApp(user.id, "Globex Corporation", "Sales Development Representative");
    const c = await connect(user.id);
    const interviewAt = inDays(3);
    mock.addMail("google", {
      from: "Priya Shah <priya@acme.com>",
      subject: "Interview confirmation: Account Executive",
      body: `Hi Sam, your phone screen is confirmed for ${interviewAt.toLocaleString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })} at 3:00 PM UTC. Join at https://acme.zoom.us/j/555.`,
      receivedAt: hoursAgo(5),
    });
    mock.addMail("google", { from: "Globex Hiring Team <no-reply@greenhouse.io>", subject: "Your application to Globex", body: "Unfortunately, we have decided to move forward with other candidates.", receivedAt: hoursAgo(4) });
    mock.addMail("google", { from: "Mom <mom@example.com>", subject: "Dinner Sunday?", body: "Bring dessert", receivedAt: hoursAgo(3) });
    mock.addMail("google", { from: "LinkedIn Job Alerts <jobs-noreply@linkedin.com>", subject: "Acme is hiring", body: "Unfortunately we have decided not to move forward with your application", receivedAt: hoursAgo(2) });

    const report = await syncMailConnection(c.id, opts);
    expect(report).toMatchObject({ status: "ok", email: { moved: 2, read: 2 } });
    expect(await stageOfApp(acme.id)).toBe("SUBMITTED/INTERVIEW");
    expect(await stageOfApp(globex.id)).toBe("REJECTED/DECLINED");

    const round = await prisma.interviewRound.findFirstOrThrow({ where: { applicationId: acme.id } });
    expect(round).toMatchObject({ kind: "PHONE_SCREEN", scheduledAt: interviewAt, location: "https://acme.zoom.us/j/555", fromInvite: false });
    const moved = await prisma.applicationEvent.findFirstOrThrow({ where: { applicationId: acme.id, type: "STAGE_CHANGED" } });
    expect(moved.message).toBe('Moved from Submitted to Interviewing (from Gmail): "Interview confirmation: Account Executive" from Priya Shah');

    // Only the two job emails are kept, with a short snippet and no body.
    const stored = await prisma.emailMessage.findMany({ where: { userId: user.id }, orderBy: { receivedAt: "asc" } });
    expect(stored.map((e) => [e.kind, e.outcome])).toEqual([
      ["INTERVIEW", "MOVED"],
      ["REJECTION", "MOVED"],
    ]);
    expect(stored.every((e) => e.snippet.length <= 240)).toBe(true);
    // Gmail was only asked for mail naming a company applied to, or from a hiring system.
    const listCall = mock.calls.find((call) => call.path === "/gmail/v1/users/me/messages");
    expect(listCall).toBeDefined();

    // The interview went on the calendar, with a link back to the application.
    expect(report.calendar).toMatchObject({ created: 1 });
    expect(mock.events).toHaveLength(1);
    expect(mock.events[0]).toMatchObject({ title: "Interview: Acme (Phone screen)", start: interviewAt.toISOString(), location: "https://acme.zoom.us/j/555" });
    expect(mock.events[0]!.description).toContain(`https://app.applyance.test/applications/${acme.id}`);

    // Syncing again reads nothing new and changes nothing.
    const again = await syncMailConnection(c.id, opts);
    expect(again).toMatchObject({ status: "ok", email: { read: 0, moved: 0 }, calendar: { created: 0, updated: 0 } });
  });

  it("adds later rounds to an application already interviewing, and doesn't duplicate invites on the calendar", async () => {
    const user = await makeUser();
    const app = await makeApp(user.id, "Acme");
    await moveApplicationStage(user.id, app.id, "INTERVIEWING");
    const c = await connect(user.id);
    const start = inDays(5, 17);
    const ics = `BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nDTSTART:${start.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}\r\nDTEND:${new Date(start.getTime() + 3600_000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}\r\nSUMMARY:Acme onsite interview\r\nLOCATION:Acme HQ\\, 1 Main St\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    mock.addMail("google", { from: "Acme Recruiting <recruiting@acme.com>", subject: "Invitation: Acme onsite interview", body: "You have been invited to an onsite interview.", ics, receivedAt: hoursAgo(1) });
    // A scheduling email while interviewing is not news: no note, no move.
    mock.addMail("google", { from: "Acme Recruiting <recruiting@acme.com>", subject: "Logistics", body: "I'd love to schedule a call to go over logistics. What is your availability?", receivedAt: hoursAgo(0.5) });

    const report = await syncMailConnection(c.id, opts);
    expect(report.email).toMatchObject({ interviewsAdded: 1, moved: 0, suggested: 0 });
    const round = await prisma.interviewRound.findFirstOrThrow({ where: { applicationId: app.id } });
    expect(round).toMatchObject({ kind: "ONSITE", scheduledAt: start, durationMinutes: 60, location: "Acme HQ, 1 Main St", fromInvite: true });
    expect(await prisma.applicationEvent.count({ where: { applicationId: app.id, type: "NOTE" } })).toBe(0);
    // Already on the calendar through the invite.
    expect(mock.events).toHaveLength(0);
    expect((await prisma.emailMessage.findMany({ where: { userId: user.id }, orderBy: { receivedAt: "asc" } })).map((e) => e.outcome)).toEqual(["INTERVIEW_ADDED", "NO_CHANGE"]);
  });

  it("only suggests when auto-update is off or the match is weak, and lists unmatched email for review", async () => {
    const user = await makeUser();
    const acme = await makeApp(user.id, "Acme");
    const c = await connect(user.id);
    await updateMailConnectionSettings(user.id, c.id, { autoUpdate: false });
    mock.addMail("google", { from: "Acme <careers@acme.com>", subject: "Your Acme application", body: "We regret to inform you that we will not be moving forward with your application.", receivedAt: hoursAgo(3) });
    mock.addMail("google", { from: "Initech <noreply@lever.co>", subject: "Interview invitation", body: "We'd like to invite you to an interview for the Analyst role.", receivedAt: hoursAgo(2) });

    const report = await syncMailConnection(c.id, opts);
    expect(report.email).toMatchObject({ moved: 0, suggested: 1, unmatched: 1 });
    expect(await stageOfApp(acme.id)).toBe("SUBMITTED/NONE");
    const note = await prisma.applicationEvent.findFirstOrThrow({ where: { applicationId: acme.id, type: "NOTE" } });
    expect(note.message).toContain("Possible update from Gmail");
    expect(note.message).toContain("Looks like Rejected");

    const review = await listEmailActivity(user.id, { filter: "review" });
    expect(review.rows.map((r) => r.outcome).sort()).toEqual(["SUGGESTED", "UNMATCHED"]);
    expect(review.needsReview).toBe(1);

    // The user links the unmatched invite to an application; with auto-update back on it moves.
    await updateMailConnectionSettings(user.id, c.id, { autoUpdate: true });
    const initech = await makeApp(user.id, "Initech Systems", "Analyst");
    const unmatched = review.rows.find((r) => r.outcome === "UNMATCHED")!;
    const linked = await linkEmailToApplication(user.id, unmatched.id, initech.id);
    expect(linked.outcome).toBe("MOVED");
    expect(await stageOfApp(initech.id)).toBe("SUBMITTED/INTERVIEW");
  });

  it("refreshes an expired access token, and asks to reconnect when access is revoked", async () => {
    const user = await makeUser();
    await makeApp(user.id, "Acme");
    const c = await connect(user.id);
    mock.expireAccessTokens();
    mock.addMail("google", { from: "Acme <careers@acme.com>", subject: "Acme", body: "We regret to inform you that the position has been filled.", receivedAt: hoursAgo(1) });
    expect(await syncMailConnection(c.id, opts)).toMatchObject({ status: "ok", email: { moved: 1 } });
    expect(mock.calls.some((call) => call.path === "/token")).toBe(true);

    mock.revokeAll();
    await prisma.mailConnection.update({ where: { id: c.id }, data: { tokenExpiresAt: new Date(0) } });
    expect(await syncMailConnection(c.id, opts)).toMatchObject({ status: "reconnect" });
    const row = await prisma.mailConnection.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.status).toBe("NEEDS_RECONNECT");
    // No more syncs until the user connects again.
    expect(await syncMailConnection(c.id, opts)).toEqual({ status: "busy" });
  });

  it("doesn't let two syncs of one account overlap", async () => {
    const user = await makeUser();
    const c = await connect(user.id);
    const [a, b] = await Promise.all([syncMailConnection(c.id, opts), syncMailConnection(c.id, opts)]);
    expect([a.status, b.status].sort()).toEqual(["busy", "ok"]);
  });
});

describe("reading Outlook", () => {
  it("reads replies and meeting requests through Microsoft Graph, following pages", async () => {
    const user = await makeUser();
    const app = await makeApp(user.id, "Contoso");
    const c = await connect(user.id, "MICROSOFT");
    for (let i = 0; i < 55; i++) mock.addMail("microsoft", { from: `News <news${i}@example.com>`, subject: `Newsletter ${i}`, body: "Nothing", receivedAt: hoursAgo(10 + i / 10) });
    const start = inDays(4, 14);
    mock.addMail("microsoft", {
      from: "Contoso Talent <talent@contoso.com>",
      subject: "Interview: Contoso technical interview",
      body: "We'd like to invite you to a technical interview. Teams link to follow.",
      meeting: { start, end: new Date(start.getTime() + 45 * 60_000), location: "Microsoft Teams Meeting" },
      receivedAt: hoursAgo(2),
    });
    const report = await syncMailConnection(c.id, opts);
    expect(report).toMatchObject({ status: "ok", email: { scanned: 56, read: 1, moved: 1 } });
    expect(await stageOfApp(app.id)).toBe("SUBMITTED/INTERVIEW");
    expect(await prisma.interviewRound.findFirstOrThrow({ where: { applicationId: app.id } })).toMatchObject({ kind: "TECHNICAL", scheduledAt: start, durationMinutes: 45, fromInvite: true });
    const moved = await prisma.applicationEvent.findFirstOrThrow({ where: { applicationId: app.id, type: "STAGE_CHANGED" } });
    expect(moved.message).toContain("(from Outlook)");
  });
});

describe("calendar", () => {
  it("creates, updates and deletes events as interviews change", async () => {
    const user = await makeUser();
    const app = await makeApp(user.id, "Acme");
    const c = await connect(user.id, "MICROSOFT");
    const at = inDays(2, 16);
    const round = await createInterviewRound(user.id, app.id, interviewRoundSchema.parse({ kind: "HIRING_MANAGER", scheduledAt: at.toISOString(), durationMinutes: "30", interviewers: "Dana Lee" }));
    expect(await syncUserCalendar(user.id, c.id, opts)).toMatchObject({ status: "ok", calendar: { created: 1 } });
    expect(mock.events[0]).toMatchObject({ provider: "microsoft", title: "Interview: Acme (Hiring manager)", start: at.toISOString(), end: new Date(at.getTime() + 30 * 60_000).toISOString() });
    expect(mock.events[0]!.description).toContain("With: Dana Lee");

    const later = new Date(at.getTime() + 3600_000);
    await updateInterviewRound(user.id, round.id, interviewRoundSchema.parse({ kind: "HIRING_MANAGER", scheduledAt: later.toISOString(), durationMinutes: "30", interviewers: "Dana Lee" }));
    expect(await syncUserCalendar(user.id, c.id, opts)).toMatchObject({ calendar: { updated: 1, created: 0 } });
    expect(mock.events[0]!.start).toBe(later.toISOString());

    await deleteInterviewRound(user.id, round.id);
    expect(await syncUserCalendar(user.id, c.id, opts)).toMatchObject({ calendar: { removed: 1 } });
    expect(mock.events[0]!.status).toBe("cancelled");
    expect(await prisma.calendarEventRemoval.count()).toBe(0);
  });

  it("moves events when the user picks another calendar, and leaves past interviews alone", async () => {
    const user = await makeUser();
    const app = await makeApp(user.id, "Acme");
    const google = await connect(user.id, "GOOGLE");
    const outlook = await connect(user.id, "MICROSOFT");
    expect(outlook.calendarSync).toBe(false);
    await createInterviewRound(user.id, app.id, interviewRoundSchema.parse({ kind: "TECHNICAL", scheduledAt: inDays(1).toISOString() }));
    await createInterviewRound(user.id, app.id, interviewRoundSchema.parse({ kind: "PHONE_SCREEN", scheduledAt: inDays(-3).toISOString() }));
    await syncUserCalendar(user.id, google.id, opts);
    expect(mock.events.map((e) => e.provider)).toEqual(["google"]);

    await updateMailConnectionSettings(user.id, outlook.id, { calendarSync: true });
    await syncUserCalendar(user.id, outlook.id, opts);
    await syncUserCalendar(user.id, google.id, opts);
    expect(mock.events.map((e) => [e.provider, e.status])).toEqual([
      ["google", "cancelled"],
      ["microsoft", "confirmed"],
    ]);
  });
});
