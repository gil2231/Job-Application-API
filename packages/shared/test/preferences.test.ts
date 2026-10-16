import { describe, expect, it } from "vitest";
import { isSeniorTitle, preferenceFit, wantsEarlyCareer } from "../src";

describe("preferenceFit", () => {
  const prefs = { keywords: ["Account Executive", "FinTech", "Entry Level"], places: ["NYC", "Remote"] };

  it("counts title matches most, then the company or description, then the place", () => {
    const fit = preferenceFit({ title: "Account Executive", company: "Acme", location: "New York, NY", description: "An entry level role selling to FinTech companies." }, prefs);
    expect(fit).toEqual({ score: 3 + 1 + 1 + 4, matched: ["Account Executive", "FinTech", "Entry Level"], places: ["NYC"] });
  });

  it("treats a remote job as in Remote even when its location says otherwise", () => {
    expect(preferenceFit({ title: "Account Executive", location: "United States", remote: true }, prefs).places).toEqual(["Remote"]);
  });

  it("scores nothing for a job that fits nothing", () => {
    expect(preferenceFit({ title: "Software Engineer", location: "London" }, prefs)).toEqual({ score: 0, matched: [], places: [] });
  });
});

describe("early-career searches", () => {
  it("knows preferences that ask for entry-level jobs", () => {
    expect(wantsEarlyCareer(["Sales", "Entry-Level", "NYC"])).toBe(true);
    expect(wantsEarlyCareer(["New Graduate"])).toBe(true);
    expect(wantsEarlyCareer(["Graduate Program"])).toBe(true);
    expect(wantsEarlyCareer(["Sales", "Account Executive", "NYC"])).toBe(false);
  });

  it.each([
    ["Director, Product Marketing", true],
    ["Senior Manager, Partnerships", true],
    ["Sr. Account Executive", true],
    ["Head of Market Intelligence", true],
    ["Team Lead, Sales Development", true],
    ["VP of Sales", true],
    ["Lead Generation Specialist", false],
    ["Business Development Representative", false],
    ["Marketing Associate", false],
    ["Account Manager", false],
    ["Leadership Development Program Analyst", false],
  ])("%s is senior: %s", (title, senior) => {
    expect(isSeniorTitle(title)).toBe(senior);
  });
});
