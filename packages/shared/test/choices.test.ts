import { describe, expect, it } from "vitest";
import { answerFitsChoices, answerParts } from "../src/choices";

describe("answerFitsChoices", () => {
  const consents = ["By clicking this box and submitting your application, you consent to our Applicant Privacy Statement.", "By clicking this box, you consent to a background check."];

  it("takes only Yes or No for a lone checkbox", () => {
    expect(answerFitsChoices("CHECKBOX", [], "Yes")).toBe(true);
    expect(answerFitsChoices("CHECKBOX", [], "Maybe")).toBe(false);
  });

  it("takes any of a checkbox group's choices, including ones with commas", () => {
    expect(answerFitsChoices("CHECKBOX", ["Yes", "No"], "Yes")).toBe(true);
    expect(answerFitsChoices("CHECKBOX", consents, consents[1]!)).toBe(true);
    expect(answerFitsChoices("CHECKBOX", consents, consents.join(", "))).toBe(true);
    expect(answerFitsChoices("CHECKBOX", ["Yes", "No"], "Sure")).toBe(false);
  });

  it("takes only a listed choice for a dropdown, unless the list was too long to read in full", () => {
    const veteran = ["I am not a protected veteran", "I don't wish to answer"];
    expect(answerFitsChoices("SELECT", veteran, "I am not a protected veteran")).toBe(true);
    expect(answerFitsChoices("SELECT", veteran, "Not a current or past veteran")).toBe(false);
    expect(answerFitsChoices("SELECT", Array.from({ length: 100 }, (_, i) => `School ${i}`), "Fordham University")).toBe(true);
    expect(answerFitsChoices("TEXT", [], "anything")).toBe(true);
  });

  it("finds whole choices before splitting on commas", () => {
    expect(answerParts(`${consents[1]}, Other`, consents)).toEqual([consents[1], "Other"]);
    expect(answerParts("", consents)).toEqual([]);
  });
});
