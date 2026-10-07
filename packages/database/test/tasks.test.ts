import { beforeEach, describe, expect, it } from "vitest";
import { manualJobSchema } from "@autoapply/shared";
import { prisma } from "../src/client";
import { createManualJob } from "../src/repositories/jobs";
import { queueApplications } from "../src/repositories/applications";
import { getUserSettings, setQueueState } from "../src/repositories/settings";
import { getTaskBoard } from "../src/repositories/tasks";
import { makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

let n = 0;
async function job(userId: string, status: "IMPORTED" | "QUALIFIED" = "IMPORTED") {
  n += 1;
  const created = await createManualJob(userId, manualJobSchema.parse({ url: `https://example.com/tasks/${n}`, title: `Role ${n}`, company: `Co ${n}` }), "GENERIC");
  if (status !== "IMPORTED") await prisma.job.update({ where: { id: created.id }, data: { status } });
  return created;
}

describe("getTaskBoard", () => {
  it("orders running, waiting, queued (in claim order), then finished, and counts each", async () => {
    const user = await makeUser();
    await getUserSettings(user.id);
    const jobs = await Promise.all([job(user.id), job(user.id), job(user.id), job(user.id), job(user.id)]);
    await queueApplications(user.id, jobs.map((j) => j.id));
    const apps = await prisma.application.findMany({ where: { userId: user.id }, orderBy: { queuedAt: "asc" } });
    const [a, b, c, d, e] = apps;
    await prisma.application.update({ where: { id: a!.id }, data: { status: "SUBMITTED", submittedAt: new Date() } });
    await prisma.application.update({ where: { id: b!.id }, data: { status: "WAITING_FOR_USER", attentionReason: "CAPTCHA" } });
    await prisma.application.update({ where: { id: c!.id }, data: { status: "PROCESSING" } });
    // A higher priority task runs before an older one.
    await prisma.application.update({ where: { id: e!.id }, data: { priority: 5 } });

    const board = await getTaskBoard(user.id);
    expect(board.tasks.map((t) => t.id)).toEqual([c!.id, b!.id, e!.id, d!.id, a!.id]);
    expect(board.counts).toEqual({ running: 1, queued: 2, needsYou: 1, submitted: 1, failed: 0 });
    expect(board.events.length).toBeGreaterThan(0);
  });

  it("drops finished tasks after a day and leaves out other users' tasks", async () => {
    const user = await makeUser();
    const other = await makeUser("Other");
    const mine = await job(user.id);
    const theirs = await job(other.id);
    await queueApplications(user.id, [mine.id]);
    await queueApplications(other.id, [theirs.id]);
    await prisma.application.updateMany({ where: { userId: user.id }, data: { status: "SUBMITTED" } });
    const tomorrow = new Date(Date.now() + 25 * 3600 * 1000);
    expect((await getTaskBoard(user.id)).tasks).toHaveLength(1);
    const later = await getTaskBoard(user.id, tomorrow);
    expect(later.tasks).toHaveLength(0);
    expect(later.events).toHaveLength(0);
  });

  it("reports the run state, the effective mode and qualified jobs waiting", async () => {
    const user = await makeUser();
    await getUserSettings(user.id);
    await job(user.id, "QUALIFIED");
    await job(user.id, "QUALIFIED");
    // AUTO without auto-submit turned on still runs in Review mode.
    await prisma.automationRule.upsert({ where: { userId: user.id }, update: { defaultMode: "AUTO" }, create: { userId: user.id, matchWeights: {}, defaultMode: "AUTO" } });
    await setQueueState(user.id, "pause");
    const board = await getTaskBoard(user.id);
    expect(board.run).toMatchObject({ paused: true, mode: "REVIEW", autoSubmitEnabled: false });
    expect(board.qualifiedWaiting).toBe(2);
  });
});
