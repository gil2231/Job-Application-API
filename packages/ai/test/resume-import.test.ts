import { describe, expect, it } from "vitest";
import { findDateRange, groundDraft, parseDate, parseResumeText, readResume, RESUME_JSON_SCHEMA } from "../src";
import { ENGINEER_RESUME, INJECTION_RESUME, SALES_RESUME } from "./resume-fixtures";
import { fakeProvider } from "./writing-fixtures";

describe("resume dates", () => {
  it("reads the ways resumes write dates", () => {
    expect(parseDate("Jan 2022")).toEqual({ value: "2022-01", monthKnown: true });
    expect(parseDate("September 2019")).toEqual({ value: "2019-09", monthKnown: true });
    expect(parseDate("03/2021")).toEqual({ value: "2021-03", monthKnown: true });
    expect(parseDate("2018")).toEqual({ value: "2018-01", monthKnown: false });
    expect(findDateRange("Jun 2019 – Present")).toMatchObject({ start: { value: "2019-06" }, end: null, isCurrent: true });
    expect(findDateRange("2016 to 2020")).toMatchObject({ start: { value: "2016-01" }, end: { value: "2020-01", monthKnown: false } });
  });
});

describe("parseResumeText (built-in parser)", () => {
  it("reads a pipe-separated sales resume", () => {
    const draft = parseResumeText(SALES_RESUME);
    expect(draft.personal).toMatchObject({
      firstName: "Jane",
      lastName: "Doe",
      email: "jane.doe@example.com",
      phone: "(512) 555-0147",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      country: null,
      linkedinUrl: "https://linkedin.com/in/janedoe",
    });
    expect(draft.summary).toMatch(/^Quota-carrying SaaS seller/);
    expect(draft.currentTitle).toBe("Senior Account Executive");
    expect(draft.employment).toHaveLength(2);
    expect(draft.employment[0]).toMatchObject({
      company: "Northwind Software Inc.",
      title: "Senior Account Executive",
      startDate: "2022-01",
      isCurrent: true,
      monthsKnown: true,
      achievements: ["Closed $1.2M in new ARR in 2023, 128% of quota"],
    });
    // A bullet wrapped onto two lines is one bullet.
    expect(draft.employment[0]!.responsibilities).toContain("Mentor two SDRs on cold calling and objection handling");
    expect(draft.employment[1]).toMatchObject({ company: "Contoso Ltd", title: "Sales Development Representative", location: "Austin, TX", endDate: "2021-12" });
    expect(draft.education).toEqual([
      expect.objectContaining({ school: "University of Texas at Austin", degree: "Bachelor of Business Administration", major: "Marketing", gpa: 3.6, gpaScale: 4, graduationDate: "2019-05" }),
    ]);
    expect(draft.skills).toEqual({
      skills: ["Prospecting", "Negotiation", "Solution selling"],
      software: ["Salesforce", "HubSpot", "Outreach", "Gong"],
      technicalSkills: [],
      languages: ["English (native)", "Spanish (professional)"],
    });
  });

  it("reads a resume with the company above the title and dates", () => {
    const draft = parseResumeText(ENGINEER_RESUME);
    expect(draft.personal).toMatchObject({ firstName: "Alex", lastName: "Kim", githubUrl: "https://github.com/alexkim", websiteUrl: "https://alexkim.dev", city: "Seattle", state: "Washington" });
    expect(draft.employment[0]).toMatchObject({ company: "Acme Robotics", title: "Software Engineer II", location: "Seattle, WA", startDate: "2021-03", isCurrent: true });
    expect(draft.employment[1]).toMatchObject({ company: "Globex Corporation", title: "Software Engineering Intern", monthsKnown: false });
    expect(draft.education[0]).toMatchObject({ school: "University of Washington", degree: "B.S.", major: "Computer Science", minor: "Mathematics", startDate: "2016-01", graduationDate: "2020-01", monthsKnown: false });
    expect(draft.skills.technicalSkills).toEqual(["Python", "TypeScript", "Go", "PostgreSQL", "Kafka", "Docker", "Kubernetes"]);
  });

  it("never adds a value that isn't in the resume", () => {
    for (const resume of [SALES_RESUME, ENGINEER_RESUME, INJECTION_RESUME]) {
      const draft = parseResumeText(resume);
      expect(groundDraft(draft, resume).removed).toEqual([]);
    }
    const draft = parseResumeText(INJECTION_RESUME);
    expect(draft.education).toEqual([expect.objectContaining({ school: "State College", degree: "BA", major: "History" })]);
    // Text in the resume stays text: it doesn't become a degree.
    expect(draft.education.map((e) => e.degree)).toEqual(["BA"]);
    expect(draft.personal.country).toBeNull();
  });

  it("leaves an unstructured resume's fields empty instead of guessing", () => {
    const draft = parseResumeText("Pat Morgan\npat@example.com\nI have done many things over the years and would love to talk.");
    expect(draft.personal).toMatchObject({ firstName: "Pat", lastName: "Morgan", email: "pat@example.com" });
    expect(draft.employment).toEqual([]);
    expect(draft.education).toEqual([]);
  });
});

