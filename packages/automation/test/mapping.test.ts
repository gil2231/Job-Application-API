import { describe, expect, it } from "vitest";
import { assignFieldKeys, displayLabel, HeuristicFieldClassifier, matchStandardQuestion } from "../src/classify";
import type { DetectedField } from "../src/fields";
import { chooseOption, isPlaceholderOption } from "../src/options";
import { FieldResolver, type ResolverInput } from "../src/resolve";

const field = (label: string, extra: Partial<DetectedField> = {}): DetectedField => ({ label, kind: "text", required: true, pageIndex: 0, locators: [{ strategy: "label", value: label }], ...extra });
const classify = (label: string, extra: Partial<DetectedField> = {}) => new HeuristicFieldClassifier().classify(field(label, extra));

describe("field classification", () => {
  it.each([
    ["Mobile Number", "masterProfile.phone"],
    ["Cell Phone", "masterProfile.phone"],
    ["Phone Number *", "masterProfile.phone"],
    ["Telephone", "masterProfile.phone"],
    ["Legal First Name", "masterProfile.firstName"],
    ["Surname", "masterProfile.lastName"],
    ["E-mail address", "masterProfile.email"],
    ["Your LinkedIn profile URL", "masterProfile.linkedinUrl"],
    ["ZIP code", "masterProfile.postalCode"],
    // Labels the ATS adapters meet: Greenhouse, Lever, SmartRecruiters, Ashby.
    ["Location (City)", "masterProfile.city"],
    ["Location", "masterProfile.city"],
    ["Full name✱", "masterProfile.fullName"],
    ["Confirm your email", "masterProfile.email"],
    ["Current company", "masterProfile.currentCompany"],
  ])("%s → %s", (label, key) => {
    expect(classify(label).mappedField).toBe(key);
  });

  it("uses autocomplete and attribute names when the label is vague", () => {
    expect(classify("Given", { hints: { autocomplete: "given-name" } })).toMatchObject({ mappedField: "masterProfile.firstName", confidence: 95 });
    expect(classify("Field 3", { hints: { name: "candidate_email" } })).toMatchObject({ mappedField: "masterProfile.email", confidence: 80 });
  });

  it("doesn't map fields about someone else onto the applicant", () => {
    expect(classify("Reference phone number").mappedField).toBe("unknown");
    expect(classify("Emergency contact name").mappedField).toBe("unknown");
    expect(classify("Company name").mappedField).toBe("unknown");
  });

  it("recognizes standard questions by wording", () => {
    expect(matchStandardQuestion("Are you legally authorized to work in the United States?")).toBe("work_authorization");
    expect(matchStandardQuestion("Will you now or in the future require visa sponsorship?")).toBe("sponsorship");
    expect(matchStandardQuestion("What are your salary expectations?")).toBe("salary_expectations");
    expect(matchStandardQuestion("Are you willing to relocate?")).toBe("relocation");
    expect(matchStandardQuestion("Preferred city to relocate to")).toBeNull();
    expect(classify("What are your salary expectations?")).toMatchObject({ mappedField: "answer.library", questionKey: "salary_expectations" });
  });

  it("recognizes military service questions, separately from veteran self-identification", () => {
    expect(matchStandardQuestion("Are you an active military member?")).toBe("military_status");
    expect(matchStandardQuestion("Are you currently serving in the U.S. Armed Forces?")).toBe("military_status");
    expect(matchStandardQuestion("Have you served in the military?")).toBe("military_status");
    expect(matchStandardQuestion("Are you on active duty or a member of the National Guard or Reserves?")).toBe("military_status");
    expect(matchStandardQuestion("Military status")).toBe("military_status");
    expect(matchStandardQuestion("Veteran status")).toBe("demographic_veteran");
    expect(matchStandardQuestion("Are you a protected veteran or active duty military member?")).toBe("demographic_veteran");
    expect(matchStandardQuestion("Is your spouse an active duty military member?")).toBeNull();
    expect(classify("Are you an active military member?")).toMatchObject({ mappedField: "answer.library", questionKey: "military_status" });
  });

  it("classifies uploads", () => {
    expect(classify("Resume/CV", { kind: "file" }).mappedField).toBe("documents.resume");
    expect(classify("Cover Letter", { kind: "file" }).mappedField).toBe("documents.coverLetter");
    expect(classify("Writing sample", { kind: "file" }).mappedField).toBe("unknown");
  });

  it("gives duplicate labels distinct keys", () => {
    expect(assignFieldKeys([field("Phone"), field("Phone")]).map((f) => f.key)).toEqual(["phone", "phone_2"]);
  });
});

describe("option matching", () => {
  it.each([
    ["United States", ["Canada", "United States of America"], "United States of America"],
    ["NY", ["California", "New York"], "New York"],
    ["New York", ["CA", "NY"], "NY"],
    ["4", ["Less than 1 year", "1-2 years", "3-5 years", "6-10 years"], "3-5 years"],
    ["12", ["1-5", "6-10", "10+ years"], "10+ years"],
    ["Yes", ["Yes, I am authorized", "No, I am not authorized"], "Yes, I am authorized"],
    ["No", ["Yes", "No"], "No"],
    ["Bachelor's", ["High school", "Bachelor's Degree", "Master's Degree"], "Bachelor's Degree"],
  ])("%s in %j → %s", (value, options, expected) => {
    expect(chooseOption(value, options)?.option).toBe(expected);
  });

  it("refuses ambiguous or missing matches", () => {
    expect(chooseOption("Purple", ["Red", "Blue"])).toBeNull();
    expect(chooseOption("Degree", ["Bachelor's Degree", "Master's Degree"])).toBeNull();
    expect(isPlaceholderOption("Select…")).toBe(true);
    expect(chooseOption("Select…", ["Select…", "A"])).toBeNull();
  });
});

