import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSavedSearch, getSavedSearch, prisma, updateSavedSearch } from "@autoapply/database";
import type { HttpFetcher } from "@autoapply/ingestion";
import { localDateHour, MemoryEmailSender, runDueJobAlerts, runSavedSearch } from "../src";
import { makeUser, resetDatabase } from "./helpers";

const GREENHOUSE = "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true";
const LEVER = "https://api.lever.co/v0/postings/globex?mode=json";

/** A fake set of boards whose postings the test can change between runs. */
function boards() {
  const state = {
    greenhouse: [{ id: 1, title: "Account Executive", company_name: "Acme", location: { name: "New York, NY" }, content: "Sell.", first_published: "2026-10-01T00:00:00Z" }] as Array<Record<string, unknown>>,
    lever: [] as Array<Record<string, unknown>>,
    leverDown: false,
  };
  const http = vi.fn<HttpFetcher>(async (url) => {
    if (url === GREENHOUSE) return { url, status: 200, contentType: "application/json", text: JSON.stringify({ jobs: state.greenhouse }) };
    if (url === LEVER && !state.leverDown) return { url, status: 200, contentType: "application/json", text: JSON.stringify(state.lever) };
    throw new Error("The posting was not found (it may have closed)");
  });
  return { state, http };
}

const search = { name: "AE roles", boards: ["https://boards.greenhouse.io/acme", "https://jobs.lever.co/globex"], query: '"account executive"', location: null, searchDescriptions: false, matchAny: false, alertsEnabled: true };

// 13:00 UTC is 9 AM in New York, after the default 8 AM alert hour.
const MORNING = new Date("2026-10-06T13:00:00Z");
const nextDay = (d: Date, hours = 24) => new Date(d.getTime() + hours * 3600_000);

