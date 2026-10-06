import { describe, expect, it } from "vitest";
import { DEFAULT_MATCH_WEIGHTS, type MatchDimension } from "@autoapply/shared";
import { scoreMatch, titleSimilarity, locationMatches, degreeLevel, companyMatches } from "../src";
import { analysis, profile } from "./helpers";

const prefs = { preferredLocations: ["NYC", "Remote"], workArrangements: [], minSalary: 70000 };
const now = new Date("2026-10-06T00:00:00Z");
const dim = (r: ReturnType<typeof scoreMatch>, d: MatchDimension) => r.breakdown.find((b) => b.dimension === d)!;

describe("scoreMatch", () => {
  const job = { title: "Business Development Representative", location: "New York, NY", analysis: analysis() };
  const result = scoreMatch(job, profile(), prefs, DEFAULT_MATCH_WEIGHTS, now);

  it("scores a strong match highly with every dimension explained", () => {
    expect(result.breakdown.map((b) => b.dimension)).toEqual(["skills", "experience", "education", "location", "industry", "roleAlignment", "compensation"]);
    for (const b of result.breakdown) expect(b.reason.length).toBeGreaterThan(5);
    expect(result.score).toBeGreaterThanOrEqual(85);
    // The score is the weighted sum of the breakdown.
    expect(result.score).toBe(Math.round(result.breakdown.reduce((n, b) => n + b.weight * b.score, 0)));
  });

  it("explains skills with matched and missing lists (aliases count)", () => {
    const skills = dim(result, "skills");
    expect(skills.score).toBe(0.75);
    expect(skills.reason).toBe("You have 3 of the 4 skills it mentions.");
    expect(skills.details).toEqual(["You have: Salesforce, Cold calling, Prospecting", "Not in your profile: HubSpot"]);
  });

  it("matches abbreviated target titles and NYC to New York", () => {
    expect(dim(result, "roleAlignment")).toMatchObject({ score: 1, known: true });
    expect(dim(result, "location").reason).toContain("preferred locations (NYC)");
    expect(dim(result, "industry").score).toBe(1);
  });

  it("partially credits a range that only reaches the minimum at the top", () => {
    expect(dim(result, "compensation")).toMatchObject({ score: 0.8 });
    expect(dim(result, "compensation").reason).toContain("top of the range");
  });

  it("gives neutral credit and marks unknown dimensions", () => {
    const thin = scoreMatch(
      { title: "Account Executive", location: null, analysis: analysis({ hasDescription: false, skills: [], experienceYearsMin: null, seniority: null, education: null, industry: null, salary: null, workArrangement: "UNKNOWN", location: null }) },
      profile(),
      prefs,
      DEFAULT_MATCH_WEIGHTS,
      now,
    );
    for (const d of ["skills", "experience", "education", "location", "industry", "compensation"] as const) {
      expect(dim(thin, d)).toMatchObject({ score: 0.5, known: false });
    }
    expect(dim(thin, "roleAlignment")).toMatchObject({ score: 1, known: true });
  });

  it("penalizes missing experience proportionally", () => {
    const r = scoreMatch({ ...job, analysis: analysis({ experienceYearsMin: 5 }) }, profile({ yearsExperience: 2 }), prefs, DEFAULT_MATCH_WEIGHTS, now);
    expect(dim(r, "experience")).toMatchObject({ score: 0.4, reason: "5 years required; you have 2." });
  });

  it("computes experience from employment history when years aren't stated", () => {
    const r = scoreMatch(
      { ...job, analysis: analysis({ experienceYearsMin: 3 }) },
      profile({ yearsExperience: null, employment: [{ title: "SDR", startDate: "2022-10-06", endDate: null, isCurrent: true, skills: [] }] }),
      prefs,
      DEFAULT_MATCH_WEIGHTS,
      now,
    );
    expect(dim(r, "experience").score).toBe(1);
  });

  it("scores zero compensation for commission-only roles", () => {
    const r = scoreMatch({ ...job, analysis: analysis({ commissionOnly: true }) }, profile(), prefs, DEFAULT_MATCH_WEIGHTS, now);
    expect(dim(r, "compensation")).toMatchObject({ score: 0, reason: "Pay is commission-only." });
  });

  it("respects excluded work arrangements and unknown locations", () => {
    const r = scoreMatch(job, profile(), { ...prefs, workArrangements: ["REMOTE"] }, DEFAULT_MATCH_WEIGHTS, now);
    expect(dim(r, "location").score).toBe(0.3);
    const remote = scoreMatch({ ...job, location: "San Francisco, CA", analysis: analysis({ workArrangement: "REMOTE" }) }, profile(), prefs, DEFAULT_MATCH_WEIGHTS, now);
    expect(dim(remote, "location").score).toBe(1);
    const far = scoreMatch({ ...job, location: "Austin, TX", analysis: analysis({ workArrangement: "ONSITE" }) }, profile(), prefs, DEFAULT_MATCH_WEIGHTS, now);
    expect(dim(far, "location").score).toBe(0);
  });

  it("uses the configured weights", () => {
    const skillsOnly = { skills: 100, experience: 0, education: 0, location: 0, industry: 0, roleAlignment: 0, compensation: 0 };
    expect(scoreMatch(job, profile(), prefs, skillsOnly, now).score).toBe(75);
  });

  it("requires degree evidence before giving education credit", () => {
    const noDegree = scoreMatch({ ...job, analysis: analysis({ education: { level: "BACHELOR", text: "", equivalentExperienceAccepted: false } }) }, profile({ education: [] }), prefs, DEFAULT_MATCH_WEIGHTS, now);
    expect(dim(noDegree, "education").score).toBe(0);
    const masters = scoreMatch({ ...job, analysis: analysis({ education: { level: "MASTER", text: "", equivalentExperienceAccepted: false } }) }, profile(), prefs, DEFAULT_MATCH_WEIGHTS, now);
    expect(dim(masters, "education").score).toBe(0.3);
  });
});

describe("normalizers", () => {
  it("title similarity ignores seniority and expands abbreviations", () => {
    expect(titleSimilarity("Sr. Account Executive", "Account Executive")).toBe(1);
    expect(titleSimilarity("SDR", "Business Development Representative")).toBe(1);
    expect(titleSimilarity("Enterprise Account Executive - NYC", "AE")).toBe(0.85);
    expect(titleSimilarity("Software Engineer", "Account Executive")).toBe(0);
  });

  it("location matching handles aliases and states", () => {
    expect(locationMatches("New York, NY", "NYC")).toBe(true);
    expect(locationMatches("Austin, TX", "Texas")).toBe(true);
    expect(locationMatches("San Francisco Bay Area", "SF")).toBe(true);
    expect(locationMatches("Portland, OR", "Oregon")).toBe(true);
    expect(locationMatches("Newark, NJ", "New York")).toBe(false);
    expect(locationMatches("Los Angeles, CA", "LA")).toBe(true);
  });

  it("degree levels from free text", () => {
    expect(degreeLevel("Bachelor of Science")).toBe("BACHELOR");
    expect(degreeLevel("MBA")).toBe("MASTER");
    expect(degreeLevel("Ph.D.")).toBe("DOCTORATE");
    expect(degreeLevel("Certificate")).toBeNull();
  });

  it("company names ignore legal suffixes", () => {
    expect(companyMatches("Acme, Inc.", "acme")).toBe(true);
    expect(companyMatches("Acme Labs", "Acme Corp")).toBe(true);
    expect(companyMatches("Acmeco", "Acme")).toBe(false);
  });
});
