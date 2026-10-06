import { beforeEach, describe, expect, it } from "vitest";
import { interviewRoundSchema, manualJobSchema, trackerFiltersSchema, type StageSignal } from "@autoapply/shared";
import { prisma } from "../src/client";
import { createManualJob } from "../src/repositories/jobs";
import { queueApplications } from "../src/repositories/applications";
import { getChangeFingerprint, getDashboardStats } from "../src/repositories/dashboard";
import { ConflictError, NotFoundError } from "../src/repositories/errors";
import {
  createInterviewRound,
  deleteInterviewRound,
  getStageCounts,
  getTrackerBoard,
  getUpcomingInterviews,
  listTrackerApplications,
  milestonesFor,
  moveApplicationStage,
  recordStageSignal,
  updateInterviewRound,
} from "../src/repositories/tracker";
import { makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

let n = 0;
async function makeApp(userId: string, extra: { company?: string; title?: string; status?: "QUEUED" | "SUBMITTED" | "FAILED" | "READY" | "PROCESSING" | "SKIPPED" } = {}) {
  n += 1;
  const job = await createManualJob(
    userId,
    manualJobSchema.parse({ url: `https://example.com/jobs/${n}`, title: extra.title ?? `Account Executive ${n}`, company: extra.company ?? `Company ${n}`, location: "New York, NY" }),
    "GENERIC",
  );
  await queueApplications(userId, [job.id]);
  const app = await prisma.application.findUniqueOrThrow({ where: { jobId: job.id } });
  if (extra.status && extra.status !== "QUEUED") {
    return prisma.application.update({ where: { id: app.id }, data: { status: extra.status, ...(extra.status === "SUBMITTED" ? { submittedAt: new Date() } : {}) } });
  }
  return app;
}

const events = (applicationId: string) => prisma.applicationEvent.findMany({ where: { applicationId }, orderBy: { createdAt: "asc" } });
const round = (input: Record<string, string>) => interviewRoundSchema.parse(input);

describe("moving between stages", () => {
  it("moves a sent application through the stages and records each move on the timeline", async () => {
    const user = await makeUser();
    const app = await makeApp(user.id, { status: "SUBMITTED" });

    await moveApplicationStage(user.id, app.id, "RESPONDED");
    await moveApplicationStage(user.id, app.id, "INTERVIEWING");
    await moveApplicationStage(user.id, app.id, "OFFER");
    let row = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(row).toMatchObject({ status: "SUBMITTED", outcome: "OFFER", closedAt: null });
    expect(row.respondedAt && row.interviewingAt && row.offerAt && row.stageChangedAt).toBeTruthy();

    await moveApplicationStage(user.id, app.id, "REJECTED");
    row = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(row).toMatchObject({ status: "REJECTED", outcome: "DECLINED" });
    expect(row.closedAt).toBeTruthy();
    expect(row.offerAt).toBeTruthy();

    const moves = (await events(app.id)).filter((e) => e.type === "STAGE_CHANGED");
    expect(moves.map((e) => e.message)).toEqual([
      "Moved from Submitted to Responded",
      "Moved from Responded to Interviewing",
      "Moved from Interviewing to Offer",
      "Moved from Offer to Rejected",
    ]);
    expect(moves[0]!.data).toMatchObject({ from: "SUBMITTED", to: "RESPONDED", source: "user" });
  });

  it("clears later milestones when a card is moved back to correct a mistake", async () => {
    const user = await makeUser();
    const app = await makeApp(user.id, { status: "SUBMITTED" });
    await moveApplicationStage(user.id, app.id, "ACCEPTED");
    let row = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(row.offerAt && row.closedAt).toBeTruthy();

    await moveApplicationStage(user.id, app.id, "RESPONDED");
    row = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(row).toMatchObject({ outcome: "RESPONDED", interviewingAt: null, offerAt: null, closedAt: null });
    expect(row.respondedAt).toBeTruthy();

    await moveApplicationStage(user.id, app.id, "SUBMITTED");
    row = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(row).toMatchObject({ status: "SUBMITTED", outcome: "NONE", outcomeAt: null, respondedAt: null });
  });

  it("keeps the earliest milestone when a stage is reached twice", () => {
    const first = new Date("2026-01-01T00:00:00Z");
    const later = new Date("2026-02-01T00:00:00Z");
    expect(milestonesFor("OFFER", { respondedAt: first, interviewingAt: first, offerAt: null, closedAt: null }, later)).toEqual({
      respondedAt: first,
      interviewingAt: first,
      offerAt: later,
      closedAt: null,
    });
    expect(milestonesFor("WITHDRAWN", { respondedAt: null, interviewingAt: null, offerAt: null, closedAt: null }, later)).toMatchObject({ respondedAt: null, closedAt: later });
  });

  it("marks an unsent application submitted when it's moved past Submitted", async () => {
    const user = await makeUser();
    const app = await makeApp(user.id, { status: "READY" });
    await prisma.application.update({ where: { id: app.id }, data: { attentionReason: "FINAL_REVIEW", attentionDetail: "Review it" } });

    const result = await moveApplicationStage(user.id, app.id, "INTERVIEWING");
    expect(result).toMatchObject({ from: "NEEDS_YOU", to: "INTERVIEWING", kind: "mark_submitted" });
    const row = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(row).toMatchObject({ status: "SUBMITTED", outcome: "INTERVIEW", attentionReason: null, attentionDetail: null });
    expect(row.submittedAt).toBeTruthy();
    expect((await events(app.id)).filter((e) => ["SUBMITTED", "STAGE_CHANGED"].includes(e.type)).map((e) => e.message)).toEqual([
      "Marked as submitted by you",
      "Moved from Submitted to Interviewing",
    ]);
  });

  it("refuses moves the automation owns and moves on running applications", async () => {
    const user = await makeUser();
    const running = await makeApp(user.id, { status: "PROCESSING" });
    await expect(moveApplicationStage(user.id, running.id, "SUBMITTED")).rejects.toBeInstanceOf(ConflictError);
    const sent = await makeApp(user.id, { status: "SUBMITTED" });
    await expect(moveApplicationStage(user.id, sent.id, "QUEUED")).rejects.toThrow(/already been sent/);
    const queued = await makeApp(user.id);
    await expect(moveApplicationStage(user.id, queued.id, "NEEDS_YOU")).rejects.toThrow(/set by the automation/);
    await prisma.application.update({ where: { id: queued.id }, data: { lockedBy: "worker-1" } });
    await expect(moveApplicationStage(user.id, queued.id, "SUBMITTED")).rejects.toThrow(/starting right now/);
  });

  it("only moves the user's own applications", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const app = await makeApp(user.id, { status: "SUBMITTED" });
    await expect(moveApplicationStage(other.id, app.id, "OFFER")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("retries failures, re-queues skipped applications and skips from the board", async () => {
    const user = await makeUser();
    const failed = await makeApp(user.id, { status: "FAILED" });
    await moveApplicationStage(user.id, failed.id, "QUEUED");
    expect((await prisma.application.findUniqueOrThrow({ where: { id: failed.id } })).status).toBe("QUEUED");

    await moveApplicationStage(user.id, failed.id, "SKIPPED");
    expect((await prisma.application.findUniqueOrThrow({ where: { id: failed.id } })).status).toBe("SKIPPED");

    await moveApplicationStage(user.id, failed.id, "QUEUED");
    expect(await prisma.application.findUniqueOrThrow({ where: { id: failed.id } })).toMatchObject({ status: "QUEUED", completedAt: null });

    await prisma.application.update({ where: { id: failed.id }, data: { status: "SKIPPED" } });
    await prisma.job.update({ where: { id: failed.jobId }, data: { deletedAt: new Date() } });
    await expect(moveApplicationStage(user.id, failed.id, "QUEUED")).rejects.toThrow(/deleted/);
  });
});

describe("board and table", () => {
  it("groups applications into columns with counts, search and a per-column cap", async () => {
    const user = await makeUser();
    await makeApp(user.id, { company: "Stripe" });
    await makeApp(user.id, { company: "Ramp", status: "SUBMITTED" });
    const linear = await makeApp(user.id, { company: "Linear", status: "SUBMITTED" });
    await moveApplicationStage(user.id, linear.id, "INTERVIEWING");
    await makeApp(user.id, { company: "Notion", status: "SKIPPED" });
    for (let i = 0; i < 3; i++) await makeApp(user.id, { company: `Queue ${i}` });

    const board = await getTrackerBoard(user.id, { perColumn: 2 });
    const column = (stage: string) => board.columns.find((c) => c.stage === stage)!;
    expect(board.columns.map((c) => c.stage)).not.toContain("SKIPPED");
    expect(column("QUEUED")).toMatchObject({ total: 4 });
    expect(column("QUEUED").cards).toHaveLength(2);
    expect(column("SUBMITTED").cards.map((c) => c.job.company)).toEqual(["Ramp"]);
    expect(column("INTERVIEWING").cards[0]).toMatchObject({ stage: "INTERVIEWING", job: { company: "Linear" } });
    expect(board.counts.SKIPPED).toBe(1);

    const searched = await getTrackerBoard(user.id, { q: "lin" });
    expect(searched.columns.flatMap((c) => c.cards).map((c) => c.job.company)).toEqual(["Linear"]);

    const table = await listTrackerApplications(user.id, trackerFiltersSchema.parse({ stage: "SUBMITTED,INTERVIEWING", sort: "company", dir: "asc" }));
    expect(table.total).toBe(2);
    expect(table.rows.map((r) => [r.job.company, r.stage])).toEqual([
      ["Linear", "INTERVIEWING"],
      ["Ramp", "SUBMITTED"],
    ]);
    expect(table.counts).toMatchObject({ QUEUED: 4, SUBMITTED: 1, INTERVIEWING: 1, SKIPPED: 1 });
  });

  it("keeps each user's board to their own applications", async () => {
    const user = await makeUser();
    const other = await makeUser();
    await makeApp(other.id, { status: "SUBMITTED" });
    expect(Object.values(await getStageCounts(user.id)).every((c) => c === 0)).toBe(true);
  });
});

describe("interview rounds", () => {
  it("adds rounds, moves the application to Interviewing and feeds upcoming interviews", async () => {
    const user = await makeUser();
    const app = await makeApp(user.id, { status: "SUBMITTED", company: "Linear" });
    const soon = new Date(Date.now() + 2 * 86400_000);
    const r1 = await createInterviewRound(user.id, app.id, round({ kind: "PHONE_SCREEN", scheduledAt: soon.toISOString(), durationMinutes: "30" }));
    expect(await prisma.application.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ outcome: "INTERVIEW" });

    const r2 = await createInterviewRound(user.id, app.id, round({ kind: "ONSITE", title: "Onsite loop" }));
    const upcoming = await getUpcomingInterviews(user.id);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]).toMatchObject({ id: r1.id, application: { job: { company: "Linear" } } });

    const board = await getTrackerBoard(user.id);
    const card = board.columns.find((c) => c.stage === "INTERVIEWING")!.cards[0]!;
    expect(card.interviews[0]?.id).toBe(r1.id);
    expect(card._count.interviews).toBe(2);

    await updateInterviewRound(user.id, r1.id, round({ kind: "PHONE_SCREEN", scheduledAt: soon.toISOString(), status: "COMPLETED", notes: "Went well" }));
    expect(await getUpcomingInterviews(user.id)).toHaveLength(0);
    await deleteInterviewRound(user.id, r2.id);

    expect((await events(app.id)).map((e) => e.message)).toEqual(
      expect.arrayContaining([
        "Interview added: Phone screen",
        "Moved from Submitted to Interviewing: interview added",
        "Interview added: Onsite loop",
        "Phone screen marked completed",
        "Interview removed: Onsite loop",
      ]),
    );
  });

  it("doesn't move an application that is already past Interviewing", async () => {
    const user = await makeUser();
    const app = await makeApp(user.id, { status: "SUBMITTED" });
    await moveApplicationStage(user.id, app.id, "OFFER");
    await createInterviewRound(user.id, app.id, round({ kind: "FINAL" }));
    expect((await prisma.application.findUniqueOrThrow({ where: { id: app.id } })).outcome).toBe("OFFER");
  });

  it("refuses rounds on unsent applications and other users' rounds", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const queued = await makeApp(user.id);
    await expect(createInterviewRound(user.id, queued.id, round({}))).rejects.toThrow(/submitted/);
    const sent = await makeApp(user.id, { status: "SUBMITTED" });
    const r = await createInterviewRound(user.id, sent.id, round({}));
    await expect(updateInterviewRound(other.id, r.id, round({}))).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteInterviewRound(other.id, r.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createInterviewRound(other.id, sent.id, round({}))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("dashboard metrics", () => {
  it("counts milestones so the funnel and rates hold as applications move on", async () => {
    const user = await makeUser();
    const a = await makeApp(user.id, { status: "SUBMITTED" });
    const b = await makeApp(user.id, { status: "SUBMITTED" });
    const c = await makeApp(user.id, { status: "SUBMITTED" });
    await makeApp(user.id, { status: "SUBMITTED" });
    await moveApplicationStage(user.id, a.id, "OFFER");
    await moveApplicationStage(user.id, a.id, "ACCEPTED");
    await moveApplicationStage(user.id, b.id, "INTERVIEWING");
    await moveApplicationStage(user.id, b.id, "REJECTED");
    await moveApplicationStage(user.id, c.id, "WITHDRAWN");

    const stats = await getDashboardStats(user.id);
    expect(stats.cards.applicationsSent).toBe(4);
    expect(stats.responses).toMatchObject({ submitted: 4, responded: 2, interviews: 2, offers: 1, accepted: 1, active: 1, responseRate: 50, interviewRate: 50, offerRate: 25 });
    expect(stats.responses.avgDaysToResponse).toBe(0);
    expect(stats.funnel.map((f) => [f.stage, f.count])).toEqual([
      ["Imported", 4],
      ["Analyzed", 0],
      ["Queued", 4],
      ["Submitted", 4],
      ["Responded", 2],
      ["Interviewing", 2],
      ["Offer", 1],
      ["Accepted", 1],
    ]);
    expect(stats.stages).toMatchObject({ SUBMITTED: 1, ACCEPTED: 1, REJECTED: 1, WITHDRAWN: 1 });
  });

  it("changes the live-update fingerprint when an interview changes", async () => {
    const user = await makeUser();
    const app = await makeApp(user.id, { status: "SUBMITTED" });
    await moveApplicationStage(user.id, app.id, "INTERVIEWING");
    const before = await getChangeFingerprint(user.id);
    const r = await createInterviewRound(user.id, app.id, round({}));
    const afterCreate = await getChangeFingerprint(user.id);
    expect(afterCreate).not.toBe(before);
    await prisma.interviewRound.update({ where: { id: r.id }, data: { notes: "Prep questions" } });
    expect(await getChangeFingerprint(user.id)).not.toBe(afterCreate);
  });
});

describe("integration signals (email hook)", () => {
  const signal = (extra: Partial<StageSignal> = {}): StageSignal => ({
    company: "Linear",
    stage: "INTERVIEWING",
    occurredAt: new Date(),
    confidence: 95,
    evidence: "Interview invitation: Account Executive",
    externalId: "msg-1",
    ...extra,
  });

  it("applies a confident forward update once, with the provider on the timeline", async () => {
    const user = await makeUser();
    const app = await makeApp(user.id, { status: "SUBMITTED", company: "Linear" });
    const at = new Date(Date.now() + 86400_000);
    expect(await recordStageSignal(user.id, "gmail", signal({ interview: { scheduledAt: at, kind: "PHONE_SCREEN" } }))).toEqual({
      result: "applied",
      applicationId: app.id,
      from: "SUBMITTED",
      to: "INTERVIEWING",
    });
    expect(await prisma.interviewRound.count({ where: { applicationId: app.id } })).toBe(1);
    expect(await recordStageSignal(user.id, "gmail", signal())).toEqual({ result: "duplicate", applicationId: app.id });
    const moved = (await events(app.id)).find((e) => e.type === "STAGE_CHANGED")!;
    expect(moved.message).toBe("Moved from Submitted to Interviewing (from gmail): Interview invitation: Account Executive");
    expect(moved.data).toMatchObject({ source: "integration", provider: "gmail", externalId: "gmail:msg-1" });
  });

  it("only suggests low-confidence or backward updates, and never matches a guess", async () => {
    const user = await makeUser();
    const app = await makeApp(user.id, { status: "SUBMITTED", company: "Linear" });
    await moveApplicationStage(user.id, app.id, "OFFER");
    expect(await recordStageSignal(user.id, "gmail", signal({ externalId: "a" }))).toMatchObject({ result: "suggested", reason: "not_forward" });
    expect(await recordStageSignal(user.id, "gmail", signal({ stage: "ACCEPTED", confidence: 60, externalId: "b" }))).toMatchObject({ result: "suggested", reason: "low_confidence" });
    expect((await prisma.application.findUniqueOrThrow({ where: { id: app.id } })).outcome).toBe("OFFER");

    expect(await recordStageSignal(user.id, "gmail", signal({ company: "Unknown Co" }))).toEqual({ result: "unmatched" });
    await makeApp(user.id, { status: "SUBMITTED", company: "Linear" });
    expect(await recordStageSignal(user.id, "gmail", signal({ externalId: "c" }))).toMatchObject({ result: "ambiguous" });
  });
});