describe("saved search runs", () => {
  beforeEach(resetDatabase);

  it("treats the first run as the baseline and reports only postings that appear later", async () => {
    const user = await makeUser();
    const saved = await createSavedSearch(user.id, search);
    const { state, http } = boards();

    const first = await runSavedSearch(saved, { http });
    expect(first).toMatchObject({ baseline: true, totalMatches: 1, newMatches: [], error: null });

    state.lever.push({ id: "aaaa", text: "Senior Account Executive", categories: { location: "Remote" }, hostedUrl: "https://jobs.lever.co/globex/aaaa", createdAt: Date.parse("2026-10-05T00:00:00Z") });
    state.greenhouse.push({ id: 2, title: "Software Engineer", company_name: "Acme" });
    const second = await runSavedSearch((await getSavedSearch(user.id, saved.id))!, { http });
    expect(second.baseline).toBe(false);
    expect(second.newMatches.map((m) => m.title)).toEqual(["Senior Account Executive"]);

    const third = await runSavedSearch((await getSavedSearch(user.id, saved.id))!, { http });
    expect(third.newMatches).toEqual([]);
  });

  it("never reports a posting the user already has in their jobs", async () => {
    const user = await makeUser();
    const saved = await createSavedSearch(user.id, search);
    const { state, http } = boards();
    await runSavedSearch(saved, { http });
    state.greenhouse.push({ id: 5, title: "Account Executive II", company_name: "Acme" });
    await prisma.job.create({ data: { userId: user.id, sourceType: "JOB_BOARD", url: "https://boards.greenhouse.io/acme/jobs/5", canonicalUrl: "https://boards.greenhouse.io/acme/jobs/5", title: "Account Executive II", company: "Acme" } });
    expect((await runSavedSearch((await getSavedSearch(user.id, saved.id))!, { http })).newMatches).toEqual([]);
  });

  it("keeps working when one board is down and records the problem", async () => {
    const user = await makeUser();
    const saved = await createSavedSearch(user.id, search);
    const { state, http } = boards();
    state.leverDown = true;
    const run = await runSavedSearch(saved, { http });
    expect(run.totalMatches).toBe(1);
    expect((await getSavedSearch(user.id, saved.id))!.lastError).toMatch(/1 of 2 boards couldn't be read: globex/);
  });

  it("starts a new baseline when the search itself changes", async () => {
    const user = await makeUser();
    const saved = await createSavedSearch(user.id, search);
    const { http } = boards();
    await runSavedSearch(saved, { http });
    const renamed = await updateSavedSearch(user.id, saved.id, { ...search, name: "Renamed" });
    expect(renamed!.lastRunAt).not.toBeNull();
    const changed = await updateSavedSearch(user.id, saved.id, { ...search, query: "account" });
    expect(changed!.lastRunAt).toBeNull();
    expect(await prisma.savedSearchMatch.count({ where: { savedSearchId: saved.id } })).toBe(0);
  });
});

describe("daily job alerts", () => {
  beforeEach(resetDatabase);

  it("emails new matches once a day after the chosen hour, and stays quiet when nothing is new", async () => {
    const user = await makeUser("Sam Rivera");
    const saved = await createSavedSearch(user.id, search);
    const { state, http } = boards();
    await runSavedSearch(saved, { http, now: new Date("2026-10-05T20:00:00Z") }); // baseline when the search was saved
    const sender = new MemoryEmailSender();

    // 7 AM in New York: too early.
    expect((await runDueJobAlerts({ sender, http, now: new Date("2026-10-06T11:00:00Z") })).usersRun).toBe(0);

    state.lever.push({ id: "bbbb", text: "Account Executive, Mid-Market", categories: { location: "Remote - US" }, hostedUrl: "https://jobs.lever.co/globex/bbbb", salaryRange: { min: 90000, max: 110000, currency: "USD", interval: "per-year-salary" } });
    expect(await runDueJobAlerts({ sender, http, now: MORNING })).toEqual({ usersRun: 1, emailsSent: 1, failed: 0, skipped: 0 });
    const email = sender.sent[0]!;
    expect(email.subject).toBe('1 new job for "AE roles"');
    expect(email.text).toContain("Hi Sam,");
    expect(email.text).toContain("Account Executive, Mid-Market, Globex · Remote - US");
    expect(email.text).toContain("https://jobs.lever.co/globex/bbbb");
    expect(email.html).toContain("https://app.example.com/job-alerts");

    // Same day again: already ran.
    expect((await runDueJobAlerts({ sender, http, now: nextDay(MORNING, 3) })).usersRun).toBe(0);
    // Next morning with nothing new: runs, sends nothing.
    expect(await runDueJobAlerts({ sender, http, now: nextDay(MORNING) })).toEqual({ usersRun: 1, emailsSent: 0, failed: 0, skipped: 0 });
    expect(sender.sent).toHaveLength(1);
    expect(await prisma.notification.count({ where: { userId: user.id, kind: "JOB_ALERT", status: "SENT" } })).toBe(1);
  });

  it("skips users who turned job alerts off or paused every search", async () => {
    const off = await makeUser();
    await createSavedSearch(off.id, search);
    await prisma.userSetting.upsert({ where: { userId: off.id }, update: { jobAlertEmails: false }, create: { userId: off.id, jobAlertEmails: false } });
    const paused = await makeUser();
    await createSavedSearch(paused.id, { ...search, alertsEnabled: false });
    const { http } = boards();
    expect((await runDueJobAlerts({ sender: new MemoryEmailSender(), http, now: MORNING })).usersRun).toBe(0);
    expect(http).not.toHaveBeenCalled();
  });

  it("uses the user's time zone and hour", () => {
    expect(localDateHour(new Date("2026-10-06T03:30:00Z"), "America/New_York")).toEqual({ date: "2026-10-05", hour: 23 });
    expect(localDateHour(new Date("2026-10-06T03:30:00Z"), "Asia/Tokyo")).toEqual({ date: "2026-10-06", hour: 12 });
    expect(localDateHour(new Date("2026-10-06T03:30:00Z"), "Not/AZone")).toEqual({ date: "2026-10-06", hour: 3 });
  });
});
