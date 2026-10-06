import { describe, expect, it } from "vitest";
import { mayDraft, type AnswerDrafter } from "../src/drafts";
import type { DetectedField } from "../src/fields";
import { FieldResolver, SIMILAR_ANSWER_MAX_CONFIDENCE, type ResolverInput } from "../src/resolve";
import { findSimilarAnswer, questionSimilarity } from "../src/similarity";

const field = (label: string, extra: Partial<DetectedField> = {}): DetectedField => ({ label, kind: "textarea", required: true, pageIndex: 0, locators: [{ strategy: "label", value: label }], key: label.toLowerCase().replace(/\W+/g, "_"), ...extra });

const saved = (id: string, question: string, answer: string, extra: Partial<ResolverInput["library"][number]> = {}) => ({ id, questionKey: id, question, answer, confidence: 100, autoSubmitAllowed: true, requiresHumanReview: false, isSensitive: false, ...extra });

describe("questionSimilarity", () => {
  it("matches the same question worded differently", () => {
    expect(questionSimilarity("Describe a time you exceeded your sales quota.", "Tell us about a time you exceeded quota")).toBeGreaterThanOrEqual(0.75);
    expect(questionSimilarity("Do you have experience with Salesforce?", "Do you have Salesforce experience")).toBe(1);
  });

  it("never matches questions about different places, numbers or negations", () => {
    expect(questionSimilarity("Are you authorized to work in the US?", "Are you authorized to work in Canada?")).toBe(0);
    expect(questionSimilarity("Do you have 5 years of SQL experience?", "Do you have 3 years of SQL experience?")).toBe(0);
    expect(questionSimilarity("Have you worked here before?", "Have you never worked here before?")).toBe(0);
  });

  it("ignores sensitive answers", () => {
    const library = [saved("g", "What is your gender identity?", "Female", { isSensitive: true })];
    expect(findSimilarAnswer("Gender identity", library)).toBeNull();
  });
});

describe("FieldResolver suggestions", () => {
  const base: ResolverInput = {
    profile: { firstName: "Jordan", employment: [], education: [] },
    library: [saved("quota", "Tell us about a time you exceeded quota", "In 2024 I closed 130% of quota at Brightwave.")],
    stored: [],
    documents: {},
    fieldConfidenceThreshold: 85,
    answerConfidenceThreshold: 85,
  };
  const resolve = (f: DetectedField, input: Partial<ResolverInput> = {}) => new FieldResolver({ ...base, ...input }).resolve(f);

  it("suggests a saved answer to a similar question, below the default threshold", async () => {
    const m = await resolve(field("Describe a time you exceeded your sales quota."));
    expect(m).toMatchObject({ value: "In 2024 I closed 130% of quota at Brightwave.", source: "library", status: "NEEDS_REVIEW", libraryAnswerId: "quota" });
    expect(m.confidence).toBeLessThanOrEqual(SIMILAR_ANSWER_MAX_CONFIDENCE);
    expect(m.reviewReason).toBe('Suggested from your saved answer to "Tell us about a time you exceeded quota". The wording differs, so check it fits.');
  });

  it("fills it without review when the person lowered their threshold", async () => {
    const m = await resolve(field("Describe a time you exceeded your sales quota."), { answerConfidenceThreshold: 70 });
    expect(m).toMatchObject({ status: "ANSWERED", source: "library" });
    expect(m.reviewReason).toBeUndefined();
  });

  it("offers an AI draft for review, never as approved", async () => {
    const calls: string[] = [];
    const drafter: AnswerDrafter = { draft: async (f) => (calls.push(f.label), { value: "I run demos for finance teams at Brightwave.", confidence: 95, basis: "your role at Brightwave" }) };
    const m = await resolve(field("What draws you to selling payments software?"), { drafter });
    expect(m).toMatchObject({ value: "I run demos for finance teams at Brightwave.", source: "ai", status: "NEEDS_REVIEW", autoSubmitAllowed: false, confidence: 95 });
    expect(m.reviewReason).toBe("AI draft based on your role at Brightwave. Nothing is sent until you approve it.");
    // Optional questions and questions only the person can answer get no draft.
    expect(await resolve(field("Anything else?", { required: false }), { drafter })).toMatchObject({ status: "SKIPPED", value: null });
    expect(await resolve(field("Will you require visa sponsorship?"), { drafter })).toMatchObject({ status: "NEEDS_REVIEW", value: null, source: "none" });
    expect(calls).toEqual(["What draws you to selling payments software?"]);
  });

  it("drops a draft that isn't one of a dropdown's options, and survives a failing drafter", async () => {
    const offList: AnswerDrafter = { draft: async () => ({ value: "Purple", confidence: 90, basis: "x" }) };
    expect(await resolve(field("Preferred segment", { kind: "select", options: ["Mid-market", "Enterprise"] }), { drafter: offList })).toMatchObject({ status: "NEEDS_REVIEW", value: null });
    const onList: AnswerDrafter = { draft: async () => ({ value: "mid-market", confidence: 90, basis: "x" }) };
    expect(await resolve(field("Preferred segment", { kind: "select", options: ["Mid-market", "Enterprise"] }), { drafter: onList })).toMatchObject({ status: "NEEDS_REVIEW", value: "Mid-market", source: "ai" });
    const failing: AnswerDrafter = { draft: async () => { throw new Error("boom"); } };
    expect(await resolve(field("What draws you to selling payments software?"), { drafter: failing })).toMatchObject({ status: "NEEDS_REVIEW", value: null });
  });

  it("knows which questions may be drafted", () => {
    expect(mayDraft(field("Why do you want to work here?"))).toBe(true);
    expect(mayDraft(field("Upload resume", { kind: "file" }))).toBe(false);
    for (const label of ["Are you legally authorized to work in the US?", "Race/Ethnicity", "Veteran status", "Expected salary", "Earliest start date", "Have you ever been convicted of a felony?", "How did you hear about us?", "I agree to the terms"]) {
      expect(mayDraft(field(label)), label).toBe(false);
    }
  });
});
