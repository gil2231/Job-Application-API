import { describe, expect, it } from "vitest";
import { automationRuleSchema, educationSchema, employmentSchema, jobFiltersSchema, manualJobSchema, personalSchema, professionalSchema, signUpSchema } from "../src/schemas";
import { DEFAULT_MATCH_WEIGHTS } from "../src/match-weights";

describe("schemas", () => {
  it("rejects weak passwords", () => {
    expect(signUpSchema.safeParse({ name: "A", email: "a@b.co", password: "short" }).success).toBe(false);
    expect(signUpSchema.safeParse({ name: "A", email: "A@B.co", password: "longenough1" }).data?.email).toBe("a@b.co");
  });
  it("turns blank optional profile fields into null and validates URLs", () => {
    const ok = personalSchema.parse({ firstName: " Ada ", phone: "", linkedinUrl: "" });
    expect(ok).toMatchObject({ firstName: "Ada", phone: null, linkedinUrl: null });
    expect(personalSchema.safeParse({ linkedinUrl: "linkedin.com/in/x" }).success).toBe(false);
  });
  it("splits and de-duplicates list fields", () => {
    expect(professionalSchema.parse({ skills: "Sales, CRM\nsales, Prospecting" }).skills).toEqual(["Sales", "CRM", "Prospecting"]);
  });
  it("requires an end date unless the role is current", () => {
    const base = { company: "Acme", title: "BDR", startDate: "2022-01-01" };
    expect(employmentSchema.safeParse(base).success).toBe(false);
    expect(employmentSchema.safeParse({ ...base, isCurrent: "on" }).success).toBe(true);
    expect(employmentSchema.safeParse({ ...base, endDate: "2021-01-01" }).success).toBe(false);
  });
  it("validates education dates and GPA scale", () => {
    expect(educationSchema.safeParse({ school: "MIT", gpa: "4.5", gpaScale: "4" }).success).toBe(false);
    expect(educationSchema.safeParse({ school: "MIT", gpa: "3.5", gpaScale: "4" }).success).toBe(true);
  });
  it("requires match weights to sum to 100", () => {
    const rule = {
      minMatchScore: 70, preferredLocations: "NYC, Remote", maxApplicationsPerDay: 25, maxConcurrentApplications: 2,
      defaultMode: "REVIEW", matchWeights: DEFAULT_MATCH_WEIGHTS,
    };
    expect(automationRuleSchema.safeParse(rule).success).toBe(true);
    expect(automationRuleSchema.safeParse({ ...rule, matchWeights: { ...DEFAULT_MATCH_WEIGHTS, skills: 30 } }).success).toBe(false);
  });
  it("validates manual jobs", () => {
    expect(manualJobSchema.safeParse({ url: "ftp://x", title: "t", company: "c" }).success).toBe(false);
    expect(manualJobSchema.safeParse({ url: "https://jobs.lever.co/a/b", title: "t", company: "c" }).success).toBe(true);
  });
  it("tolerates garbage in job filters", () => {
    const f = jobFiltersSchema.parse({ minMatch: "abc", status: "QUEUED,BOGUS", sort: "nope", page: "-1" });
    expect(f).toMatchObject({ minMatch: undefined, status: ["QUEUED"], sort: "savedAt", page: 1 });
  });
});
