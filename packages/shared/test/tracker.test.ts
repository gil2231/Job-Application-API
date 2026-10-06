import { describe, expect, it } from "vitest";
import {
  APPLICATION_OUTCOMES,
  APPLICATION_STATUSES,
  BOARD_STAGES,
  checkStageMove,
  interviewRoundSchema,
  outcomeForStage,
  POST_SUBMIT_STAGES,
  stageForOutcome,
  stageOf,
  stageTargets,
  trackerFiltersSchema,
} from "../src";

describe("stageOf", () => {
  it("derives pre-submit stages from the automation status", () => {
    expect(stageOf({ status: "QUEUED", outcome: "NONE" })).toBe("QUEUED");
    expect(stageOf({ status: "PROCESSING", outcome: "NONE" })).toBe("PROCESSING");
    for (const status of ["WAITING_FOR_USER", "REVIEW_REQUIRED", "READY"] as const) expect(stageOf({ status, outcome: "NONE" })).toBe("NEEDS_YOU");
    expect(stageOf({ status: "FAILED", outcome: "NONE" })).toBe("FAILED");
    expect(stageOf({ status: "SKIPPED", outcome: "NONE" })).toBe("SKIPPED");
  });

  it("derives post-submit stages from the outcome", () => {
    expect(stageOf({ status: "SUBMITTED", outcome: "NONE" })).toBe("SUBMITTED");
    expect(stageOf({ status: "SUBMITTED", outcome: "INTERVIEW" })).toBe("INTERVIEWING");
    expect(stageOf({ status: "REJECTED", outcome: "DECLINED" })).toBe("REJECTED");
    expect(stageOf({ status: "REJECTED", outcome: "NONE" })).toBe("REJECTED");
    expect(stageOf({ status: "SUBMITTED", outcome: "WITHDRAWN" })).toBe("WITHDRAWN");
  });

  it("gives every status and outcome combination a stage", () => {
    for (const status of APPLICATION_STATUSES) for (const outcome of APPLICATION_OUTCOMES) expect(stageOf({ status, outcome })).toBeTruthy();
  });

  it("round-trips post-submit stages through outcomes", () => {
    for (const stage of POST_SUBMIT_STAGES) expect(stageForOutcome(outcomeForStage(stage))).toBe(stage);
  });

  it("puts every stage except Skipped on the board", () => {
    expect(BOARD_STAGES).not.toContain("SKIPPED");
    expect(BOARD_STAGES).toHaveLength(11);
  });
});

describe("checkStageMove", () => {
  it("moves freely between post-submit stages, backwards included", () => {
    expect(checkStageMove("SUBMITTED", "OFFER")).toMatchObject({ allowed: true, kind: "progress" });
    expect(checkStageMove("REJECTED", "INTERVIEWING")).toMatchObject({ allowed: true, kind: "progress" });
  });

  it("treats moving an unsent application forward as applying yourself, and asks first", () => {
    const move = checkStageMove("NEEDS_YOU", "INTERVIEWING");
    expect(move).toMatchObject({ allowed: true, kind: "mark_submitted" });
    expect(move.allowed && move.confirm).toMatch(/Interviewing/);
    expect(checkStageMove("FAILED", "SUBMITTED")).toMatchObject({ allowed: true, kind: "mark_submitted" });
  });

  it("never lets a hand move touch an application being worked on", () => {
    expect(checkStageMove("PROCESSING", "SUBMITTED").allowed).toBe(false);
    expect(checkStageMove("PROCESSING", "SKIPPED").allowed).toBe(false);
    expect(checkStageMove("QUEUED", "SUBMITTED", { locked: true }).allowed).toBe(false);
    expect(checkStageMove("QUEUED", "SKIPPED", { locked: true }).allowed).toBe(false);
  });

  it("leaves automation stages to the automation, apart from retry, re-queue and skip", () => {
    expect(checkStageMove("QUEUED", "PROCESSING").allowed).toBe(false);
    expect(checkStageMove("QUEUED", "NEEDS_YOU").allowed).toBe(false);
    expect(checkStageMove("SUBMITTED", "QUEUED").allowed).toBe(false);
    expect(checkStageMove("FAILED", "QUEUED")).toMatchObject({ allowed: true, kind: "retry" });
    expect(checkStageMove("SKIPPED", "QUEUED")).toMatchObject({ allowed: true, kind: "requeue" });
    expect(checkStageMove("NEEDS_YOU", "SKIPPED")).toMatchObject({ allowed: true, kind: "skip" });
    expect(checkStageMove("SUBMITTED", "SKIPPED").allowed).toBe(false);
  });

  it("lists the targets a menu should offer", () => {
    expect(stageTargets("PROCESSING")).toEqual([]);
    expect(stageTargets("FAILED")).toEqual(["QUEUED", "SUBMITTED", "RESPONDED", "INTERVIEWING", "OFFER", "ACCEPTED", "REJECTED", "WITHDRAWN", "SKIPPED"]);
    expect(stageTargets("OFFER")).toEqual(["SUBMITTED", "RESPONDED", "INTERVIEWING", "ACCEPTED", "REJECTED", "WITHDRAWN"]);
  });
});

describe("schemas", () => {
  it("parses an interview round from form input", () => {
    const parsed = interviewRoundSchema.parse({ kind: "TECHNICAL", title: "", scheduledAt: "2026-10-10T15:00:00.000Z", durationMinutes: "45", notes: " Bring laptop " });
    expect(parsed).toMatchObject({ kind: "TECHNICAL", title: null, durationMinutes: 45, notes: "Bring laptop", status: "SCHEDULED", location: null });
    expect(parsed.scheduledAt?.toISOString()).toBe("2026-10-10T15:00:00.000Z");
    expect(interviewRoundSchema.parse({ scheduledAt: "", durationMinutes: "" })).toMatchObject({ kind: "OTHER", scheduledAt: null, durationMinutes: null });
    expect(interviewRoundSchema.safeParse({ scheduledAt: "not a date" }).success).toBe(false);
    expect(interviewRoundSchema.safeParse({ durationMinutes: "2" }).success).toBe(false);
  });

  it("parses tracker filters with safe defaults", () => {
    expect(trackerFiltersSchema.parse({})).toMatchObject({ view: "board", stage: [], sort: "updatedAt", page: 1 });
    expect(trackerFiltersSchema.parse({ view: "table", stage: "OFFER,BOGUS,REJECTED", sort: "nope" })).toMatchObject({ view: "table", stage: ["OFFER", "REJECTED"], sort: "updatedAt" });
  });
});
