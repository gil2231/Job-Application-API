import { describe, expect, it } from "vitest";
import { detectPlatformFromHtml, detectPlatformFromUrl } from "../src/detect";
import { AdapterRegistry } from "../src/registry";
import type { ApplicationAdapter } from "../src/adapter";

describe("platform detection", () => {
  it.each([
    ["https://acme.wd5.myworkdayjobs.com/en-US/External/job/NYC/BDR_R123", "WORKDAY"],
    ["https://boards.greenhouse.io/acme/jobs/4012345", "GREENHOUSE"],
    ["https://job-boards.greenhouse.io/acme/jobs/4012345", "GREENHOUSE"],
    ["https://jobs.lever.co/acme/1b2c3d", "LEVER"],
    ["https://jobs.ashbyhq.com/acme/abc", "ASHBY"],
    ["https://jobs.smartrecruiters.com/Acme/7434", "SMARTRECRUITERS"],
    ["https://www.linkedin.com/jobs/view/3987654321", "LINKEDIN_EASY_APPLY"],
    ["https://careers.acme.com/jobs/123", "GENERIC"],
    ["not a url", "UNKNOWN"],
  ])("%s → %s", (url, platform) => {
    expect(detectPlatformFromUrl(url).platform).toBe(platform);
  });

  it("does not treat lookalike hosts as an ATS", () => {
    expect(detectPlatformFromUrl("https://greenhouse.io.evil.com/jobs").platform).toBe("GENERIC");
    expect(detectPlatformFromUrl("https://notlever.co/x").platform).toBe("GENERIC");
  });

  it("finds an ATS embedded in an employer careers page", () => {
    const html = '<div id="grnhse_app"></div><script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>';
    expect(detectPlatformFromHtml("https://careers.acme.com/jobs", html)).toMatchObject({ platform: "GREENHOUSE", confidence: 80 });
  });
});

describe("AdapterRegistry", () => {
  const fake = (platform: ApplicationAdapter["platform"], score = 0) =>
    ({ platform, displayName: platform, detect: () => score }) as unknown as ApplicationAdapter;

  it("resolves by detected platform and falls back to generic", async () => {
    const registry = new AdapterRegistry().register(fake("LEVER")).register(fake("GENERIC"));
    expect((await registry.resolve("https://jobs.lever.co/acme/1")).adapter?.platform).toBe("LEVER");
    expect((await registry.resolve("https://careers.acme.com/1")).adapter?.platform).toBe("GENERIC");
  });

  it("asks adapters when the URL is not conclusive", async () => {
    const registry = new AdapterRegistry().register(fake("ASHBY", 85)).register(fake("GENERIC"));
    expect((await registry.resolve("https://careers.acme.com/1")).adapter?.platform).toBe("ASHBY");
  });

  it("rejects duplicate registration", () => {
    expect(() => new AdapterRegistry().register(fake("LEVER")).register(fake("LEVER"))).toThrow();
  });
});
