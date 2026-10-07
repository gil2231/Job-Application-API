import { describe, expect, it } from "vitest";
import { scrubText, scrubValue } from "../src/scrub";

describe("scrubText", () => {
  it("removes emails, phone numbers, tokens and connection credentials", () => {
    const out = scrubText(
      "Failed for jane.doe@example.com (+1 415-555-0132) with Bearer abc.def-123 at postgres://app:hunter2@db.internal:5432/app key sk-ant-api03-AbCdEf123456 token 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    );
    expect(out).not.toMatch(/jane|415|abc\.def|hunter2|AbCdEf|9f86d0/);
    expect(out).toContain("[email]");
    expect(out).toContain("[phone]");
    expect(out).toContain("postgres://[credentials]@db.internal:5432/app");
  });

  it("keeps ordinary messages and file paths readable", () => {
    const msg = "Cannot read properties of undefined (reading 'id') in /app/packages/database/src/applications.ts:120";
    expect(scrubText(msg)).toBe(msg);
  });

  it("truncates long text", () => {
    expect(scrubText("x".repeat(50), 10)).toBe("xxxxxxxxxx…");
  });
});

describe("scrubValue", () => {
  it("redacts sensitive keys and scrubs nested strings", () => {
    expect(scrubValue({ route: "/jobs", password: "p", user: { email: "a@b.co", note: "call a@b.co" }, list: ["x@y.io"] })).toEqual({
      route: "/jobs",
      password: "[redacted]",
      user: { email: "[redacted]", note: "call [email]" },
      list: ["[email]"],
    });
  });
});
