import { describe, expect, it } from "vitest";
import { isEmptyKeywordQuery, matchesKeywordQuery, mentionsKeyword, parseKeywordQuery } from "../src/keywords";

describe("parseKeywordQuery", () => {
  it("splits words, quoted phrases and exclusions", () => {
    expect(parseKeywordQuery('account executive "medical devices" -commission -"cold calling"')).toEqual({
      include: ["account", "executive", "medical devices"],
      exclude: ["commission", "cold calling"],
    });
  });
  it("ignores empty terms, lone minus signs and repeats", () => {
    expect(parseKeywordQuery(' - "" Sales sales  -  ')).toEqual({ include: ["Sales"], exclude: [] });
    expect(isEmptyKeywordQuery(parseKeywordQuery("   "))).toBe(true);
    expect(isEmptyKeywordQuery(parseKeywordQuery(undefined))).toBe(true);
  });
  it("tolerates an unclosed quote", () => {
    expect(parseKeywordQuery('"customer success')).toEqual({ include: ["customer success"], exclude: [] });
  });
  it("caps the number of terms", () => {
    const q = parseKeywordQuery(Array.from({ length: 40 }, (_, i) => `w${i}`).join(" "));
    expect(q.include).toHaveLength(20);
  });
});

describe("matchesKeywordQuery", () => {
  const text = "Senior Account Executive. Sell medical-devices to hospitals. Base salary plus commission. C++ a plus.";
  it("requires every included term on word boundaries", () => {
    expect(matchesKeywordQuery(text, parseKeywordQuery("account executive"))).toBe(true);
    expect(matchesKeywordQuery(text, parseKeywordQuery('"medical devices"'))).toBe(true);
    expect(matchesKeywordQuery(text, parseKeywordQuery("account manager"))).toBe(false);
    expect(mentionsKeyword("Wholesale buyer", "sales")).toBe(false);
    expect(mentionsKeyword(text, "c++")).toBe(true);
  });
  it("rejects text containing an excluded term", () => {
    expect(matchesKeywordQuery(text, parseKeywordQuery("executive -commission"))).toBe(false);
    expect(matchesKeywordQuery(text, parseKeywordQuery("executive -recruiter"))).toBe(true);
  });
  it("matches everything for an empty query", () => {
    expect(matchesKeywordQuery(text, parseKeywordQuery(""))).toBe(true);
  });
});
