import { describe, expect, it } from "vitest";
import { assignFieldKeys, displayLabel, HeuristicFieldClassifier, matchStandardQuestion } from "../src/classify";
import type { DetectedField } from "../src/fields";
import { answerParts } from "@autoapply/shared";
import { chooseOption, chooseSuggestion, isPlaceholderOption } from "../src/options";
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

  it("keeps the Hispanic/Latino question apart from race", () => {
    expect(matchStandardQuestion("Are you Hispanic/Latino?")).toBe("demographic_hispanic");
    expect(matchStandardQuestion("Do you identify as Hispanic or Latinx?")).toBe("demographic_hispanic");
    expect(matchStandardQuestion("Race")).toBe("demographic_race");
    expect(matchStandardQuestion("Race/Ethnicity (Hispanic or Latino, White, ...)")).toBe("demographic_race");
  });

  it("doesn't fill a yes/no question with the profile value its wording mentions", () => {
    expect(classify("Will you be able to regularly commute and work in an office in job posting location?", { kind: "select", options: ["Yes", "No"] })).toMatchObject({ mappedField: "answer.library", questionKey: "onsite_work" });
    expect(classify("Are you currently located in the New York City area?").mappedField).toBe("unknown");
    expect(classify("Current location").mappedField).toBe("masterProfile.city");
  });

  it("classifies uploads", () => {
    expect(classify("Resume/CV", { kind: "file" }).mappedField).toBe("documents.resume");
    expect(classify("Cover Letter", { kind: "file" }).mappedField).toBe("documents.coverLetter");
    expect(classify("Writing sample", { kind: "file" }).mappedField).toBe("unknown");
    // Greenhouse labels both uploads only "Attach"; the input's id says which is which.
    expect(classify("Attach", { kind: "file", hints: { id: "resume" } }).mappedField).toBe("documents.resume");
    expect(classify("Attach", { kind: "file", hints: { id: "cover_letter" } }).mappedField).toBe("documents.coverLetter");
    expect(classify("Attach", { kind: "file", hints: { id: "portfolio" } }).mappedField).toBe("unknown");
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

describe("matching saved answers to the choices real forms offer", () => {
  const VETERAN = ["I am not a protected veteran", "I identify as one or more of the classifications of a protected veteran", "I don't wish to answer"];
  const DEGREES = ["Associate's Degree", "Bachelor's Degree", "Doctor of Medicine (M.D.)", "Doctor of Philosophy (Ph.D.)", "Engineer's Degree", "High School", "Juris Doctor (J.D.)", "Master of Business Administration (M.B.A.)", "Master's Degree", "Other"];

  it("reads a veteran answer as no, not as declining", () => {
    expect(chooseOption("Not a current or past veteran", VETERAN)?.option).toBe("I am not a protected veteran");
    expect(chooseOption("Not a current or past veteran", VETERAN.map((o) => o.toUpperCase()))?.option).toBe("I AM NOT A PROTECTED VETERAN");
    expect(chooseOption("Prefer not to say", VETERAN)?.option).toBe("I don't wish to answer");
  });

  it("matches a degree by its level", () => {
    expect(chooseOption("Bachelor of Science", DEGREES)?.option).toBe("Bachelor's Degree");
    expect(chooseOption("BA", DEGREES)?.option).toBe("Bachelor's Degree");
    expect(chooseOption("MS", DEGREES)?.option).toBe("Master's Degree");
  });

  it("picks the suggested place in the person's own state, never a lookalike name", () => {
    const suggestions = ["Bronxville, New York, United States", "Bronx, Idaho, United States", "Bronx, United States"];
    expect(chooseSuggestion("Bronx", suggestions, { state: "NY", country: "United States" })?.option).toBe("Bronx, United States");
    expect(chooseSuggestion("Bronx", ["Bronxville, New York, United States"], { state: "NY" })).toBeNull();
    expect(chooseSuggestion("New York", ["New York, New York, United States", "Newark, New Jersey, United States"], { state: "NY" })?.option).toBe("New York, New York, United States");
    expect(chooseSuggestion("Fordham University", ["Fordham University"])?.option).toBe("Fordham University");
  });

  it.each([
    ["School", "education.school"],
    ["Degree", "education.degree"],
    ["Discipline", "education.major"],
    ["Highest level of education", "education.degree"],
  ])("maps the education field %s", (label, key) => {
    expect(classify(label, { kind: "select" }).mappedField).toBe(key);
  });

  it("keeps school and degree words from claiming other questions", () => {
    expect(classify("Do you have a bachelor's degree?", { kind: "select", options: ["Yes", "No"] }).mappedField).toBe("unknown");
    expect(classify("Name of your college roommate").mappedField).not.toBe("education.school");
  });

  it("splits a group answer on whole choices, even ones with commas", () => {
    const consents = ["By clicking this box and submitting your application, you consent to our Applicant Privacy Statement.", "By clicking this box, you consent to a background check."];
    expect(answerParts(consents[1]!, consents)).toEqual([consents[1]]);
    expect(answerParts(`${consents[0]}, ${consents[1]}`, consents)).toEqual(consents);
    expect(answerParts("Yes", ["Yes", "No"])).toEqual(["Yes"]);
    expect(answerParts("Email, Phone", ["Email", "Phone", "Text"])).toEqual(["Email", "Phone"]);
  });

  it.each([
    ["Are you at least 18 years of age?", "age_18"],
    ["Are you bound by any agreements with a former employer, such as a non-compete, that would restrict your work here?", "restrictive_agreements"],
    ["Are you currently employed by a client or competitor of the company?", "competitor_employment"],
    ["How did you hear about this job?", "how_did_you_hear"],
    ["Applicant Privacy Statement", "privacy_acknowledgement"],
    ["I certify that the information I have provided is true and complete.", "certify_information"],
    ["Are you open to working in person in our San Francisco or New York office 3 times a week?", "onsite_work"],
    ["Are you able to commute to our office in New York?", "onsite_work"],
    ["By checking this box, I consent to Braze collecting, storing, and processing my responses to the demographic data surveys above.", "demographic_data_consent"],
  ])("recognizes %s", (label, key) => {
    expect(matchStandardQuestion(label)).toBe(key);
    expect(classify(label)).toMatchObject({ mappedField: "answer.library", questionKey: key });
  });
});

describe("FieldResolver on checkbox groups and long lists", () => {
  const input: ResolverInput = {
    profile: { firstName: "Gil", lastName: "C", email: "g@example.com", city: "Bronx", state: "NY", employment: [], education: [] },
    library: [{ id: "p1", questionKey: "privacy_acknowledgement", question: "Privacy?", answer: "Yes", confidence: 100, autoSubmitAllowed: true, requiresHumanReview: false, isSensitive: false }],
    stored: [],
    documents: {},
    fieldConfidenceThreshold: 85,
    answerConfidenceThreshold: 85,
  };
  const consents = ["By clicking this box and submitting your application, you consent to our Applicant Privacy Statement.", "By clicking this box and submitting your application, you consent to Example Corp conducting third-party background checks."];
  const group = (label: string, options: string[]) => field(label, { kind: "checkbox", multiple: true, options, key: label.toLowerCase().replace(/\W+/g, "_") });

  it("ticks every consent when the saved answer is yes", async () => {
    expect(await new FieldResolver(input).resolve(group("Applicant Privacy Statement", consents))).toMatchObject({ value: consents, status: "ANSWERED" });
  });

  it("keeps an approved choice that contains commas", async () => {
    const f = group("Applicant Privacy Statement", consents);
    const stored = [{ pageIndex: 0, normalizedKey: f.key!, status: "APPROVED" as const, answer: { value: consents[1]!, approvedByUser: true } }];
    expect(await new FieldResolver({ ...input, stored }).resolve(f)).toMatchObject({ value: [consents[1]], status: "ANSWERED" });
  });

  it("fills a country from the person's US state", async () => {
    expect(await new FieldResolver(input).resolve(field("Country"))).toMatchObject({ value: "United States", status: "ANSWERED" });
  });

  it("searches a cut-off list for the profile's school instead of flagging it", async () => {
    const schools = Array.from({ length: 100 }, (_, i) => `A${i} College`);
    const f = field("School", { kind: "select", options: schools, hints: { widget: "search" } });
    const profile = { ...input.profile, education: [{ school: "Fordham University", degree: "Bachelor of Science" }] } as ResolverInput["profile"];
    expect(await new FieldResolver({ ...input, profile }).resolve(f)).toMatchObject({ value: "Fordham University", status: "ANSWERED" });
  });
});
