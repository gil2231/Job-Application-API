import { describe, expect, it } from "vitest";
import { evaluateRules, type QualificationInput } from "../src";
import { analysis, RULES } from "./helpers";

const base: QualificationInput = {
  title: "Business Development Representative",
  company: "Acme, Inc.",
  location: "New York, NY",
  description: "Great job",
  salaryText: null,
  matchScore: 82,
  analysis: analysis(),
};
const outcome = (r: ReturnType<typeof evaluateRules>, rule: string) => r.checks.find((c) => c.rule === rule)?.outcome;

describe("evaluateRules", () => {
  it("qualifies a job that passes every rule", () => {
    const r = evaluateRules(base, RULES);
    expect(r).toMatchObject({ qualified: true, status: "QUALIFIED" });
    expect(r.checks.every((c) => c.outcome !== "fail")).toBe(true);
    expect(outcome(r, "minSalary")).toBe("pass");
    expect(outcome(r, "location")).toBe("pass");
  });

  it("fails on a low score, salary below minimum, or excluded company", () => {
    expect(evaluateRules({ ...base, matchScore: 60 }, RULES).status).toBe("NOT_QUALIFIED");
    const low = evaluateRules({ ...base, analysis: analysis({ salary: { text: "$50k", min: 45000, max: 50000, currency: "USD", period: "YEAR", annualMin: 45000, annualMax: 50000 } }) }, RULES);
    expect(outcome(low, "minSalary")).toBe("fail");
    const excluded = evaluateRules(base, { ...RULES, excludedCompanies: ["ACME"] });
    expect(excluded.checks.find((c) => c.rule === "excludedCompanies")).toMatchObject({ outcome: "fail", detail: "Acme, Inc. is on your excluded list." });
  });

  it("treats unknowns as unknown, not failures", () => {
    const r = evaluateRules({ ...base, analysis: analysis({ salary: null, employmentType: null }) }, { ...RULES, requiresSponsorship: true });
    expect(outcome(r, "minSalary")).toBe("unknown");
    expect(outcome(r, "employmentType")).toBe("unknown");
    expect(outcome(r, "sponsorship")).toBe("unknown");
    expect(r.status).toBe("QUALIFIED");
  });

  it("fails sponsorship only when the user needs it and the job refuses", () => {
    const refuses = analysis({ sponsorship: { available: false, text: "We can't sponsor." } });
    expect(evaluateRules({ ...base, analysis: refuses }, RULES).status).toBe("QUALIFIED");
    expect(evaluateRules({ ...base, analysis: refuses }, { ...RULES, requiresSponsorship: true }).checks.find((c) => c.rule === "sponsorship")).toMatchObject({
      outcome: "fail",
      detail: "We can't sponsor.",
    });
  });

  it("catches commission-only jobs by keyword or analysis", () => {
    const byText = evaluateRules({ ...base, description: "This is a Commission Only role." }, RULES);
    expect(outcome(byText, "excludedKeywords")).toBe("fail");
    const byAnalysis = evaluateRules({ ...base, analysis: analysis({ commissionOnly: true }) }, RULES);
    expect(outcome(byAnalysis, "excludedKeywords")).toBe("fail");
    expect(outcome(byAnalysis, "minSalary")).toBe("fail");
  });

  it("passes remote jobs on location and fails other cities", () => {
    expect(outcome(evaluateRules({ ...base, location: "Denver, CO", analysis: analysis({ workArrangement: "REMOTE" }) }, RULES), "location")).toBe("pass");
    expect(outcome(evaluateRules({ ...base, location: "Denver, CO" }, RULES), "location")).toBe("fail");
  });

  it("checks excluded industries against the industry, company and title only", () => {
    expect(outcome(evaluateRules({ ...base, analysis: analysis({ industry: "Insurance" }) }, { ...RULES, excludedIndustries: ["insurance"] }), "excludedIndustries")).toBe("fail");
    // A benefits line mentioning insurance doesn't exclude the job.
    expect(
      outcome(evaluateRules({ ...base, description: "Benefits include health insurance." }, { ...RULES, excludedIndustries: ["Insurance"] }), "excludedIndustries"),
    ).toBe("pass");
  });

  it("holds jobs without a description as needing details, not rejected for a provisional score", () => {
    const r = evaluateRules({ ...base, description: null, matchScore: 55, analysis: analysis({ hasDescription: false }) }, RULES);
    expect(r).toMatchObject({ qualified: false, status: "NEEDS_DETAILS" });
    expect(outcome(r, "minMatchScore")).toBe("unknown");
    // A hard rule still rejects it.
    expect(evaluateRules({ ...base, description: null, analysis: analysis({ hasDescription: false }) }, { ...RULES, excludedCompanies: ["Acme"] }).status).toBe("NOT_QUALIFIED");
  });
});