describe("FieldResolver", () => {
  const base: ResolverInput = {
    profile: { firstName: "Jordan", lastName: "Rivera", email: "j@example.com", phone: "212-555-0100", country: "United States", state: "NY", yearsExperience: 4, employment: [], education: [] },
    library: [
      { id: "a1", questionKey: "work_authorization", question: "Authorized?", answer: "Yes", confidence: 100, autoSubmitAllowed: true, requiresHumanReview: false, isSensitive: false },
      { id: "a2", questionKey: "salary_expectations", question: "Salary?", answer: "$70,000–$80,000", confidence: 90, autoSubmitAllowed: false, requiresHumanReview: true, isSensitive: false },
      { id: "a3", questionKey: "relocation", question: "Relocate?", answer: "Yes", confidence: 100, autoSubmitAllowed: true, requiresHumanReview: false, isSensitive: false },
    ],
    stored: [],
    documents: { resume: { fileName: "resume.pdf" } },
    fieldConfidenceThreshold: 85,
    answerConfidenceThreshold: 85,
  };
  const resolve = (f: DetectedField, input: Partial<ResolverInput> = {}) => new FieldResolver({ ...base, ...input }).resolve({ ...f, key: f.key ?? f.label.toLowerCase().replace(/\W+/g, "_") });

  it("fills profile fields with high confidence", async () => {
    expect(await resolve(field("Mobile Number"))).toMatchObject({ mappedField: "masterProfile.phone", value: "212-555-0100", status: "ANSWERED", source: "profile", confidence: 95 });
  });

  it("flags a required field the profile doesn't have, without inventing a value", async () => {
    expect(await resolve(field("Street address"))).toMatchObject({ status: "NEEDS_REVIEW", value: null, reviewReason: expect.stringContaining("street address") });
    expect(await resolve(field("Street address", { required: false }))).toMatchObject({ status: "SKIPPED", value: null });
  });

  it("uses library answers and respects their review flags", async () => {
    const radio = field("Are you legally authorized to work in the US?", { kind: "radio", options: ["Yes", "No"] });
    expect(await resolve(radio)).toMatchObject({ value: "Yes", status: "ANSWERED", source: "library", libraryAnswerId: "a1", autoSubmitAllowed: true });
    expect(await resolve(field("What are your salary expectations?"))).toMatchObject({ value: "$70,000–$80,000", status: "NEEDS_REVIEW", autoSubmitAllowed: false });
  });

  it("never guesses unknown required questions and skips unknown optional ones", async () => {
    expect(await resolve(field("Favorite color"))).toMatchObject({ mappedField: "unknown", status: "NEEDS_REVIEW", value: null });
    expect(await resolve(field("Favorite color", { required: false }))).toMatchObject({ status: "SKIPPED" });
  });

  it("puts a yes/no answer only where a yes/no question is asked", async () => {
    expect(await resolve(field("Are you willing to relocate?", { kind: "radio", options: ["Yes", "No"] }))).toMatchObject({ value: "Yes", status: "ANSWERED" });
    expect(await resolve(field("Relocation", { kind: "textarea" }))).toMatchObject({ status: "NEEDS_REVIEW" });
  });

  it("uses the user's approved answer and honors their skips", async () => {
    const f = field("Favorite color", { key: "favorite_color" });
    const approved = { pageIndex: 0, normalizedKey: "favorite_color", status: "APPROVED" as const, answer: { value: "Green", approvedByUser: true } };
    expect(await resolve(f, { stored: [approved] })).toMatchObject({ value: "Green", status: "ANSWERED", source: "user", confidence: 100 });
    expect(await resolve(f, { stored: [{ ...approved, status: "SKIPPED" }] })).toMatchObject({ status: "SKIPPED", value: null });
  });

  it("maps values onto dropdown options and flags ones that don't fit", async () => {
    expect(await resolve(field("Country", { kind: "select", options: ["Select…", "Canada", "United States of America"] }))).toMatchObject({ value: "United States of America", status: "ANSWERED" });
    expect(await resolve(field("Country", { kind: "select", options: ["France", "Germany"] }))).toMatchObject({ status: "NEEDS_REVIEW", reviewReason: expect.stringContaining("doesn't match") });
  });

  it("requires a resume upload when the form needs one and none is on file", async () => {
    expect(await resolve(field("Resume", { kind: "file" }), { documents: {} })).toMatchObject({ status: "NEEDS_REVIEW", reviewReason: expect.stringContaining("requires a resume") });
    expect(await resolve(field("Resume", { kind: "file" }))).toMatchObject({ status: "ANSWERED", value: "resume.pdf" });
  });

  it("sends low-confidence mappings to review", async () => {
    expect(await resolve(field("Field 3", { hints: { name: "phone" } }))).toMatchObject({ mappedField: "masterProfile.phone", confidence: 80, status: "NEEDS_REVIEW" });
    expect(await resolve(field("Field 3", { hints: { name: "phone" } }), { fieldConfidenceThreshold: 75 })).toMatchObject({ status: "ANSWERED" });
  });
});

describe("displayLabel", () => {
  it("drops the required marker for display", () => {
    expect(displayLabel("Email Address *")).toBe("Email Address");
    expect(displayLabel("Phone (required)")).toBe("Phone");
    expect(displayLabel("Full name✱")).toBe("Full name");
    expect(displayLabel("Rate us 5* or more")).toBe("Rate us 5* or more");
    expect(displayLabel("*")).toBe("*");
  });
});