const aiAnswer = (overrides: Record<string, unknown> = {}) => ({
  personal: {
    firstName: "Jane",
    lastName: "Doe",
    email: "jane.doe@example.com",
    phone: null,
    city: "Austin",
    state: "TX",
    postalCode: "78701",
    country: "United States",
    linkedinUrl: "https://www.linkedin.com/in/janedoe",
    githubUrl: null,
    portfolioUrl: null,
    websiteUrl: null,
  },
  summary: "Quota-carrying SaaS seller with five years of experience in outbound prospecting and closing mid-market deals.",
  skills: ["Prospecting", "Negotiation", "Leadership"],
  software: ["Salesforce", "HubSpot"],
  technicalSkills: [],
  languages: ["Spanish (professional)"],
  employment: [
    {
      company: "Northwind Software Inc.",
      title: "Senior Account Executive",
      location: null,
      startDate: "2022-01",
      endDate: null,
      isCurrent: true,
      monthsWritten: true,
      bullets: ["Closed $1.2M in new ARR in 2023, 128% of quota", "Exceeded quota every quarter by 150%", "Run discovery calls and product demos for mid-market accounts"],
    },
    {
      company: "Oracle",
      title: "Account Executive",
      location: null,
      startDate: "2017-01",
      endDate: "2019-01",
      isCurrent: false,
      monthsWritten: true,
      bullets: [],
    },
  ],
  education: [
    {
      school: "University of Texas at Austin",
      degree: "Bachelor of Business Administration",
      major: "Marketing",
      minor: null,
      gpa: 3.9,
      gpaScale: 4,
      startDate: null,
      graduationDate: "2019-05",
      monthsWritten: true,
    },
  ],
  ...overrides,
});

describe("readResume", () => {
  it("uses the built-in parser when no AI is configured", async () => {
    const reading = await readResume(SALES_RESUME, { provider: null });
    expect(reading.method).toBe("builtin");
    expect(reading.fallbackReason).toBeUndefined();
    expect(reading.draft.employment).toHaveLength(2);
  });

  it("keeps the model's values only where the resume says them", async () => {
    const provider = fakeProvider(() => aiAnswer());
    const reading = await readResume(SALES_RESUME, { provider });
    expect(reading.method).toBe("ai");
    expect(reading.model).toBe("fake-model");
    expect(provider.calls[0]!.jsonSchema).toBe(RESUME_JSON_SCHEMA);
    // The resume text is sent as data.
    expect(provider.calls[0]!.messages[1]!.content).toContain("<resume>");

    const { draft, removed } = reading;
    expect(draft.personal.country).toBeNull();
    expect(draft.personal.linkedinUrl).toBe("https://www.linkedin.com/in/janedoe");
    // The model missed the phone; the pattern match fills it in.
    expect(draft.personal.phone).toBe("(512) 555-0147");
    expect(draft.skills.skills).toEqual(["Prospecting", "Negotiation"]);
    expect(draft.employment.map((e) => e.company)).toEqual(["Northwind Software Inc."]);
    expect(draft.employment[0]!.achievements).toEqual(["Closed $1.2M in new ARR in 2023, 128% of quota"]);
    expect(draft.employment[0]!.responsibilities).toEqual(["Run discovery calls and product demos for mid-market accounts"]);
    expect(draft.education[0]!.gpa).toBeNull();
    expect(removed).toEqual(
      expect.arrayContaining([
        'country "United States"',
        'skill "Leadership"',
        'bullet "Exceeded quota every quarter by 150%"',
        'employer "Oracle"',
        'GPA "3.9"',
      ]),
    );
  });

  it("marks a month the resume doesn't write as one to check", async () => {
    const answer = aiAnswer();
    (answer.employment as Array<{ startDate: string }>)[0]!.startDate = "2022-03";
    const reading = await readResume(SALES_RESUME, { provider: fakeProvider(() => answer) });
    expect(reading.draft.employment[0]).toMatchObject({ startDate: "2022-03", monthsKnown: false });
  });

  it("falls back to the built-in parser when the model fails or answers badly", async () => {
    const failed = await readResume(SALES_RESUME, { provider: fakeProvider(() => new Error("timeout")) });
    expect(failed).toMatchObject({ method: "builtin", fallbackReason: "The AI provider couldn't read this resume" });
    expect(failed.draft.employment).toHaveLength(2);
    const malformed = await readResume(SALES_RESUME, { provider: fakeProvider(() => "not json") });
    expect(malformed.method).toBe("builtin");
  });

  it("says why when AI was asked for but isn't available", async () => {
    const reading = await readResume(SALES_RESUME, { ai: { provider: "missing-provider" } });
    expect(reading).toMatchObject({ method: "builtin", fallbackReason: 'AI provider "missing-provider" is not installed' });
  });
});
