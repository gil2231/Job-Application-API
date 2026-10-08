import { describe, expect, it } from "vitest";
import { rankRecommendations, type RecommendationCandidate } from "../src";

let n = 0;
const job = (title: string, extra: Partial<RecommendationCandidate> = {}): RecommendationCandidate => ({
  id: `job${++n}`,
  title,
  company: "Acme",
  location: null,
  description: null,
  matchScore: 70,
  status: "QUALIFIED",
  savedAt: new Date(2026, 9, n),
  ...extra,
});

describe("rankRecommendations", () => {
  it("treats places in the preferences as a boost, not a keyword", () => {
    const jobs = [job("Account Executive", { location: "Austin, TX" }), job("Account Executive", { location: "New York, NY" }), job("Office Manager", { location: "New York, NY" })];
    const ranked = rankRecommendations(jobs, ["Account Executive", "SaaS", "NYC", "New York City"]);
    expect(ranked.map((r) => [r.job.location, r.relevance, r.places])).toEqual([
      ["New York, NY", 75, ["NYC", "New York City"]],
      ["Austin, TX", 60, []],
    ]);
  });

  it("needs a keyword hit and ranks title hits above description hits", () => {
    const jobs = [
      job("Software Engineer", { description: "Partner with our SaaS sales team." }),
      job("SaaS Account Executive"),
      job("Warehouse Associate"),
    ];
    const ranked = rankRecommendations(jobs, ["SaaS", "account executive"]);
    expect(ranked.map((r) => r.job.title)).toEqual(["SaaS Account Executive", "Software Engineer"]);
    expect(ranked[0]).toMatchObject({ titleKeywords: ["SaaS", "account executive"], descriptionKeywords: [], relevance: 85 });
    expect(ranked[1]).toMatchObject({ titleKeywords: [], descriptionKeywords: ["SaaS"] });
  });

  it("blends keywords with the match score", () => {
    const ranked = rankRecommendations([job("SaaS AE", { matchScore: 40 }), job("SaaS SDR", { matchScore: 90 })], ["saas"]);
    expect(ranked.map((r) => [r.job.title, r.relevance])).toEqual([["SaaS SDR", 95], ["SaaS AE", 70]]);
  });

  it("never recommends jobs that broke a rule, but keeps ones that only scored low", () => {
    const failed = (rule: string) => ({ status: "NOT_QUALIFIED", qualification: { checks: [{ rule, outcome: "fail" }] } });
    const ranked = rankRecommendations(
      [job("SaaS AE excluded", failed("excludedCompanies")), job("SaaS AE skipped", { status: "SKIPPED" }), job("SaaS AE low", { ...failed("minMatchScore"), matchScore: 30 }), job("SaaS AE unknown", { status: "NOT_QUALIFIED" })],
      ["saas"],
    );
    expect(ranked.map((r) => [r.job.title, r.relevance])).toEqual([["SaaS AE low", 65]]);
  });

  it("falls back to match score without keywords, skipping unscored jobs", () => {
    const ranked = rankRecommendations([job("A", { matchScore: 60 }), job("B", { matchScore: null }), job("C", { matchScore: 88 })], []);
    expect(ranked.map((r) => r.job.title)).toEqual(["C", "A"]);
  });
});
