import { beforeEach, describe, expect, it } from "vitest";
import { manualJobSchema } from "@autoapply/shared";
import { prisma } from "../src/client";
import { queueApplications } from "../src/repositories/applications";
import { createManualJob } from "../src/repositories/jobs";
import { clearScreenshots, findExpiredScreenshots, purgeExpiredSessionData } from "../src/repositories/retention";
import { getUserSettings } from "../src/repositories/settings";
import { makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

const NOW = new Date("2026-10-06T18:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3600_000);

async function attemptWithShots(userId: string, endedDaysAgo: number, keys: string[]) {
  const job = await createManualJob(userId, manualJobSchema.parse({ url: `https://example.com/jobs/${Math.random()}`, title: "Role", company: "Acme" }), "GENERIC");
  await queueApplications(userId, [job.id]);
  const app = await prisma.application.findUniqueOrThrow({ where: { jobId: job.id } });
  return prisma.applicationAttempt.create({
    data: { applicationId: app.id, attemptNumber: 1, status: "SUCCEEDED", endedAt: daysAgo(endedDaysAgo), screenshots: keys.map((key) => ({ key, caption: "Page", takenAt: daysAgo(endedDaysAgo).toISOString() })) },
  });
}

describe("screenshot retention", () => {
  it("expires screenshots by each person's own setting", async () => {
    const strict = await makeUser();
    const lenient = await makeUser();
    await getUserSettings(strict.id);
    await getUserSettings(lenient.id);
    await prisma.userSetting.update({ where: { userId: strict.id }, data: { screenshotRetentionDays: 7 } });
    await prisma.userSetting.update({ where: { userId: lenient.id }, data: { screenshotRetentionDays: 90 } });
    const old = await attemptWithShots(strict.id, 10, ["a.png", "b.png"]);
    await attemptWithShots(strict.id, 3, ["fresh.png"]);
    await attemptWithShots(lenient.id, 10, ["kept.png"]);

    const expired = await findExpiredScreenshots(NOW);
    expect(expired).toEqual([{ attemptId: old.id, keys: ["a.png", "b.png"] }]);
    expect(await clearScreenshots([old.id])).toBe(1);
    expect(await findExpiredScreenshots(NOW)).toEqual([]);
    expect((await prisma.applicationAttempt.findUniqueOrThrow({ where: { id: old.id } })).screenshots).toBeNull();
  });

  it("uses 30 days when a person has no settings yet", async () => {
    const user = await makeUser();
    await attemptWithShots(user.id, 31, ["x.png"]);
    await attemptWithShots(user.id, 29, ["y.png"]);
    expect((await findExpiredScreenshots(NOW)).flatMap((e) => e.keys)).toEqual(["x.png"]);
  });
});

describe("session cleanup", () => {
  it("deletes expired sign-ins and drops cookies from expired or revoked site sessions", async () => {
    const user = await makeUser();
    await prisma.session.create({ data: { userId: user.id, tokenHash: "old", expiresAt: daysAgo(1) } });
    await prisma.session.create({ data: { userId: user.id, tokenHash: "live", expiresAt: daysAgo(-1) } });
    await prisma.browserSession.create({ data: { userId: user.id, domain: "a.example", storageStateEncrypted: "enc", expiresAt: daysAgo(1) } });
    await prisma.browserSession.create({ data: { userId: user.id, domain: "b.example", storageStateEncrypted: "enc", status: "REVOKED" } });
    await prisma.browserSession.create({ data: { userId: user.id, domain: "c.example", storageStateEncrypted: "enc", expiresAt: daysAgo(-5) } });

    const result = await purgeExpiredSessionData(NOW);
    expect(result.browserSessions).toBe(2);
    expect((await prisma.session.findMany({ where: { tokenHash: { in: ["old", "live"] } } })).map((s) => s.tokenHash)).toEqual(["live"]);
    const sites = await prisma.browserSession.findMany({ orderBy: { domain: "asc" } });
    expect(sites.map((s) => [s.domain, s.status, s.storageStateEncrypted])).toEqual([
      ["a.example", "EXPIRED", null],
      ["b.example", "REVOKED", null],
      ["c.example", "ACTIVE", "enc"],
    ]);
  });
});
