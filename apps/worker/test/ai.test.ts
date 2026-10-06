import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ANSWER_DRAFT_JSON_SCHEMA, FIELD_MAPPING_JSON_SCHEMA, registerProvider, type CompletionRequest } from "@autoapply/ai";
import { approveQuestionAnswer, prisma } from "@autoapply/database";
import { startMockSite, type MockSite } from "../mock-site/server";
import { loadApplication, makeApplicant, makeEngine, queueFor, resetDatabase, runOnce } from "./helpers";

/**
 * AI field mapping and answer drafts inside a real worker run, with a scripted
 * provider standing in for the model (no API key or network needed).
 */

const calls: CompletionRequest[] = [];
let failing = false;
registerProvider("scripted", () => ({
  id: "scripted",
  model: "scripted-1",
  async complete(req) {
    calls.push(req);
    if (failing) throw new Error("provider is down");
    const prompt = req.messages.at(-1)!.content;
    if (req.jsonSchema === FIELD_MAPPING_JSON_SCHEMA) {
      const mapped = prompt.includes("What do people call you at work") ? "masterProfile.currentTitle" : "unknown";
      return { text: JSON.stringify({ mappedField: mapped, questionKey: null, confidence: 92, reason: "asks for the current job title" }), model: "scripted-1" };
    }
    if (req.jsonSchema === ANSWER_DRAFT_JSON_SCHEMA) {
      const answerable = prompt.includes("outbound prospecting background");
      return { text: JSON.stringify({ answerable, answer: answerable ? "I've spent 4 years as a Sales Development Representative, working in Salesforce every day." : "", basedOn: "your title and summary", confidence: 75 }), model: "scripted-1" };
    }
    throw new Error("unexpected request");
  },
}));

let site: MockSite;
const { engine, browsers, workerId } = makeEngine();

beforeAll(async () => {
  site = await startMockSite();
});
afterAll(async () => {
  await browsers.close();
  await site.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase();
  site.reset();
  calls.length = 0;
  failing = false;
});

async function applicantWithAI() {
  const user = await makeApplicant();
  await prisma.userSetting.update({ where: { userId: user.id }, data: { aiProvider: "scripted" } });
  return user;
}

describe("AI in the worker", () => {
  it("maps an unfamiliar field with AI, drafts an answer for review, and submits only after approval", async () => {
    const user = await applicantWithAI();
    const app = await queueFor(user.id, `${site.url}/ai-questions`);
    await runOnce(engine, workerId, app.id);
    let after = await loadApplication(app.id);
    expect(after.status).toBe("REVIEW_REQUIRED");
    expect(site.submissions).toHaveLength(0);

    const title = after.questions.find((q) => q.label.startsWith("What do people call you"))!;
    expect(title).toMatchObject({ status: "ANSWERED", mappedField: "masterProfile.currentTitle", confidence: 85 });
    expect(title.answer?.value).toBe("Sales Development Representative");

    const story = after.questions.find((q) => q.label.startsWith("Walk us through"))!;
    expect(story.status).toBe("NEEDS_REVIEW");
    expect(story.answer).toMatchObject({ value: "I've spent 4 years as a Sales Development Representative, working in Salesforce every day.", source: "AI_GENERATED" });
    expect(story.reviewReason).toBe("AI draft based on your title and summary. Nothing is sent until you approve it.");

    const notes = after.events.map((e) => e.message);
    expect(notes.some((m) => m.includes("AI field mapping and answer drafts are on (scripted-1)"))).toBe(true);
    expect(notes.some((m) => m.includes("1 mapped with AI help") && m.includes("1 with an AI draft to check"))).toBe(true);
    // Each question is drafted once, even though the page is scanned again after filling.
    expect(calls.filter((c) => c.jsonSchema === ANSWER_DRAFT_JSON_SCHEMA)).toHaveLength(1);
    // Fields the heuristic knows never reach the model.
    expect(calls.filter((c) => c.jsonSchema === FIELD_MAPPING_JSON_SCHEMA).map((c) => c.messages.at(-1)!.content)).toEqual([
      expect.stringContaining("What do people call you"),
      expect.stringContaining("Walk us through"),
    ]);

    await approveQuestionAnswer(user.id, story.id);
    await runOnce(engine, workerId, app.id);
    after = await loadApplication(app.id);
    expect(after.status, after.attentionDetail ?? "").toBe("SUBMITTED");
    expect(site.submissions[0]!.fields).toMatchObject({ role_now: "Sales Development Representative", story: "I've spent 4 years as a Sales Development Representative, working in Salesforce every day." });
  });

  it("carries on with the built-in mapper when the provider fails, and says so", async () => {
    failing = true;
    const user = await applicantWithAI();
    const app = await queueFor(user.id, `${site.url}/ai-questions`);
    await runOnce(engine, workerId, app.id);
    const after = await loadApplication(app.id);
    expect(after.status).toBe("REVIEW_REQUIRED");
    expect(after.questions.filter((q) => q.status === "NEEDS_REVIEW").map((q) => q.answer)).toEqual([null, null]);
    expect(after.events.find((e) => e.message.startsWith("AI was unavailable"))?.message).toContain("provider is down");
  });
});
