import type { JobAnalysis } from "@autoapply/shared";
import type { MatchProfile, QualificationRules } from "../src";

export function analysis(overrides: Partial<JobAnalysis> = {}): JobAnalysis {
  return {
    version: 1,
    method: "heuristic",
    analyzedAt: "2026-10-06T00:00:00.000Z",
    hasDescription: true,
    company: "Acme",
    role: "Business Development Representative",
    department: "Sales",
    seniority: "ENTRY",
    location: "New York, NY",
    workArrangement: "HYBRID",
    employmentType: "FULL_TIME",
    commissionOnly: false,
    salary: { text: "$65,000 - $75,000", min: 65000, max: 75000, currency: "USD", period: "YEAR", annualMin: 65000, annualMax: 75000 },
    requiredQualifications: [],
    preferredQualifications: [],
    experienceYearsMin: 1,
    education: { level: "BACHELOR", text: "Bachelor's degree or equivalent", equivalentExperienceAccepted: true },
    skills: ["Salesforce", "Cold calling", "HubSpot", "Prospecting"],
    industry: "Software",
    sponsorship: { available: null, text: null },
    travel: { required: null, percent: null, text: null },
    platform: "GREENHOUSE",
    ...overrides,
  };
}

export function profile(overrides: Partial<MatchProfile> = {}): MatchProfile {
  return {
    currentTitle: "Sales Development Representative",
    targetTitles: ["BDR", "Account Executive"],
    industries: ["SaaS / Software"],
    yearsExperience: 2,
    city: "Brooklyn",
    state: "NY",
    skills: ["Salesforce", "cold-calling", "Prospecting"],
    education: [{ degree: "B.A.", major: "Economics" }],
    employment: [],
    ...overrides,
  };
}

export const RULES: QualificationRules = {
  minMatchScore: 70,
  minSalary: 70000,
  preferredLocations: ["NYC", "Remote"],
  workArrangements: [],
  employmentTypes: ["FULL_TIME"],
  excludedIndustries: [],
  excludedCompanies: [],
  excludedKeywords: ["commission-only"],
  requiredKeywords: [],
  requiresSponsorship: false,
};
