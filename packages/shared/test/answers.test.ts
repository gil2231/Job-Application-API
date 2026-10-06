import { describe, expect, it } from "vitest";
import { computeYearsOfExperience, deriveAnswerFromProfile, normalizeQuestionKey, STANDARD_QUESTIONS } from "../src/answers";

describe("deriveAnswerFromProfile", () => {
  it("answers link questions only when the profile has the link", () => {
    expect(deriveAnswerFromProfile("linkedin_url", { linkedinUrl: "https://linkedin.com/in/me" })).toMatchObject({ confidence: 1 });
    expect(deriveAnswerFromProfile("linkedin_url", {})).toBeNull();
  });
  it("falls back to the website for portfolio with lower confidence", () => {
    expect(deriveAnswerFromProfile("portfolio_url", { websiteUrl: "https://me.dev" })).toMatchObject({ answer: "https://me.dev", confidence: 0.7 });
  });
  it("never guesses employer-specific answers", () => {
    for (const key of ["why_company", "salary_expectations", "sponsorship", "work_authorization", "demographic_gender"]) {
      expect(deriveAnswerFromProfile(key, { linkedinUrl: "x", yearsExperience: 5 })).toBeNull();
    }
  });
  it("prefers stated years of experience over calculated", () => {
    expect(deriveAnswerFromProfile("years_experience", { yearsExperience: 6, employment: [] })).toMatchObject({ answer: "6", confidence: 1 });
    const derived = deriveAnswerFromProfile("years_experience", {
      employment: [{ startDate: "2018-01-01", endDate: "2020-01-01" }],
    });
    expect(derived).toMatchObject({ answer: "2", confidence: 0.8 });
  });
});

describe("computeYearsOfExperience", () => {
  it("merges overlapping roles", () => {
    const years = computeYearsOfExperience(
      [
        { startDate: "2015-01-01", endDate: "2019-01-01" },
        { startDate: "2017-01-01", endDate: "2020-01-01" },
        { startDate: "2021-01-01", isCurrent: true },
      ],
      new Date("2022-01-01"),
    );
    expect(years).toBeCloseTo(6, 0);
  });
});

describe("normalizeQuestionKey", () => {
  it("normalizes punctuation and casing", () => {
    expect(normalizeQuestionKey("What are your Salary Expectations? (USD)")).toBe("what_are_your_salary_expectations");
  });
  it("standard question keys are unique", () => {
    const keys = STANDARD_QUESTIONS.map((q) => q.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
