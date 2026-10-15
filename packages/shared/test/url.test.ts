import { describe, expect, it } from "vitest";
import { listingSite } from "../src/listing-sites";
import { canonicalizeJobUrl, extractLinkedInJobId } from "../src/url";

describe("canonicalizeJobUrl", () => {
  it("strips tracking params, fragments, trailing slashes, and www", () => {
    expect(canonicalizeJobUrl("https://www.Boards.Greenhouse.io/acme/jobs/123/?utm_source=x&gh_src=abc#apply")).toBe(
      "https://boards.greenhouse.io/acme/jobs/123?gh_src=abc",
    );
  });
  it("produces the same key for equivalent URLs", () => {
    const a = canonicalizeJobUrl("https://jobs.lever.co/acme/abc-123?lever-source=LinkedIn&utm_campaign=z");
    const b = canonicalizeJobUrl("http://jobs.lever.co/acme/abc-123/?utm_campaign=y&lever-source=LinkedIn");
    expect(a).toBe(b);
  });
  it("collapses every LinkedIn job URL shape to the job id", () => {
    const expected = "https://www.linkedin.com/jobs/view/3987654321";
    expect(canonicalizeJobUrl("https://www.linkedin.com/jobs/view/3987654321/?refId=abc&trackingId=x")).toBe(expected);
    expect(canonicalizeJobUrl("https://linkedin.com/jobs/view/senior-bdr-at-acme-3987654321")).toBe(expected);
    expect(canonicalizeJobUrl("https://www.linkedin.com/jobs/collections/saved/?currentJobId=3987654321")).toBe(expected);
  });
  it("rejects non-http URLs", () => {
    expect(() => canonicalizeJobUrl("javascript:alert(1)")).toThrow();
    expect(() => canonicalizeJobUrl("not a url")).toThrow();
  });
});

describe("extractLinkedInJobId", () => {
  it("returns null for other hosts", () => {
    expect(extractLinkedInJobId("https://example.com/jobs/view/3987654321")).toBeNull();
  });
});

describe("listingSite", () => {
  it("knows Built In's city sites, which need a Built In account to apply", () => {
    expect(listingSite("https://www.builtinnyc.com/job/entry-level-marketing-specialist/11379736")).toBe("builtin");
    expect(listingSite("https://builtin.com/job/account-executive/123")).toBe("builtin");
    expect(listingSite("https://www.builtinchicago.org/job/x/1")).toBe("builtin");
    expect(listingSite("https://careers.builtinsoftware.com/jobs/1")).toBeNull();
  });
});
