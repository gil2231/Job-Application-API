import { describe, expect, it } from "vitest";
import { normalizeHeader, parseCsv, parseLooseDate } from "../src/csv";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF, a BOM and blank lines", () => {
    const text = '﻿Title,Company,Notes\r\n"Sales, Rep",Acme,"She said ""hi""\nthen left"\r\n\r\nAE,Globex,\n';
    expect(parseCsv(text)).toEqual([
      ["Title", "Company", "Notes"],
      ["Sales, Rep", "Acme", 'She said "hi"\nthen left'],
      ["AE", "Globex", ""],
    ]);
  });

  it("keeps a last row without a trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("normalizeHeader", () => {
  it("lowercases and collapses punctuation", () => {
    expect(normalizeHeader(" Job URL ")).toBe("job url");
    expect(normalizeHeader("Company_Name")).toBe("company name");
  });
});

describe("parseLooseDate", () => {
  it("reads LinkedIn's export format", () => {
    expect(parseLooseDate("10/3/24, 2:15 PM")?.toISOString()).toBe("2024-10-03T14:15:00.000Z");
    expect(parseLooseDate("1/2/2025")?.toISOString()).toBe("2025-01-02T00:00:00.000Z");
    expect(parseLooseDate("12/31/24, 12:05 AM")?.toISOString()).toBe("2024-12-31T00:05:00.000Z");
  });

  it("reads ISO and UTC-suffixed timestamps", () => {
    expect(parseLooseDate("2024-10-03 14:15:00 UTC")?.toISOString()).toBe("2024-10-03T14:15:00.000Z");
    expect(parseLooseDate("2024-10-03")?.toISOString()).toBe("2024-10-03T00:00:00.000Z");
  });

  it("returns null for empty or unreadable values", () => {
    expect(parseLooseDate("")).toBeNull();
    expect(parseLooseDate(undefined)).toBeNull();
    expect(parseLooseDate("last week")).toBeNull();
    expect(parseLooseDate("42")).toBeNull();
  });
});
