import { describe, expect, it } from "vitest";
import { preferenceFit } from "../src";

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
