import { describe, expect, it } from "vitest";
import type { AIProvider } from "@autoapply/ai";
import { AI_ONLY_CAP, classifyEmail, classifyWithAI, combineReadings } from "../src";

const received = new Date("2026-10-06T15:00:00Z");
const fakeAI = (reply: object): AIProvider => ({ id: "fake", model: "fake-1", complete: async () => ({ text: JSON.stringify(reply), model: "fake-1" }) });
const message = { subject: "Quick chat", text: "Let's talk Thursday", fromName: "Sam", fromAddress: "sam@acme.com", receivedAt: received, invite: null };

describe("AI reading", () => {
  it("never lets the AI alone move a card", async () => {
    const ai = await classifyWithAI(fakeAI({ kind: "OFFER", confidence: 99, interviewStart: null, durationMinutes: null, interviewKind: null }), message, "UTC");
    const combined = combineReadings(null, ai, message)!;
    expect(combined).toMatchObject({ kind: "OFFER", stage: "OFFER", method: "ai" });
    expect(combined.confidence).toBe(AI_ONLY_CAP);
  });

  it("lifts the rules to confident when both agree, and fills in the interview time", async () => {
    const rules = classifyEmail({ ...message, subject: "Interview", text: "Your interview has been rescheduled." }, "UTC")!;
    expect(rules.confidence).toBeLessThan(90);
    const ai = await classifyWithAI(fakeAI({ kind: "INTERVIEW", confidence: 95, interviewStart: "2026-10-09T13:00:00-04:00", durationMinutes: 45, interviewKind: "TECHNICAL" }), message, "UTC");
    const combined = combineReadings(rules, ai, message)!;
    expect(combined).toMatchObject({ kind: "INTERVIEW", confidence: 92, method: "rules+ai", interview: { scheduledAt: new Date("2026-10-09T17:00:00Z"), durationMinutes: 45, kind: "TECHNICAL" } });
  });

  it("drops an implausible or zone-less AI time, and a disagreement only suggests", async () => {
    const rules = classifyEmail({ ...message, subject: "Interview", text: "Your interview has been rescheduled." }, "UTC")!;
    const ai = await classifyWithAI(fakeAI({ kind: "REJECTION", confidence: 97, interviewStart: "2026-10-09T13:00:00", durationMinutes: null, interviewKind: null }), message, "UTC");
    expect(combineReadings(rules, ai, message)).toMatchObject({ kind: "REJECTION", confidence: 60, method: "ai" });
    const noZone = await classifyWithAI(fakeAI({ kind: "INTERVIEW", confidence: 90, interviewStart: "2026-10-09T13:00:00", durationMinutes: null, interviewKind: null }), message, "UTC");
    expect(combineReadings(null, noZone, message)?.interview?.scheduledAt).toBeUndefined();
  });

  it("rejects output that doesn't fit the schema", async () => {
    await expect(classifyWithAI(fakeAI({ kind: "MAYBE", confidence: 50 }), message, "UTC")).rejects.toThrow();
  });
});
