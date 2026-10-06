import { describe, expect, it } from "vitest";
import type { FieldMapping } from "../src/fields";
import { decideSubmission, findContradictions, type SubmissionCheck } from "../src/safety";

const mapping = (overrides: Partial<FieldMapping> = {}): FieldMapping => ({
  field: { label: "Email", kind: "email", required: true, pageIndex: 0, locators: [] },
  detectedLabel: "Email",
  mappedField: "masterProfile.email",
  value: "j@example.com",
  confidence: 95,
  source: "profile",
  status: "ANSWERED",
  autoSubmitAllowed: true,
  ...overrides,
});

const check = (overrides: Partial<SubmissionCheck> = {}): SubmissionCheck => ({
  mode: "AUTO",
  submitApproved: false,
  autoSubmitEnabled: true,
  platformSupported: true,
  platformLabel: "Generic",
  mappings: [mapping()],
  contradictions: [],
  securityChallenge: false,
  confidenceThreshold: 85,
  ...overrides,
});

describe("decideSubmission", () => {
  it("submits in Auto mode only when every condition holds", () => {
    expect(decideSubmission(check())).toEqual({ action: "submit" });
  });

  it.each([
    [{ autoSubmitEnabled: false }, "auto-submit is turned off"],
    [{ platformSupported: false, platformLabel: "Workday" }, "Workday isn't supported"],
    [{ mappings: [mapping({ autoSubmitAllowed: false, source: "library" })] }, "allowed to be sent without your review"],
    [{ mappings: [mapping({ confidence: 80 })] }, "mapped confidently"],
  ] as Array<[Partial<SubmissionCheck>, string]>)("downgrades Auto to review: %j", (overrides, text) => {
    const decision = decideSubmission(check(overrides));
    expect(decision).toMatchObject({ action: "review", reason: "FINAL_REVIEW" });
    expect(decision.action === "review" && decision.detail).toContain(text);
  });

  it("never submits with unresolved questions or a security check, even when approved", () => {
    expect(decideSubmission(check({ submitApproved: true, mappings: [mapping({ status: "NEEDS_REVIEW" })] }))).toMatchObject({ action: "review", reason: "QUESTION_REVIEW" });
    expect(decideSubmission(check({ submitApproved: true, securityChallenge: true }))).toMatchObject({ action: "review", reason: "CAPTCHA" });
  });

  it("stops on contradictions", () => {
    expect(decideSubmission(check({ contradictions: [{ message: "Sponsorship answers disagree" }] }))).toMatchObject({ action: "review", reason: "CONTRADICTION" });
  });

  it("Review mode stops before submitting; Manual mode hands off; approval submits", () => {
    expect(decideSubmission(check({ mode: "REVIEW" }))).toMatchObject({ action: "review", reason: "FINAL_REVIEW" });
    expect(decideSubmission(check({ mode: "MANUAL" }))).toMatchObject({ action: "hand_off" });
    expect(decideSubmission(check({ mode: "REVIEW", submitApproved: true }))).toEqual({ action: "submit" });
  });
});

describe("findContradictions", () => {
  const profile = { yearsExperience: 4, linkedinUrl: "https://linkedin.com/in/jr", employment: [], education: [] };
  const lib = (questionKey: string, answer: string) => ({ id: questionKey, questionKey, question: questionKey, answer, confidence: 100, autoSubmitAllowed: true, requiresHumanReview: false, isSensitive: false });

  it("finds disagreeing facts", () => {
    const found = findContradictions({
      mappings: [mapping(), mapping({ value: "other@example.com" })],
      profile,
      library: [lib("sponsorship", "Yes, I will need sponsorship"), lib("years_experience", "10"), lib("linkedin_url", "https://linkedin.com/in/someone-else")],
      job: { sponsorshipAvailable: null },
      rule: { requiresSponsorship: false },
    });
    expect(found.map((c) => c.message)).toEqual([
      expect.stringContaining("need visa sponsorship"),
      expect.stringContaining("10 years"),
      expect.stringContaining("LinkedIn"),
      expect.stringContaining("email twice"),
    ]);
  });

  it("flags a job that can't sponsor when the user needs sponsorship", () => {
    expect(findContradictions({ mappings: [], profile, library: [], job: { sponsorshipAvailable: false }, rule: { requiresSponsorship: true } })).toHaveLength(1);
  });

  it("is quiet when everything agrees", () => {
    expect(findContradictions({ mappings: [mapping()], profile, library: [lib("sponsorship", "No"), lib("years_experience", "4"), lib("linkedin_url", "linkedin.com/in/jr/")], job: {}, rule: { requiresSponsorship: false } })).toEqual([]);
  });
});
