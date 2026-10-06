import { describe, expect, it } from "vitest";
import { analyzeJobHeuristically, detectSkills, htmlToText } from "../src";
import { detectExperienceYears, detectSeniority, detectSponsorship, detectWorkArrangement, splitSections } from "../src/job-analysis/heuristic";
import { BDR_POSTING, ENGINEER_POSTING_HTML } from "./fixtures";

const now = new Date("2026-10-06T12:00:00Z");

describe("analyzeJobHeuristically: sales posting", () => {
  const a = analyzeJobHeuristically(
    { title: "Business Development Representative", company: "Acme", location: "New York, NY", description: BDR_POSTING, platform: "GREENHOUSE" },
    now,
  );

  it("extracts role facts", () => {
    expect(a.method).toBe("heuristic");
    expect(a.hasDescription).toBe(true);
    expect(a.department).toBe("Sales");
    expect(a.seniority).toBe("ENTRY");
    expect(a.workArrangement).toBe("HYBRID");
    expect(a.employmentType).toBe("FULL_TIME");
    expect(a.platform).toBe("GREENHOUSE");
    expect(a.industry).toBe("Software");
  });

  it("reads salary, experience and education", () => {
    expect(a.salary).toMatchObject({ min: 65000, max: 75000, currency: "USD", period: "YEAR", annualMax: 75000 });
    expect(a.commissionOnly).toBe(false);
    expect(a.experienceYearsMin).toBe(1);
    expect(a.education).toMatchObject({ level: "BACHELOR", equivalentExperienceAccepted: true });
  });

  it("separates required and preferred qualifications", () => {
    expect(a.requiredQualifications).toEqual([
      "1+ years of experience in sales or customer-facing roles",
      "Bachelor's degree or equivalent experience",
      "Excellent written and verbal communication",
      "Experience with Salesforce and Outreach",
    ]);
    expect(a.preferredQualifications).toEqual(["Experience selling SaaS to finance teams", "Familiarity with HubSpot"]);
  });

  it("finds skills, sponsorship and travel", () => {
    expect(a.skills).toEqual(expect.arrayContaining(["Salesforce", "Cold calling", "Cold email", "HubSpot", "Discovery calls"]));
    expect(a.sponsorship.available).toBe(false);
    expect(a.sponsorship.text).toContain("unable to sponsor");
    expect(a.travel).toMatchObject({ required: true, percent: 10 });
  });
});

describe("analyzeJobHeuristically: entity-escaped HTML engineering posting", () => {
  const a = analyzeJobHeuristically({ title: "Senior Software Engineer, Payments", company: "PayCo", description: ENGINEER_POSTING_HTML, platform: "GREENHOUSE" }, now);

  it("parses sections out of HTML", () => {
    expect(a.requiredQualifications).toContain("5+ years of professional software engineering experience");
    expect(a.preferredQualifications).toContain("Experience with Kubernetes");
    expect(a.requiredQualifications).not.toContain("Experience with Kubernetes");
  });

  it("does not treat a preferred degree as required", () => {
    expect(a.education).toBeNull();
  });

  it("extracts the rest", () => {
    expect(a.seniority).toBe("SENIOR");
    expect(a.department).toBe("Engineering");
    expect(a.workArrangement).toBe("REMOTE");
    expect(a.experienceYearsMin).toBe(5);
    expect(a.sponsorship.available).toBe(true);
    expect(a.industry).toBe("Fintech");
    expect(a.skills).toEqual(expect.arrayContaining(["TypeScript", "Node.js", "PostgreSQL", "Kafka", "Kubernetes"]));
    expect(a.salary).toBeNull();
  });
});

describe("analysis without a description", () => {
  it("only reports what the title says and marks the job as lacking a description", () => {
    const a = analyzeJobHeuristically({ title: "Senior Account Executive", company: "Acme", platform: "LINKEDIN_EASY_APPLY" }, now);
    expect(a.hasDescription).toBe(false);
    expect(a.seniority).toBe("SENIOR");
    expect(a.department).toBe("Sales");
    expect(a.requiredQualifications).toEqual([]);
    expect(a.education).toBeNull();
    expect(a.sponsorship.available).toBeNull();
    expect(a.workArrangement).toBe("UNKNOWN");
  });

  it("keeps a user-entered work arrangement", () => {
    const a = analyzeJobHeuristically({ title: "AE", company: "Acme", workArrangement: "REMOTE", description: "Hybrid role in Boston.", platform: "GENERIC" }, now);
    expect(a.workArrangement).toBe("REMOTE");
  });
});

describe("individual detectors", () => {
  it("seniority from titles", () => {
    expect(detectSeniority("VP of Sales", null)).toBe("EXECUTIVE");
    expect(detectSeniority("Sales Director", null)).toBe("DIRECTOR");
    expect(detectSeniority("Engineering Manager", null)).toBe("MANAGER");
    expect(detectSeniority("Account Manager", null)).toBeNull();
    expect(detectSeniority("Account Manager", 3)).toBe("MID");
    expect(detectSeniority("Staff Engineer", null)).toBe("LEAD");
    expect(detectSeniority("Sr. Product Designer", null)).toBe("SENIOR");
    expect(detectSeniority("Software Engineering Intern", null)).toBe("INTERN");
    expect(detectSeniority("SDR", null)).toBe("ENTRY");
  });

  it("work arrangement respects negation", () => {
    expect(detectWorkArrangement("AE", null, "This is not a remote position. You'll work on-site in Austin.")).toBe("ONSITE");
    expect(detectWorkArrangement("AE", "Remote - US", "")).toBe("REMOTE");
    expect(detectWorkArrangement("AE", null, "Our office has free snacks.")).toBe("UNKNOWN");
  });

  it("experience prefers the required section's minimum", () => {
    expect(detectExperienceYears("3-5 years of B2B sales experience", "")).toBe(3);
    expect(detectExperienceYears("", "At least 2 years of relevant experience; 7+ years experience preferred")).toBe(2);
    expect(detectExperienceYears("", "We have 10 years in business.")).toBeNull();
  });

  it("sponsorship phrasing", () => {
    expect(detectSponsorship("Candidates must be authorized to work in the US without sponsorship.").available).toBe(false);
    expect(detectSponsorship("We will not sponsor work visas.").available).toBe(false);
    expect(detectSponsorship("H-1B sponsorship is available for this role.").available).toBe(true);
    expect(detectSponsorship("Great benefits.").available).toBeNull();
  });

  it("does not split a requirement line that merely mentions experience", () => {
    const s = splitSections("Requirements:\nExperience with Salesforce\n5+ years of sales experience");
    expect(s.required).toEqual(["Experience with Salesforce", "5+ years of sales experience"]);
  });

  it("skills include the user's own terms and ignore ambiguous words in prose", () => {
    expect(detectSkills("You will go to market with our team and close deals", [])).not.toContain("Go");
    expect(detectSkills("Experience with Go and gRPC", ["Go", "gRPC"])).toEqual(["Go", "gRPC"]);
    expect(detectSkills("Proficient in C++ and C#; .NET a plus")).toEqual(["C++", "C#", ".NET"]);
  });

  it("htmlToText keeps list items on their own lines", () => {
    expect(htmlToText("<p>Hi</p><ul><li>One</li><li>Two &amp; three</li></ul>")).toBe("Hi\n\n• One\n• Two & three");
  });

  it("flags commission-only pay", () => {
    const a = analyzeJobHeuristically({ title: "Sales Rep", company: "X", description: "This is a 100% commission role with unlimited upside. ".repeat(3), platform: "GENERIC" }, now);
    expect(a.commissionOnly).toBe(true);
  });
});
