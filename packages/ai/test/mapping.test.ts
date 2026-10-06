import { describe, expect, it } from "vitest";
import { FieldResolver, type DetectedField } from "@autoapply/automation";
import { AIAnswerDrafter, AIFieldClassifier, AI_ONLY_MAX_CONFIDENCE, createApplicationAI, FIELD_MAPPING_JSON_SCHEMA, ANSWER_DRAFT_JSON_SCHEMA } from "../src";
import { fakeProvider, JOB, PROFILE } from "./writing-fixtures";

const field = (label: string, extra: Partial<DetectedField> = {}): DetectedField => ({ label, kind: "text", required: true, pageIndex: 0, locators: [{ strategy: "label", value: label }], key: label.toLowerCase().replace(/\W+/g, "_"), ...extra });

const answer = (mappedField: string, confidence: number, questionKey: string | null = null) => ({ mappedField, questionKey, confidence, reason: "Label asks for it" });

describe("AIFieldClassifier", () => {
  it("doesn't ask the model about fields the heuristic already knows", async () => {
    const provider = fakeProvider(() => answer("unknown", 0));
    const c = new AIFieldClassifier(provider);
    expect(await c.classify(field("First name"))).toMatchObject({ mappedField: "masterProfile.firstName", confidence: 95, method: "heuristic" });
    expect(provider.calls).toHaveLength(0);
  });

  it("maps a field only the model recognizes, capped below full confidence, and asks once per field", async () => {
    const provider = fakeProvider(() => answer("masterProfile.currentCompany", 99));
    const c = new AIFieldClassifier(provider);
    const f = field("Where do you work today?");
    const result = await c.classify(f);
    await c.classify(f);
    expect(result).toEqual({ mappedField: "masterProfile.currentCompany", questionKey: undefined, confidence: AI_ONLY_MAX_CONFIDENCE, evidence: "AI: Label asks for it", method: "ai" });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.jsonSchema).toBe(FIELD_MAPPING_JSON_SCHEMA);
    expect(provider.calls[0]!.messages[1]!.content).toContain("<field>\nLabel: Where do you work today?");
    expect(c.stats).toMatchObject({ asked: 1, aiMapped: 1 });
  });

  it("raises confidence when the model agrees and sends disagreements to a person", async () => {
    const agree = new AIFieldClassifier(fakeProvider(() => answer("masterProfile.linkedinUrl", 95)));
    // "LinkedIn profile link" matches by phrase at 85.
    expect(await agree.classify(field("Your LinkedIn profile link"))).toMatchObject({ mappedField: "masterProfile.linkedinUrl", confidence: 95, method: "ai" });

    const disagree = new AIFieldClassifier(fakeProvider(() => answer("masterProfile.portfolioUrl", 90)));
    const r = await disagree.classify(field("Your LinkedIn profile link"));
    expect(r).toMatchObject({ mappedField: "masterProfile.linkedinUrl", confidence: 40, method: "ai" });
    expect(r.evidence).toBe("AI read it as portfolio URL instead");
  });

  it("never lets the model put a document in a text box, and falls back when the model fails", async () => {
    expect(await new AIFieldClassifier(fakeProvider(() => answer("documents.resume", 90))).classify(field("Paste your experience"))).toMatchObject({ mappedField: "unknown", method: "heuristic" });
    const failing = new AIFieldClassifier(fakeProvider(() => new Error("timeout")));
    expect(await failing.classify(field("Where do you work today?"))).toMatchObject({ mappedField: "unknown", method: "heuristic" });
    expect(failing.stats).toMatchObject({ failures: 1, lastError: "timeout" });
    // A response outside the schema is a failure, not a mapping.
    const bad = new AIFieldClassifier(fakeProvider(() => answer("masterProfile.salary", 90)));
    expect(await bad.classify(field("Where do you work today?"))).toMatchObject({ mappedField: "unknown" });
  });

  it("feeds the review threshold: an AI-only mapping below it goes to review with the reason", async () => {
    const classifier = new AIFieldClassifier(fakeProvider(() => answer("masterProfile.currentCompany", 70)));
    const resolver = new FieldResolver({
      profile: { email: "jordan@example.com", employment: [{ company: "Brightwave", title: "AE", startDate: "2022-01-01", isCurrent: true }], education: [] },
      library: [], stored: [], documents: {}, fieldConfidenceThreshold: 85, answerConfidenceThreshold: 85, classifier,
    });
    const m = await resolver.resolve(field("Where do you work today?"));
    expect(m).toMatchObject({ value: "Brightwave", confidence: 70, status: "NEEDS_REVIEW", mappedBy: "ai" });
    expect(m.reviewReason).toBe("Filled with your current company at 70% confidence (AI: Label asks for it), below your 85% review threshold.");
  });
});

describe("AIAnswerDrafter", () => {
  const context = { profile: PROFILE, job: JOB, library: [{ question: "Why sales?", answer: "I like helping finance teams buy well." }, { question: "Gender", answer: "Female", isSensitive: true }] };

  it("drafts from profile facts and saved answers, never sensitive ones", async () => {
    const provider = fakeProvider(() => ({ answerable: true, answer: "At Brightwave I run demos for mid-market finance teams.", basedOn: "your role at Brightwave", confidence: 80 }));
    const drafter = new AIAnswerDrafter(provider, context);
    const draft = await drafter.draft(field("Describe your experience selling to finance teams", { kind: "textarea" }));
    expect(draft).toEqual({ value: "At Brightwave I run demos for mid-market finance teams.", confidence: 80, basis: "your role at Brightwave" });
    expect(provider.calls[0]!.jsonSchema).toBe(ANSWER_DRAFT_JSON_SCHEMA);
    const prompt = provider.calls[0]!.messages[1]!.content;
    expect(prompt).toContain("I like helping finance teams buy well.");
    expect(prompt).not.toContain("Female");
  });

  it("returns nothing when the model declines, invents facts, or picks a non-option", async () => {
    const declined = new AIAnswerDrafter(fakeProvider(() => ({ answerable: false, answer: "", basedOn: "", confidence: 0 })), context);
    expect(await declined.draft(field("Describe a project you led"))).toBeNull();
    const invented = new AIAnswerDrafter(fakeProvider(() => ({ answerable: true, answer: "I led a Kubernetes migration at Google.", basedOn: "x", confidence: 90 })), context);
    expect(await invented.draft(field("Describe a project you led"))).toBeNull();
    const offList = new AIAnswerDrafter(fakeProvider(() => ({ answerable: true, answer: "Maybe", basedOn: "x", confidence: 90 })), context);
    expect(await offList.draft(field("Preferred team", { kind: "select", options: ["Mid-market", "Enterprise"] }))).toBeNull();
  });

  it("never asks the model about legal status, demographics, pay or availability", async () => {
    const provider = fakeProvider(() => ({ answerable: true, answer: "Yes", basedOn: "x", confidence: 99 }));
    const drafter = new AIAnswerDrafter(provider, context);
    for (const label of ["Are you authorized to work in the US?", "Do you require visa sponsorship?", "What is your gender?", "Desired salary", "When are you available to start?", "Are you willing to relocate?"]) {
      expect(await drafter.draft(field(label))).toBeNull();
    }
    expect(provider.calls).toHaveLength(0);
  });
});

describe("createApplicationAI", () => {
  it("uses the heuristic classifier and no drafter without a provider", () => {
    const ai = createApplicationAI({ provider: "none" }, { profile: PROFILE, job: JOB, library: [] });
    expect(ai.info).toMatchObject({ method: "heuristic", reason: "No AI provider is configured" });
    expect(ai.drafter).toBeNull();
  });
});
