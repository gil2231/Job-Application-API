import { describe, expect, it } from "vitest";
import { formatSalaryRange, parseSalary } from "../src/salary";

describe("parseSalary", () => {
  it("parses an annual dollar range", () => {
    expect(parseSalary("$70,000 – $80,000 a year")).toMatchObject({ min: 70000, max: 80000, currency: "USD", period: "YEAR", annualMin: 70000 });
  });
  it("parses k suffixes and applies a trailing suffix to both ends", () => {
    expect(parseSalary("$70-80k")).toMatchObject({ min: 70000, max: 80000, period: "YEAR" });
    expect(parseSalary("£60k - £75k per annum")).toMatchObject({ min: 60000, max: 75000, currency: "GBP" });
  });
  it("parses hourly ranges and annualizes them", () => {
    const s = parseSalary("$45 - $55 per hour");
    expect(s).toMatchObject({ min: 45, max: 55, period: "HOUR", annualMin: 93600, annualMax: 114400 });
    expect(parseSalary("30/hr")).toMatchObject({ min: 30, max: 30, period: "HOUR" });
  });
  it("detects currency codes", () => {
    expect(parseSalary("CAD 90,000 - 110,000 annually")).toMatchObject({ currency: "CAD", min: 90000, max: 110000 });
  });
  it("orders a reversed range", () => {
    expect(parseSalary("$90,000 - $80,000")).toMatchObject({ min: 80000, max: 90000 });
  });
  it("returns null when there is no salary", () => {
    expect(parseSalary("Competitive")).toBeNull();
    expect(parseSalary("")).toBeNull();
    expect(parseSalary(null)).toBeNull();
    expect(parseSalary("2 years of experience per year")).toBeNull();
  });
});

describe("formatSalaryRange", () => {
  it("formats compact annual and hourly ranges", () => {
    expect(formatSalaryRange(70000, 80000)).toBe("$70K–$80K");
    expect(formatSalaryRange(45, 55, "USD", "HOUR")).toBe("$45–$55/hr");
    expect(formatSalaryRange(null, null)).toBe("—");
  });
});
