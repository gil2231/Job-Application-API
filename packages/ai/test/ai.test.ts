import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeJobWithAI, createJobAnalyzer, JOB_ANALYSIS_JSON_SCHEMA, type AIProvider, type CompletionRequest } from "../src";
import { BDR_POSTING } from "./fixtures";

const input = { title: "Business Development Representative", company: "Acme", location: "New York, NY", description: BDR_POSTING, platform: "GREENHOUSE" as const, knownSkills: ["Outreach"] };

const answer = {
  department: "Sales",
  seniority: "ENTRY",
  workArrangement: "HYBRID",
  employmentType: "FULL_TIME",
  commissionOnly: false,
  salaryText: "$65,000 - $75,000 per year",
  requiredQualifications: ["1+ years in sales", "Bachelor's degree or equivalent"],
  preferredQualifications: ["SaaS selling to finance teams"],
  experienceYearsMin: 1,
  educationLevel: "BACHELOR",
  educationText: "Bachelor's degree or equivalent experience",
  equivalentExperienceAccepted: true,
  skills: ["Salesforce", "Cold Calling", "Postgres"],
  industry: "Financial software",
  sponsorshipAvailable: false,
  sponsorshipText: "We are unable to sponsor visas for this role.",
  travelRequired: true,
  travelPercent: 10,
  travelText: "Travel up to 10% for team events.",
};

function fakeProvider(respond: (req: CompletionRequest) => string | Promise<string>): AIProvider & { calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = [];
  return {
    id: "fake",
    model: "fake-model",
    calls,
    async complete(req) {
      calls.push(req);
      return { text: await respond(req), model: "fake-model-1" };
    },
  };
}

describe("analyzeJobWithAI", () => {
  it("uses the model's structured answer and sends the schema", async () => {
    const provider = fakeProvider(() => JSON.stringify(answer));
    const a = await analyzeJobWithAI(provider, input);
    expect(provider.calls[0]!.jsonSchema).toBe(JOB_ANALYSIS_JSON_SCHEMA);
    expect(provider.calls[0]!.messages[1]!.content).toContain("<posting>");
    expect(a.method).toBe("ai");
    expect(a.model).toBe("fake-model-1");
    expect(a.industry).toBe("Financial software");
    expect(a.requiredQualifications).toEqual(answer.requiredQualifications);
    expect(a.education).toEqual({ level: "BACHELOR", text: answer.educationText, equivalentExperienceAccepted: true });
    // Salary is re-parsed deterministically.
    expect(a.salary).toMatchObject({ min: 65000, max: 75000, annualMax: 75000 });
    // Aliases are canonicalized and the user's own skills found in the text are kept.
    expect(a.skills).toEqual(expect.arrayContaining(["Salesforce", "Cold calling", "PostgreSQL", "Outreach"]));
    expect(a.platform).toBe("GREENHOUSE");
  });

  it("falls back to the heuristic analyzer when the provider fails", async () => {
    const provider = fakeProvider(() => {
      throw new Error("rate limited");
    });
    const a = await analyzeJobWithAI(provider, input);
    expect(a.method).toBe("heuristic");
    expect(a.fallbackReason).toBe("rate limited");
    expect(a.salary?.max).toBe(75000);
  });

  it("falls back when the answer doesn't validate", async () => {
    const a = await analyzeJobWithAI(fakeProvider(() => JSON.stringify({ ...answer, seniority: "WIZARD" })), input);
    expect(a.method).toBe("heuristic");
    expect(a.fallbackReason).toBeTruthy();
  });

  it("skips the model when there is no description", async () => {
    const provider = fakeProvider(() => JSON.stringify(answer));
    const a = await analyzeJobWithAI(provider, { ...input, description: null });
    expect(provider.calls).toHaveLength(0);
    expect(a.hasDescription).toBe(false);
  });
});

describe("createJobAnalyzer", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the built-in analyzer when no provider is configured", async () => {
    vi.stubEnv("AI_PROVIDER", "");
    const analyzer = createJobAnalyzer();
    expect(analyzer.info).toMatchObject({ method: "heuristic", reason: "No AI provider is configured" });
    const a = await analyzer.analyze(input);
    expect(a.method).toBe("heuristic");
  });

  it("reports a missing API key instead of failing", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const analyzer = createJobAnalyzer({ provider: "anthropic" });
    expect(analyzer.info).toMatchObject({ method: "heuristic", reason: "ANTHROPIC_API_KEY is not set" });
  });

  it("reports an unknown provider", () => {
    expect(createJobAnalyzer({ provider: "nope" }).info.reason).toContain("not installed");
  });

  it("uses Claude when a key is present", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    const analyzer = createJobAnalyzer({ provider: "anthropic" });
    expect(analyzer.info).toMatchObject({ method: "ai", provider: "anthropic", model: "claude-opus-5-5" });
  });
});
